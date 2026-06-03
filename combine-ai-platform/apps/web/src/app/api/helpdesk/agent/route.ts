import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string }>
}) {
  const apiUrl = process.env.LLM_API_URL || "https://api.poe.com/v1"
  const apiKey = process.env.LLM_API_KEY || ""
  const model = req.model || process.env.LLM_MODEL || "Claude-Sonnet-4.5"

  if (!apiKey) {
    throw new Error("LLM_API_KEY not configured. Set it in .env.local")
  }

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 1500,
      response_format: req.responseFormat === "json" ? { type: "json_object" } : undefined,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`AI provider error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as Record<string, unknown>
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
  const message = choice?.message as Record<string, unknown> | undefined

  return {
    messageContent: (message?.content as string) || "",
    model,
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

        // Search knowledge base articles
        const where: Record<string, unknown> = {
          workspaceId: session.workspaceId,
          OR: [
            { title: { contains: question } },
            { content: { contains: question } },
          ],
        }

        // Filter by department knowledge base if specified
        if (department && department !== "GENERAL") {
          where.knowledgeBase = {
            department: department as string,
          }
        }

        const articles = await prisma.knowledgeArticle.findMany({
          where,
          take: 5,
          orderBy: { updatedAt: "desc" },
        })

        // Also try broader search if no results
        let allArticles = articles
        if (allArticles.length === 0 && department && department !== "GENERAL") {
          allArticles = await prisma.knowledgeArticle.findMany({
            where: {
              OR: [
                { title: { contains: question } },
                { content: { contains: question } },
              ],
            },
            take: 5,
            orderBy: { updatedAt: "desc" },
          })
        }

        // Build sources text
        const sourcesText = allArticles.length > 0
          ? allArticles.map((a, i) =>
              `[Article ${i + 1}] Title: ${a.title}\nContent: ${a.content.slice(0, 1500)}`
            ).join("\n\n")
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
              input: { question: question as string, department: department as string } as any,
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
