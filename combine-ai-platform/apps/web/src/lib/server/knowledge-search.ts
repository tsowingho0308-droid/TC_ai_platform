import { prisma } from "@/lib/server/prisma"
import { generateEmbedding } from "@combine-ai/ai-provider"

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

      const rawResults = await prisma.$queryRaw<
        Array<{
          chunk_id: string
          content: string
          chunk_index: number
          article_id: string
          article_title: string
          knowledge_base_id: string
          knowledge_base_name: string
          knowledge_base_slug: string
          department: string
          similarity: number
        }>
      >`
        SELECT
          kc.id as chunk_id,
          kc.content,
          kc.chunk_index as chunk_index,
          ka.id as article_id,
          ka.title as article_title,
          kb.id as knowledge_base_id,
          kb.name as knowledge_base_name,
          kb.slug as knowledge_base_slug,
          kb.department,
          1 - (kc.embedding <=> ${embedding}::vector) as similarity
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeArticle" ka ON ka.id = kc.article_id
        JOIN "KnowledgeBase" kb ON kb.id = ka.knowledge_base_id
        WHERE kb.workspace_id = ${workspaceId}
          ${
            department && department !== "GENERAL"
              ? prisma.$queryRaw`AND kb.department = ${department}::text`
              : prisma.$queryRaw`AND 1=1`
          }
        ORDER BY kc.embedding <=> ${embedding}::vector
        LIMIT ${limit}
      `

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
