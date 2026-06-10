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
  /** Below this, results are treated as "suggestions" rather than direct matches. Default 0.45. */
  suggestionThreshold?: number
  /** Enable LLM query expansion for cross-language matching. Default true. */
  useQueryExpansion?: boolean
}

export type SearchTier = "matched" | "suggestions" | "none"

export interface SearchResultSet {
  articles: SearchResult[]
  suggestions: SearchResult[]
  maxScore: number
  tier: SearchTier
  searchMethod: "vector" | "keyword" | "none" | "expanded"
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
            * CASE WHEN ka."documentType" IN ('PLAYBOOK', 'PROCESS_MAP') THEN 0.85 ELSE 1.0 END
            as similarity,
          ka."documentType",
          ka."businessProcesses"
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeArticle" ka ON ka.id = kc."articleId"
        JOIN "KnowledgeBase" kb ON kb.id = ka."knowledgeBaseId"
        WHERE kb."workspaceId" = ${workspaceId}
          AND kb.department = ${department}::"HelpdeskDepartment"
        ORDER BY ka.id, kc.embedding <=> ${embedding}::vector
        LIMIT ${limit}
      `)
    : (await prisma.$queryRaw<RawVectorResult[]>`
        SELECT DISTINCT ON (ka.id)
          ka.id as article_id, ka.title, ka.content,
          kb.name as kb_name, kb.slug as kb_slug, kb.department,
          (1 - (kc.embedding <=> ${embedding}::vector))
            * CASE WHEN ka."documentType" IN ('PLAYBOOK', 'PROCESS_MAP') THEN 0.85 ELSE 1.0 END
            as similarity,
          ka."documentType",
          ka."businessProcesses"
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeArticle" ka ON ka.id = kc."articleId"
        JOIN "KnowledgeBase" kb ON kb.id = ka."knowledgeBaseId"
        WHERE kb."workspaceId" = ${workspaceId}
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
  // Extract keywords from long queries for tag matching
  // e.g. "我們公司的病假規矩是什麼" → ["sick", "病假", "leave"]
  const tagKeywords = extractTagKeywords(query)

  const orConditions: Record<string, unknown>[] = [
    { title: { contains: query } },
    { content: { contains: query } },
    // Search tags with the full query
    { tags: { hasSome: [query] } },
  ]

  // Also search tags with extracted keywords (long sentence → individual terms)
  if (tagKeywords.length > 0) {
    orConditions.push({ tags: { hasSome: tagKeywords } })
    // Also search title/content with shorter keywords for better recall
    for (const kw of tagKeywords.slice(0, 3)) {
      orConditions.push({ title: { contains: kw } })
      orConditions.push({ content: { contains: kw } })
    }
  }

  const where: Record<string, unknown> = {
    knowledgeBase: { workspaceId },
    OR: orConditions,
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
        OR: orConditions,
      },
      take: topK,
      orderBy: { updatedAt: "desc" },
      include: {
        knowledgeBase: { select: { name: true, slug: true, department: true } },
      },
    })
  }

  console.log(
    `[RAG Keyword Search] query="${query.slice(0, 80)}" | tagKeywords=[${tagKeywords.join(", ")}] | results=${articleResults.length}`
  )

  return articleResults.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    knowledgeBaseName: a.knowledgeBase.name,
    knowledgeBaseSlug: a.knowledgeBase.slug,
    department: a.knowledgeBase.department,
  }))
}

// ── Tag Keyword Extraction ───────────────────────────────────────

// Common Chinese-English keyword → taxonomy tag mappings for HK enterprise context
// Each entry maps keywords to the corresponding tag name in tag-taxonomy.ts
const KEYWORD_MAP: Record<string, string[]> = {
  leave: ["sick", "病假", "請病假", "病", "medical leave", "醫生紙", "annual leave", "年假", "請假", "假期", "放假", "leave"],
  expense: ["expense", "報銷", "開支", "費用", "claim", "支出"],
  tender: ["tender", "標書", "招標", "投標", "rfp", "rfq", "標"],
  onboarding: ["onboarding", "入職", "orientation", "新人", "報到", " onboard"],
  offboarding: ["offboarding", "離職", "resign", "辭職", "exit", "退職"],
  procurement: ["procurement", "採購", "購買", "purchase", "購置"],
  budget: ["budget", "預算", "budgeting", "經費"],
  equipment: ["equipment", "設備", "電腦", "laptop", "硬體", "硬件", "硬件", "筆電"],
  vpn: ["vpn", "remote access", "遠端", "遠程", "在家工作", "wfh", "work from home"],
  security: ["security", "安全", "密碼", "password", "保安"],
  travel: ["travel", "出差", "旅行", "機票", "酒店", "flight", "hotel"],
  handbook: ["handbook", "手冊", "員工手冊", "守則", "code of conduct"],
  holiday: ["holiday", "公眾假期", "公假", "放假", "假期安排"],
  compliance: ["compliance", "合規", "法規", "regulatory", "審計", "audit"],
  invoice: ["invoice", "發票", "單據", "receipt", "收據", "賬單"],
  contract: ["contract", "合約", "合同", "協議", "agreement", "mou"],
  report: ["report", "報告", "報表", "分析", "summary"],
  policy: ["policy", "政策", "規矩", "規定", "rules", "規則", "制度"],
  recruitment: ["recruitment", "招聘", "請人", "hire", "interview", "面試", "求職"],
  training: ["training", "培訓", "訓練", "課程", "course", "學習"],
  benefits: ["benefits", "福利", "benefit", "保險", "insurance", "補貼"],
  facilities: ["facilities", "設施", "辦公室", "meeting room", "會議室", "停車場", "canteen"],
  "access-card": ["access", "門禁", "card", "badge", "通行證", "出入", "門卡"],
  software: ["software", "軟件", "軟體", "license", "授權", "安裝"],
  "email-systems": ["email", "郵件", "電郵", "信箱", "gmail", "郵箱"],
  emergency: ["emergency", "緊急", "急救", "first aid", "火警", "fire", "疏散"],
  "it-support": ["it support", "help desk", "技術支援", "維修", "troubleshoot"],
  "remote-work": ["remote", "遠程工作", "在家辦公", "work from home", "wfh"],
}

