import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { generateEmbedding, chunkText } from "@combine-ai/ai-provider"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "upload"
    const body = (await request.json()) as Record<string, unknown>

    switch (action) {
      case "upload": {
        const {
          text, title, knowledgeBaseId, tags, language,
          targetAudience, businessProcesses, documentType,
        } = body

        if (!text || typeof text !== "string") {
          return NextResponse.json(
            { error: "text content is required" },
            { status: 400 }
          )
        }

        if (!knowledgeBaseId || typeof knowledgeBaseId !== "string") {
          return NextResponse.json(
            { error: "knowledgeBaseId is required" },
            { status: 400 }
          )
        }

        // Verify knowledge base ownership
        const kb = await prisma.knowledgeBase.findFirst({
          where: { id: knowledgeBaseId, workspaceId: session.workspaceId },
        })

        if (!kb) {
          return NextResponse.json(
            { error: "Knowledge base not found" },
            { status: 404 }
          )
        }

        // Create the article
        const article = await prisma.knowledgeArticle.create({
          data: {
            knowledgeBaseId,
            title: (title as string) || "Untitled",
            content: text,
            tags: (tags as string[]) || [],
            language: (language as string) || "zh-HK",
            targetAudience: (targetAudience as never) || "ALL_EMPLOYEES",
            businessProcesses: (businessProcesses as string[]) || [],
            documentType: (documentType as never) || "STANDARD",
          },
        })

        try {
          // Chunk and embed
          const chunks = chunkText(text)
          const chunkRecords: Array<{
            articleId: string
            content: string
            chunkIndex: number
            tokenCount: number
          }> = []

          for (let i = 0; i < chunks.length; i++) {
            const chunkContent = chunks[i]
            const embedding = await generateEmbedding(chunkContent)

            // Create chunk with raw SQL for embedding column
            const created = await prisma.knowledgeChunk.create({
              data: {
                articleId: article.id,
                content: chunkContent,
                chunkIndex: i,
                tokenCount: Math.ceil(chunkContent.length / 4), // rough CJK token estimate
              },
            })

            // Insert embedding via raw SQL
            await prisma.$executeRaw`
              UPDATE "KnowledgeChunk"
              SET embedding = ${embedding}::vector
              WHERE id = ${created.id}
            `

            chunkRecords.push({
              articleId: article.id,
              content: chunkContent.slice(0, 100),
              chunkIndex: i,
              tokenCount: Math.ceil(chunkContent.length / 4),
            })
          }

          return NextResponse.json(
            {
              article: {
                id: article.id,
                title: article.title,
                content: article.content.slice(0, 500),
                tags: article.tags,
                language: article.language,
                targetAudience: article.targetAudience,
                businessProcesses: article.businessProcesses,
                documentType: article.documentType,
              },
              chunksCreated: chunks.length,
            },
            { status: 201 }
          )
        } catch (embedErr) {
          await prisma.knowledgeChunk.deleteMany({ where: { articleId: article.id } })
          await prisma.knowledgeArticle.delete({ where: { id: article.id } })
          throw embedErr
        }
      }

      case "reprocess": {
        const { id } = body

        if (!id || typeof id !== "string") {
          return NextResponse.json(
            { error: "Article id is required" },
            { status: 400 }
          )
        }

        // Verify ownership
        const doc = await prisma.knowledgeArticle.findFirst({
          where: {
            id,
            knowledgeBase: { workspaceId: session.workspaceId },
          },
        })

        if (!doc) {
          return NextResponse.json(
            { error: "Document not found" },
            { status: 404 }
          )
        }

        // Delete old chunks
        await prisma.knowledgeChunk.deleteMany({
          where: { articleId: id },
        })

        // Re-chunk and re-embed
        const newChunks = chunkText(doc.content)

        for (let i = 0; i < newChunks.length; i++) {
          const embedding = await generateEmbedding(newChunks[i])
          const created = await prisma.knowledgeChunk.create({
            data: {
              articleId: id,
              content: newChunks[i],
              chunkIndex: i,
              tokenCount: Math.ceil(newChunks[i].length / 4),
            },
          })
          await prisma.$executeRaw`
            UPDATE "KnowledgeChunk"
            SET embedding = ${embedding}::vector
            WHERE id = ${created.id}
          `
        }

        return NextResponse.json({
          success: true,
          chunksReprocessed: newChunks.length,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error("Context ingest API error:", error)
    return NextResponse.json(
      {
        error: "Ingestion failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
