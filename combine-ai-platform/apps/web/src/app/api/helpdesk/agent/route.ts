import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { generateEmbedding, getDashScopeProvider, DEFAULT_MODELS } from "@combine-ai/ai-provider"

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

async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string }>
}) {
  const provider = getDashScopeProvider()
  const result = await provider.createCompletion({
    model: req.model || DEFAULT_MODELS.helpdesk,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 1500,
    responseFormat: req.responseFormat,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: req.messages as any,
  })
  return {
    messageContent: result.messageContent,
    model: result.model,
  }
}

const QA_PROMPT = `You are an internal helpdesk assistant for a Hong Kong enterprise. Answer employee questions based ONLY on the provided policy documents. Be helpful, concise, and accurate.

Language: Respond in the same language as the question (Chinese or English).

Policy Sources:
---
{sources}
---

Question: {question}

If the answer IS found in the sources: provide a clear, concise answer and cite the article titles.
If the answer is NOT found in the sources: say "I cannot find this information in our knowledge base." and set needsEscalation to true.

Respond ONLY with valid JSON:
{ "answer": "...", "sources": [{"articleId": "...", "articleTitle": "...", "excerpt": "..."}], "confidence": 0.0-1.0, "needsEscalation": false, "suggestedDepartment": "HR|IT|ADMIN|FINANCE|GENERAL" }`

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "ask"
    const body = await request.json() as Record<string, unknown>

    switch (action) {
      case "ask": {
        const { question, department } = body
        if (!question || typeof question !== "string") {
          return NextResponse.json({ error: "question required" }, { status: 400 })
        }

        // Search knowledge base articles using vector search (with keyword fallback)
        const vectorAvailable = await checkPgVector()

        let articles: Array<{
          id: string
          title: string
          content: string
          knowledgeBaseName: string
          knowledgeBaseSlug: string
          department: string
          similarity?: number
        }> = []

        if (vectorAvailable) {
          try {
            const embedding = await generateEmbedding(question)

            let deptFilter = ""
            if (department && department !== "GENERAL") {
              deptFilter = `AND kb.department = '${department}'`
            }

            const rawResults = await prisma.$queryRaw<Array<{
              article_id: string
              title: string
              content: string
              kb_name: string
              kb_slug: string
              department: string
              similarity: number
            }>>`
              SELECT DISTINCT ON (ka.id)
                ka.id as article_id,
                ka.title,
                ka.content,
                kb.name as kb_name,
                kb.slug as kb_slug,
                kb.department,
                1 - (kc.embedding <=> ${embedding}::vector) as similarity
              FROM "KnowledgeChunk" kc
              JOIN "KnowledgeArticle" ka ON ka.id = kc.article_id
              JOIN "KnowledgeBase" kb ON kb.id = ka.knowledge_base_id
              WHERE kb.workspace_id = ${session.workspaceId}
              ORDER BY ka.id, kc.embedding <=> ${embedding}::vector
              LIMIT 5
            `

            articles = rawResults.map((r) => ({
              id: r.article_id,
              title: r.title,
              content: r.content,
              knowledgeBaseName: r.kb_name,
              knowledgeBaseSlug: r.kb_slug,
              department: r.department,
              similarity: Math.round(r.similarity * 100) / 100,
            }))
          } catch (err) {
            console.warn("Vector search failed, falling back to keyword search:", err)
          }
        }

        // Fallback to keyword search if vector unavailable or failed
        if (articles.length === 0) {
          const where: Record<string, unknown> = {
            workspaceId: session.workspaceId,
            OR: [
              { title: { contains: question } },
              { content: { contains: question } },
            ],
          }

          if (department && department !== "GENERAL") {
            where.knowledgeBase = {
              department: department as string,
            }
          }

          const articleResults = await prisma.knowledgeArticle.findMany({
            where,
            take: 5,
            orderBy: { updatedAt: "desc" },
            include: {
              knowledgeBase: {
                select: { name: true, slug: true, department: true },
              },
            },
          })

          // Also try broader search if no results
          let allArticles = articleResults
          if (allArticles.length === 0 && department && department !== "GENERAL") {
            allArticles = await prisma.knowledgeArticle.findMany({
              where: {
                knowledgeBase: { workspaceId: session.workspaceId },
                OR: [
                  { title: { contains: question } },
                  { content: { contains: question } },
                ],
              },
              take: 5,
              orderBy: { updatedAt: "desc" },
              include: {
                knowledgeBase: {
                  select: { name: true, slug: true, department: true },
                },
              },
            })
          }

          articles = allArticles.map((a) => ({
            id: a.id,
            title: a.title,
            content: a.content,
            knowledgeBaseName: a.knowledgeBase.name,
            knowledgeBaseSlug: a.knowledgeBase.slug,
            department: a.knowledgeBase.department,
          }))
        }

        // Build sources text using context articles from search
        const sourcesText = articles.length > 0
          ? articles.map((a, i) =>
              `[Article ${i + 1}] Title: ${a.title}\nDepartment: ${a.department}\nContent: ${a.content.slice(0, 1500)}${a.similarity !== undefined ? `\nRelevance: ${Math.round(a.similarity * 100)}%` : ""}`
            ).join("\n\n") + "\n\n---\nWhen answering, cite the article title(s) you used."
          : "No relevant policy documents found in the knowledge base."

        const prompt = QA_PROMPT
          .replace("{sources}", sourcesText)
          .replace("{question}", question)

        const result = await callAI({
          temperature: 0.3,
          maxTokens: 1500,
          responseFormat: "json",
          messages: [
            { role: "system", content: prompt },
          ],
        })

        let qaResult: {
          answer?: string
          sources?: Array<{ articleId: string; articleTitle: string; excerpt: string }>
          confidence?: number
          needsEscalation?: boolean
          suggestedDepartment?: string
        } = {}
        try {
          const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
          qaResult = JSON.parse(cleaned)
        } catch {
          qaResult = { answer: result.messageContent, confidence: 0.5, needsEscalation: false }
        }

        // Auto-create ticket if AI can't answer confidently
        if (qaResult.needsEscalation || (qaResult.confidence && qaResult.confidence < 0.6)) {
          const dept = (qaResult.suggestedDepartment || department || "GENERAL") as
            "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL"

          // Find matching knowledge base
          const kb = await prisma.knowledgeBase.findFirst({
            where: { workspaceId: session.workspaceId, department: department as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL" },
          })

          const ticket = await prisma.helpdeskTicket.create({
            data: {
              workspaceId: session.workspaceId,
              userId: session.sub,
              question: question,
              aiAnswer: qaResult.answer || null,
              aiConfidence: qaResult.confidence || null,
              aiSources: qaResult.sources || undefined,
              status: "OPEN",
              department: department as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL",
              knowledgeBaseId: kb?.id || null,
            },
          })

          await prisma.agentRun.create({
            data: {
              workspaceId: session.workspaceId,
              kind: "HELPDESK_QA",
              status: "COMPLETED",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              input: { question: question as string, department: department as string, searchMethod: vectorAvailable ? "vector" : "keyword" } as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              output: { ticketId: ticket.id, ...qaResult } as any,
            },
          })

          return NextResponse.json({
            answer: qaResult.answer || "I've created a ticket for this question. Our team will respond shortly.",
            sources: qaResult.sources || [],
            confidence: qaResult.confidence || 0,
            needsEscalation: true,
            suggestedDepartment: dept,
            ticketId: ticket.id,
          })
        }

        // Create AgentRun for successful answer
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            kind: "HELPDESK_QA",
            status: "COMPLETED",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input: { question: question as string, department: department as string } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: qaResult as any,
          },
        })

        return NextResponse.json({
          answer: qaResult.answer || "I found some information but could not formulate a clear answer.",
          sources: qaResult.sources || [],
          confidence: qaResult.confidence || 0.5,
          needsEscalation: false,
          suggestedDepartment: qaResult.suggestedDepartment || department || "GENERAL",
        })
      }

      case "ask-stream": {
        const { question: qStream, department: deptStream, model: modelStream } = body
        if (!qStream || typeof qStream !== "string") {
          return NextResponse.json({ error: "question required" }, { status: 400 })
        }

        // Same RAG search as "ask"
        const streamVectorAvailable = await checkPgVector()
        let streamArticles: Array<{
          id: string; title: string; content: string
          knowledgeBaseName: string; knowledgeBaseSlug: string
          department: string; similarity?: number
        }> = []

        if (streamVectorAvailable) {
          try {
            const streamEmbedding = await generateEmbedding(qStream)
            const rawStreamResults = await prisma.$queryRaw<Array<{
              article_id: string; title: string; content: string
              kb_name: string; kb_slug: string; department: string; similarity: number
            }>>`
              SELECT DISTINCT ON (ka.id)
                ka.id as article_id, ka.title, ka.content,
                kb.name as kb_name, kb.slug as kb_slug, kb.department,
                1 - (kc.embedding <=> ${streamEmbedding}::vector) as similarity
              FROM "KnowledgeChunk" kc
              JOIN "KnowledgeArticle" ka ON ka.id = kc.article_id
              JOIN "KnowledgeBase" kb ON kb.id = ka.knowledge_base_id
              WHERE kb.workspace_id = ${session.workspaceId}
              ORDER BY ka.id, kc.embedding <=> ${streamEmbedding}::vector
              LIMIT 5
            `
            streamArticles = rawStreamResults.map((r) => ({
              id: r.article_id, title: r.title, content: r.content,
              knowledgeBaseName: r.kb_name, knowledgeBaseSlug: r.kb_slug,
              department: r.department,
              similarity: Math.round(r.similarity * 100) / 100,
            }))
          } catch (err) {
            console.warn("Vector search failed for stream:", err)
          }
        }

        if (streamArticles.length === 0) {
          const articleResults = await prisma.knowledgeArticle.findMany({
            where: {
              knowledgeBase: { workspaceId: session.workspaceId },
              OR: [{ title: { contains: qStream } }, { content: { contains: qStream } }],
            },
            take: 5, orderBy: { updatedAt: "desc" },
            include: { knowledgeBase: { select: { name: true, slug: true, department: true } } },
          })
          streamArticles = articleResults.map((a) => ({
            id: a.id, title: a.title, content: a.content,
            knowledgeBaseName: a.knowledgeBase.name, knowledgeBaseSlug: a.knowledgeBase.slug,
            department: a.knowledgeBase.department,
          }))
        }

        const streamSourcesText = streamArticles.length > 0
          ? streamArticles.map((a, i) =>
              `[Article ${i + 1}] Title: ${a.title}\nDepartment: ${a.department}\nContent: ${a.content.slice(0, 1500)}${a.similarity !== undefined ? `\nRelevance: ${Math.round(a.similarity * 100)}%` : ""}`
            ).join("\n\n") + "\n\n---\nWhen answering, cite the article title(s) you used."
          : "No relevant policy documents found."

        const streamPrompt = QA_PROMPT
          .replace("{sources}", streamSourcesText)
          .replace("{question}", qStream)

        // SSE streaming
        const streamEncoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const sendSSE = (event: string, data: Record<string, unknown>) => {
              controller.enqueue(streamEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }
            try {
              sendSSE("trace", { trace: { id: "helpdesk-start", at: new Date().toISOString(), stage: "qa", status: "running", title: "Searching knowledge base", detail: `Found ${streamArticles.length} articles` } })

              const provider = getDashScopeProvider()
              let fullThinking = ""
              let fullContent = ""

              await provider.createStreamingCompletion(
                {
                  model: (modelStream as string) || DEFAULT_MODELS.helpdesk,
                  temperature: 0.3,
                  maxTokens: 1500,
                  responseFormat: "json",
                  messages: [{ role: "system", content: streamPrompt }],
                },
                {
                  onThinkingToken: (text) => {
                    fullThinking += text
                    sendSSE("thinking", { text })
                  },
                  onToken: (text) => {
                    fullContent += text
                    sendSSE("token", { text })
                  },
                }
              )

              // Parse result
              let qaStreamResult: Record<string, unknown> = {}
              try {
                const cleaned = fullContent.replace(/```json\s*|\s*```/g, "").trim()
                qaStreamResult = JSON.parse(cleaned)
              } catch {
                qaStreamResult = { answer: fullContent, confidence: 0.5, needsEscalation: false }
              }

              // Save AgentRun
              await prisma.agentRun.create({
                data: {
                  workspaceId: session.workspaceId,
                  kind: "HELPDESK_QA",
                  status: "COMPLETED",
                  input: { question: qStream, department: deptStream || "GENERAL" } as any,
                  output: { ...qaStreamResult, thinkingLength: fullThinking.length } as any,
                },
              })

              sendSSE("result", { result: qaStreamResult, thinkingProcess: fullThinking || undefined })
              controller.close()
            } catch (err) {
              sendSSE("error", { detail: err instanceof Error ? err.message : "Unknown error" })
              controller.close()
            }
          },
        })

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      }

      case "escalate": {
        const { question: q, department: dept } = body

        const kb = await prisma.knowledgeBase.findFirst({
          where: { workspaceId: session.workspaceId, department: (dept as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL") || "GENERAL" },
        })

        const ticket = await prisma.helpdeskTicket.create({
          data: {
            workspaceId: session.workspaceId,
            userId: session.sub,
            question: (q as string) || "Escalated question",
            status: "OPEN",
            department: (dept as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL") || "GENERAL",
            knowledgeBaseId: kb?.id || null,
          },
        })

        return NextResponse.json({ ticket }, { status: 201 })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error("Helpdesk agent API error:", error)
    return NextResponse.json({
      error: "Agent processing failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}
