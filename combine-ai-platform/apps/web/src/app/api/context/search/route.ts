import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { generateEmbedding } from "@combine-ai/ai-provider"

export const dynamic = "force-dynamic"

/**
 * Check if pgvector extension is available in the current database.
 */
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

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const q = url.searchParams.get("q") || ""
    const department = url.searchParams.get("department")
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 50)

    if (!q.trim()) {
      return NextResponse.json({ results: [], total: 0 })
    }

    const vectorAvailable = await checkPgVector()

    if (vectorAvailable) {
      // Semantic vector search
      const embedding = await generateEmbedding(q)

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
        WHERE kb.workspace_id = ${session.workspaceId}
          ${
            department && department !== "GENERAL"
              ? prisma.$queryRaw`AND kb.department = ${department}::text`
              : prisma.$queryRaw`AND 1=1`
          }
        ORDER BY kc.embedding <=> ${embedding}::vector
        LIMIT ${limit}
      `

      const results = rawResults.map((r) => ({
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

      return NextResponse.json({ results, total: results.length, searchType: "semantic" })
    } else {
      // Fallback to keyword search
      const articles = await prisma.knowledgeArticle.findMany({
        where: {
          knowledgeBase: {
            workspaceId: session.workspaceId,
            ...(department && department !== "GENERAL"
              ? { department: department as any }
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

      const results = articles.map((a) => ({
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

      return NextResponse.json({ results, total: results.length, searchType: "keyword" })
    }
  } catch (error) {
    console.error("Context search API error:", error)
    return NextResponse.json(
      {
        error: "Search failed",
        detail: error instanceof Error ? error.message : "Unknown error",
        results: [],
        total: 0,
      },
      { status: 500 }
    )
  }
}
