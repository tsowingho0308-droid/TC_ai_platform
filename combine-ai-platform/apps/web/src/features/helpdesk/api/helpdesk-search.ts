// Shared RAG search helper for Helpdesk Agent
// Supports optional query expansion for cross-language retrieval.

import { prisma } from "@/lib/server/prisma"
import { generateEmbedding } from "@combine-ai/ai-provider"

// ── Types ────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  title: string
  content: string
  knowledgeBaseName: string
  knowledgeBaseSlug: string
  department: string
  similarity?: number
  documentType?: string
  businessProcesses?: string[]
}

export interface SearchOptions {
  workspaceId: string
  department?: string
  topK?: number
  minSimilarity?: number
  /** Enable LLM query expansion for cross-language matching. Default true. */
  useQueryExpansion?: boolean
}

type RawVectorResult = {
  article_id: string; title: string; content: string
  kb_name: string; kb_slug: string; department: string; similarity: number
  document_type: string | null
  business_processes: string[] | null
}

// ── Helpers ──────────────────────────────────────────────────────

let pgVectorAvailable: boolean | null = null

export async function checkPgVector(): Promise<boolean> {
  if (pgVectorAvailable !== null) return pgVectorAvailable
  try {
    const result = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_type WHERE typname = 'vector'
      ) as available
    `
    pgVectorAvailable = result[0]?.available ?? false
  } catch {
    pgVectorAvailable = false
  }
  return pgVectorAvailable
}

export function resetPgVectorCheck(): void {
  pgVectorAvailable = null
}

// ── Core Vector Search (extracted for reuse in expansion) ─────────

async function runVectorSearch(
  embedding: number[],
  workspaceId: string,
  department: string | undefined,
  limit: number
): Promise<RawVectorResult[]> {
  const hasDeptFilter = department && department !== "GENERAL"

  return hasDeptFilter
    ? (await prisma.$queryRaw<RawVectorResult[]>`
        SELECT DISTINCT ON (ka.id)
          ka.id as article_id, ka.title, ka.content,
          kb.name as kb_name, kb.slug as kb_slug, kb.department,
          (1 - (kc.embedding <=> ${embedding}::vector))
            * CASE WHEN ka.document_type IN ('PLAYBOOK', 'PROCESS_MAP') THEN 0.85 ELSE 1.0 END
            as similarity,
          ka.document_type,
          ka.business_processes
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeArticle" ka ON ka.id = kc.article_id
        JOIN "KnowledgeBase" kb ON kb.id = ka.knowledge_base_id
        WHERE kb.workspace_id = ${workspaceId}
          AND kb.department = ${department}::"HelpdeskDepartment"
        ORDER BY ka.id, kc.embedding <=> ${embedding}::vector
        LIMIT ${limit}
      `)
    : (await prisma.$queryRaw<RawVectorResult[]>`
        SELECT DISTINCT ON (ka.id)
          ka.id as article_id, ka.title, ka.content,
          kb.name as kb_name, kb.slug as kb_slug, kb.department,
          (1 - (kc.embedding <=> ${embedding}::vector))
            * CASE WHEN ka.document_type IN ('PLAYBOOK', 'PROCESS_MAP') THEN 0.85 ELSE 1.0 END
            as similarity,
          ka.document_type,
          ka.business_processes
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeArticle" ka ON ka.id = kc.article_id
        JOIN "KnowledgeBase" kb ON kb.id = ka.knowledge_base_id
        WHERE kb.workspace_id = ${workspaceId}
        ORDER BY ka.id, kc.embedding <=> ${embedding}::vector
        LIMIT ${limit}
      `)
}

function mapResults(
  raw: RawVectorResult[],
  minSimilarity: number
): SearchResult[] {
  return raw
    .map((r) => ({
      id: r.article_id,
      title: r.title,
      content: r.content,
      knowledgeBaseName: r.kb_name,
      knowledgeBaseSlug: r.kb_slug,
      department: r.department,
      similarity: Math.round(r.similarity * 100) / 100,
      documentType: r.document_type || undefined,
      businessProcesses: r.business_processes || undefined,
    }))
    .filter((a) => a.similarity === undefined || a.similarity >= minSimilarity)
}

// ── Keyword Fallback ─────────────────────────────────────────────

async function keywordSearch(
  query: string,
  workspaceId: string,
  department: string | undefined,
  topK: number
): Promise<SearchResult[]> {
  const where: Record<string, unknown> = {
    knowledgeBase: { workspaceId },
    OR: [{ title: { contains: query } }, { content: { contains: query } }],
  }

  if (department && department !== "GENERAL") {
    where.knowledgeBase = { workspaceId, department }
  }

  let articleResults = await prisma.knowledgeArticle.findMany({
    where,
    take: topK,
    orderBy: { updatedAt: "desc" },
    include: {
      knowledgeBase: { select: { name: true, slug: true, department: true } },
    },
  })

  if (articleResults.length === 0 && department && department !== "GENERAL") {
    articleResults = await prisma.knowledgeArticle.findMany({
      where: {
        knowledgeBase: { workspaceId },
        OR: [{ title: { contains: query } }, { content: { contains: query } }],
      },
      take: topK,
      orderBy: { updatedAt: "desc" },
      include: {
        knowledgeBase: { select: { name: true, slug: true, department: true } },
      },
    })
  }

  return articleResults.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    knowledgeBaseName: a.knowledgeBase.name,
    knowledgeBaseSlug: a.knowledgeBase.slug,
    department: a.knowledgeBase.department,
  }))
}

// ── Main Search ──────────────────────────────────────────────────

export async function searchKnowledgeBase(
  query: string,
  options: SearchOptions
): Promise<{ articles: SearchResult[]; searchMethod: "vector" | "keyword" | "none" | "expanded" }> {
  const { workspaceId, department, topK = 5, minSimilarity = 0.7, useQueryExpansion = true } = options

  const vectorAvailable = await checkPgVector()

  // ══════════════════════════════════════════════════════════════
  // Tier 0: Expanded multi-query vector search
  // ══════════════════════════════════════════════════════════════
  if (vectorAvailable && useQueryExpansion) {
    try {
      const { expandQuery } = await import("./query-expander")
      const expanded = await expandQuery(query)

      if (expanded.variants.length > 1) {
        // Run vector search for each variant, merge by best similarity
        const combined = new Map<string, SearchResult & { bestSimilarity: number }>()

        for (const variant of expanded.variants) {
          const variantEmbedding = await generateEmbedding(variant)
          const variantResults = await runVectorSearch(
            variantEmbedding,
            workspaceId,
            department,
            Math.ceil(topK / 2)
          )

          for (const r of variantResults) {
            const sim = Math.round(r.similarity * 100) / 100
            const existing = combined.get(r.article_id)
            if (!existing || sim > existing.bestSimilarity) {
              combined.set(r.article_id, {
                id: r.article_id,
                title: r.title,
                content: r.content,
                knowledgeBaseName: r.kb_name,
                knowledgeBaseSlug: r.kb_slug,
                department: r.department,
                similarity: sim,
                bestSimilarity: sim,
              })
            }
          }
        }

        const articles = [...combined.values()]
          .sort((a, b) => (b.bestSimilarity ?? 0) - (a.bestSimilarity ?? 0))
          .slice(0, topK)
          .filter((a) => a.bestSimilarity >= minSimilarity)
          .map(({ bestSimilarity: _, ...rest }) => rest)

        if (articles.length > 0) {
          return { articles, searchMethod: "expanded" }
        }
      }
    } catch (err) {
      console.warn("Expanded search failed, falling back to single-query vector search:", err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Tier 1: Single-query vector search
  // ══════════════════════════════════════════════════════════════
  let articles: SearchResult[] = []

  if (vectorAvailable) {
    try {
      const embedding = await generateEmbedding(query)
      const rawResults = await runVectorSearch(
        embedding, workspaceId, department, topK
      )
      articles = mapResults(rawResults, minSimilarity)
    } catch (err) {
      console.warn("Vector search failed, falling back to keyword search:", err)
    }
  }

  if (articles.length > 0) {
    return { articles, searchMethod: "vector" }
  }

  // ══════════════════════════════════════════════════════════════
  // Tier 2: Keyword fallback
  // ══════════════════════════════════════════════════════════════
  articles = await keywordSearch(query, workspaceId, department, topK)
  return { articles, searchMethod: articles.length > 0 ? "keyword" : "none" }
}

// ── Source Formatting ────────────────────────────────────────────

export function formatSourcesText(
  articles: SearchResult[],
  contentMaxChars = 1500
): string {
  if (articles.length === 0) {
    return "No relevant policy documents found in the knowledge base."
  }

  return (
    articles
      .map((a, i) => {
        let line = `[Article ${i + 1}] Title: ${a.title}\nDepartment: ${a.department}`
        if (a.documentType) line += `\nType: ${a.documentType.replace(/_/g, " ")}`
        if (a.businessProcesses?.length) line += `\nProcesses: ${a.businessProcesses.join(", ")}`
        line += `\nContent: ${a.content.slice(0, contentMaxChars)}`
        if (a.similarity !== undefined) {
          line += `\nRelevance: ${Math.round(a.similarity * 100)}%`
        }
        return line
      })
      .join("\n\n") +
    "\n\n---\nWhen answering, cite the article title(s) you used."
  )
}