/**
 * Extract tag-relevant keywords from a query (Chinese or English).
 * For short queries (≤3 words), just return empty — the full query already matches.
 * For long queries, extract known substrings that map to tags.
 */
function extractTagKeywords(query: string): string[] {
  const qLower = query.toLowerCase().trim()
  const words = qLower.split(/\s+/)

  // Short query: no need to extract keywords
  if (words.length <= 3 && qLower.length <= 30) return []

  const matched: Set<string> = new Set()

  for (const [tag, synonyms] of Object.entries(KEYWORD_MAP)) {
    for (const syn of synonyms) {
      if (qLower.includes(syn.toLowerCase())) {
        matched.add(tag)
        break
      }
    }
  }

  return [...matched]
}

// ── Tier Computation ─────────────────────────────────────────────

function computeTier(
  rawResults: SearchResult[],
  minSimilarity: number,
  suggestionThreshold: number
): { articles: SearchResult[]; suggestions: SearchResult[]; maxScore: number; tier: SearchTier } {
  const maxScore = rawResults.length > 0
    ? Math.max(...rawResults.map((r) => r.similarity ?? 0))
    : 0

  if (maxScore >= minSimilarity) {
    return {
      articles: rawResults.filter((r) => (r.similarity ?? 0) >= minSimilarity),
      suggestions: [],
      maxScore,
      tier: "matched",
    }
  }

  if (maxScore >= suggestionThreshold) {
    return {
      articles: [],
      suggestions: rawResults
        .filter((r) => (r.similarity ?? 0) >= suggestionThreshold)
        .slice(0, 2),
      maxScore,
      tier: "suggestions",
    }
  }

  return { articles: [], suggestions: [], maxScore, tier: "none" }
}

// ── Main Search ──────────────────────────────────────────────────

export async function searchKnowledgeBase(
  query: string,
  options: SearchOptions
): Promise<SearchResultSet> {
  const {
    workspaceId, department, topK = 5,
    minSimilarity = 0.6, suggestionThreshold = 0.45,
    useQueryExpansion = true,
  } = options

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

        const rawResults = [...combined.values()]
          .sort((a, b) => (b.bestSimilarity ?? 0) - (a.bestSimilarity ?? 0))
          .slice(0, topK)
          .map(({ bestSimilarity: _, ...rest }) => rest)

        const tierResult = computeTier(rawResults, minSimilarity, suggestionThreshold)
        const topScores = rawResults.slice(0, 3).map((a) => (a.similarity ?? 0).toFixed(2))
        console.log(
          `[RAG Expanded Search] query="${query.slice(0, 80)}" | variants=${expanded.variants.length} | top scores: [${topScores.join(", ")}] | tier=${tierResult.tier} | matched=${tierResult.articles.length} | suggestions=${tierResult.suggestions.length}`
        )
        return { ...tierResult, searchMethod: "expanded" }
      }
    } catch (err) {
      console.warn("Expanded search failed, falling back to single-query vector search:", err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Tier 1: Single-query vector search
  // ══════════════════════════════════════════════════════════════

  if (vectorAvailable) {
    try {
      const embedding = await generateEmbedding(query)
      const rawResults = await runVectorSearch(
        embedding, workspaceId, department, topK
      )
      const allResults = mapResults(rawResults, 0) // get ALL results first, not filtered

      // Debug: log similarity scores
      const scores = rawResults.map((r) => Math.round(r.similarity * 10000) / 100)
      const tierResult = computeTier(allResults, minSimilarity, suggestionThreshold)
      console.log(
        `[RAG Vector Search] query="${query.slice(0, 80)}" | top scores: [${scores.slice(0, 5).join(", ")}%] | threshold=${minSimilarity} | tier=${tierResult.tier} | matched=${tierResult.articles.length} | suggestions=${tierResult.suggestions.length}`
      )
      return { ...tierResult, searchMethod: "vector" }
    } catch (err) {
      console.warn("Vector search failed, falling back to keyword search:", err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Tier 2: Keyword fallback (no similarity scores — all "matched" or "none")
  // ══════════════════════════════════════════════════════════════
  const kwArticles = await keywordSearch(query, workspaceId, department, topK)
  return {
    articles: kwArticles,
    suggestions: [],
    maxScore: 0,
    tier: kwArticles.length > 0 ? "matched" : "none",
    searchMethod: kwArticles.length > 0 ? "keyword" : "none",
  }
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
