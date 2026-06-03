import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import type { CompletionRequest, CompletionResponse } from "@combine-ai/ai-provider"

export const dynamic = "force-dynamic"

// Simple AI provider call using Poe API (from existing email system pattern)
async function callAI(req: CompletionRequest): Promise<CompletionResponse> {
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
      max_tokens: req.maxTokens ?? 2000,
      tools: req.tools,
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
    toolCalls: (message?.tool_calls as Array<{
      id: string
      type: "function"
      function: { name: string; arguments: string }
    }>) || [],
    model,
  }
}

const WORK_TYPE_CLASSIFICATION_PROMPT = `You are an email classifier. Analyze the email and classify it into ONE of these work types:
- "commercial": Sales, procurement, contracts, billing, business deals, tenders, RFPs
- "it": Technical issues, bugs, integrations, API questions, hardware, software
- "hr": Personnel matters, hiring, onboarding, leave requests, training, policies

Also provide a 1-sentence summary, confidence score (0-1), and department routing suggestion.

Respond in JSON format: {"workType": "commercial|it|hr", "summary": "...", "confidence": 0.0-1.0, "department": "..."}`

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "classify"
    const body = await request.json() as Record<string, unknown>

    switch (action) {
      case "classify": {
        const { conversationId } = body
        if (!conversationId || typeof conversationId !== "string") {
          return NextResponse.json({ error: "conversationId required" }, { status: 400 })
        }

        const conversation = await prisma.conversation.findFirst({
          where: { id: conversationId, workspaceId: session.workspaceId },
          include: {
            messages: { orderBy: { createdAt: "asc" }, take: 1 },
          },
        })

        if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

        const emailBody = conversation.messages[0]?.bodyText || conversation.messages[0]?.body || ""
        const subject = conversation.subject || ""

        const result = await callAI({
          temperature: 0.3,
          maxTokens: 500,
          responseFormat: "json",
          messages: [
            { role: "system", content: WORK_TYPE_CLASSIFICATION_PROMPT },
            { role: "user", content: `Subject: ${subject}\n\nBody: ${emailBody.slice(0, 3000)}` },
          ],
        })

        const classification = JSON.parse(result.messageContent || "{}") as {
          workType?: string
          summary?: string
          confidence?: number
          department?: string
        }

        // Update conversation with classification
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            workType: classification.workType || null,
            aiIntentSummary: classification.summary || null,
            aiRouteConfidence: classification.confidence ?? null,
            aiTriagedAt: new Date(),
            labels: classification.workType ? [classification.workType] : [],
          },
        })

        // Create an AgentRun record
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            conversationId,
            kind: "TRIAGE",
            status: "COMPLETED",
            input: { subject, bodyPreview: emailBody.slice(0, 500) },
            output: classification,
          },
        })

        return NextResponse.json({ classification })
      }

      case "reply-suggestion": {
        const { conversationId } = body
        if (!conversationId || typeof conversationId !== "string") {
          return NextResponse.json({ error: "conversationId required" }, { status: 400 })
        }

        const conversation = await prisma.conversation.findFirst({
          where: { id: conversationId, workspaceId: session.workspaceId },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        })

        if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

        const emailThread = conversation.messages
          .map((m) => `${m.direction}: ${(m.bodyText || m.body || "").slice(0, 1000)}`)
          .join("\n---\n")

        const result = await callAI({
          temperature: 0.5,
          maxTokens: 1000,
          messages: [
            {
              role: "system",
              content: "You are a helpful email assistant. Draft a professional reply to the following email thread. Use the same language as the original email.",
            },
            { role: "user", content: emailThread },
          ],
        })

        const draftReply = result.messageContent || ""

        // Save as AgentSuggestion
        const suggestion = await prisma.agentSuggestion.create({
          data: {
            workspaceId: session.workspaceId,
            conversationId,
            status: "PENDING",
            title: "AI Reply Suggestion",
            draftReply,
            reason: "Generated by AI",
          },
        })

        return NextResponse.json({ suggestion })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error("Agent API error:", error)
    return NextResponse.json({
      error: "Agent processing failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}
