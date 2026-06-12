import { prisma } from "@/lib/server/prisma"
import { generateEmbedding } from "@combine-ai/ai-provider/server"
import { COL, KB_JOIN_CHAIN } from "@/lib/server/db-columns"

export interface KnowledgeChunkResult {
  chunkId: string | null
  content: string
  chunkIndex: number
  articleId: string
  articleTitle: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  knowledgeBaseSlug: string
  department: string
  similarity: number
  excerpt: string
}

export interface KnowledgeSearchResult {
  chunks: KnowledgeChunkResult[]
  searchType: "semantic" | "keyword"
}

async function checkPgVector(): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_type WHERE typname = 'vector'
      ) as available
    `
    return result[0]?.available ?? false
  } catch {
    return false
  }
}

export async function searchKnowledgeChunks(
  workspaceId: string,
  query: string,
  options?: { limit?: number; department?: string }
): Promise<KnowledgeSearchResult> {
  const q = query.trim()
  const limit = Math.min(options?.limit ?? 5, 20)
  const department = options?.department

  if (!q) {
    return { chunks: [], searchType: "keyword" }
  }

  const vectorAvailable = await checkPgVector()

  if (vectorAvailable) {
    try {
      const embedding = await generateEmbedding(q.slice(0, 2000))

      const hasDept = department && department !== "GENERAL"
      const embLiteral = `'[${embedding.join(",")}]'`
      const C_COL = COL.KnowledgeChunk
      const A_COL = COL.KnowledgeArticle
      const K_COL = COL.KnowledgeBase

      const deptSQL = hasDept
        ? ` AND kb."${K_COL.department}" = '${department}'::text`
        : ""

      const sql = `
        SELECT
          kc."${C_COL.id}" as chunk_id, kc."${C_COL.content}" as content,
          kc."${C_COL.chunkIndex}" as chunk_index,
          ka."${A_COL.id}" as article_id, ka."${A_COL.title}" as article_title,
          kb."${K_COL.id}" as knowledge_base_id, kb."${K_COL.name}" as knowledge_base_name,
          kb."${K_COL.slug}" as knowledge_base_slug, kb."${K_COL.department}" as department,
          1 - (kc."${C_COL.embedding}" <=> ${embLiteral}::vector) as similarity
        ${KB_JOIN_CHAIN}
        WHERE kb."${K_COL.workspaceId}" = '${workspaceId}'${deptSQL}
        ORDER BY kc."${C_COL.embedding}" <=> ${embLiteral}::vector
        LIMIT ${limit}
      `

      const rawResults = await prisma.$queryRawUnsafe<
        Array<{
          chunk_id: string; content: string; chunk_index: number
          article_id: string; article_title: string
          knowledge_base_id: string; knowledge_base_name: string
          knowledge_base_slug: string; department: string; similarity: number
        }>
      >(sql)

      const chunks = rawResults.map((r) => ({
        chunkId: r.chunk_id,
        content: r.content,
        chunkIndex: r.chunk_index,
        articleId: r.article_id,
        articleTitle: r.article_title,
        knowledgeBaseId: r.knowledge_base_id,
        knowledgeBaseName: r.knowledge_base_name,
        knowledgeBaseSlug: r.knowledge_base_slug,
        department: r.department,
        similarity: Math.round(r.similarity * 100) / 100,
        excerpt: r.content.slice(0, 300),
      }))

      if (chunks.length > 0) {
        return { chunks, searchType: "semantic" }
      }
    } catch (err) {
      console.warn("Vector search failed, falling back to keyword search:", err)
    }
  }

  const articles = await prisma.knowledgeArticle.findMany({
    where: {
      knowledgeBase: {
        workspaceId,
        ...(department && department !== "GENERAL"
          ? { department: department as never }
          : {}),
      },
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
      ],
    },
    include: {
      knowledgeBase: {
        select: { id: true, name: true, slug: true, department: true },
      },
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  })

  const chunks = articles.map((a) => ({
    chunkId: null,
    content: a.content,
    chunkIndex: 0,
    articleId: a.id,
    articleTitle: a.title,
    knowledgeBaseId: a.knowledgeBase.id,
    knowledgeBaseName: a.knowledgeBase.name,
    knowledgeBaseSlug: a.knowledgeBase.slug,
    department: a.knowledgeBase.department,
    similarity: 0,
    excerpt: a.content.slice(0, 300),
  }))

  return { chunks, searchType: "keyword" }
}
