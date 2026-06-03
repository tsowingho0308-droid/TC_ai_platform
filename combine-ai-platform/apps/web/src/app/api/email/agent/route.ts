import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import type { CompletionRequest, CompletionResponse } from "@combine-ai/ai-provider"
import { InboxKind } from "@prisma/client"

export const dynamic = "force-dynamic"

// Simple AI provider call using Poe API (from existing email system pattern)
async function callAI(req: CompletionRequest): Promise<CompletionResponse> {
  const apiUrl = process.env.LLM_API_URL || "https://api.poe.com/v1"
  const apiKey = process.env.LLM_API_KEY || ""
  const model = req.model || process.env.LLM_MODEL || "Claude-Sonnet-4.5"

  if (!apiKey) {
    return {
      messageContent: "",
      toolCalls: [],
      model,
    }
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

type WorkType = "commercial" | "it" | "hr"

type ClassificationResult = {
  workType: WorkType
  summary: string
  confidence: number
  department: string
}

type DraftTriageTask = {
  targetDepartment: WorkType
  questionTitle: string
  questionBody: string
  reason: string
  confidence: number
  sourceQuote: string
}

function clampConfidence(value: number, fallback = 0.6) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function splitSentences(value: string) {
  return value
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean)
}

function titleFromSentence(sentence: string) {
  const cleaned = sentence.replace(/[?!.]+$/g, "").trim()
  if (!cleaned) return "Customer inquiry"
  if (cleaned.length <= 70) return cleaned
  return `${cleaned.slice(0, 67).trimEnd()}...`
}

function scoreWorkType(text: string, keywords: string[]) {
  const lower = text.toLowerCase()
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0)
}

function classifyWithRules(subject: string, body: string): ClassificationResult {
  const text = `${subject}\n${body}`
  const itScore = scoreWorkType(text, [
    "bug",
    "error",
    "api",
    "system",
    "integration",
    "login",
    "password",
    "software",
    "technical",
    "server",
  ])
  const hrScore = scoreWorkType(text, [
    "leave",
    "onboarding",
    "salary",
    "benefit",
    "recruit",
    "hiring",
    "staff",
    "policy",
    "holiday",
    "employee",
  ])
  const commercialScore = scoreWorkType(text, [
    "quote",
    "pricing",
    "invoice",
    "contract",
    "purchase",
    "procurement",
    "tender",
    "proposal",
    "payment",
    "business",
  ])

  const ranked: Array<{ type: WorkType; score: number; department: string }> = [
    { type: "commercial", score: commercialScore, department: "Commercial" },
    { type: "it", score: itScore, department: "IT Support" },
    { type: "hr", score: hrScore, department: "Human Resources" },
  ].sort((a, b) => b.score - a.score)

  const best = ranked[0]
  const second = ranked[1]
  const confidence = best.score === 0 ? 0.55 : clampConfidence(0.65 + (best.score - second.score) * 0.08, 0.62)

  return {
    workType: best.type,
    summary: normalizeText(`Customer inquiry routed to ${best.department}.`),
    confidence,
    department: best.department,
  }
}

function routeSentenceToDepartment(sentence: string, defaultType: WorkType): WorkType {
  const text = sentence.toLowerCase()
  if (
    /(bug|error|api|login|password|software|system|technical|server|integration)/.test(text)
  ) {
    return "it"
  }
  if (
    /(leave|onboarding|salary|benefit|recruit|hiring|staff|policy|holiday|employee)/.test(text)
  ) {
    return "hr"
  }
  if (
    /(quote|pricing|invoice|contract|purchase|procurement|tender|proposal|payment|business)/.test(text)
  ) {
    return "commercial"
  }
  return defaultType
}

function decomposeWithRules(subject: string, body: string, fallbackType: WorkType): DraftTriageTask[] {
  const sentences = splitSentences(body)
  const candidateSentences = sentences
    .filter((item) => item.includes("?") || item.length > 24)
    .slice(0, 6)

  const picked = (candidateSentences.length ? candidateSentences : [normalizeText(subject), normalizeText(body)])
    .filter(Boolean)
    .slice(0, 6)

  return picked.map((sentence, index) => {
    const targetDepartment = routeSentenceToDepartment(sentence, fallbackType)
    return {
      targetDepartment,
      questionTitle: titleFromSentence(sentence),
      questionBody: sentence,
      reason: `Auto-triaged to ${targetDepartment.toUpperCase()} based on keywords.`,
      confidence: clampConfidence(0.58 + index * 0.03, 0.6),
      sourceQuote: sentence,
    }
  })
}

function safeParseClassification(value: string): ClassificationResult | null {
  try {
    const parsed = JSON.parse(value) as {
      workType?: string
      summary?: string
      confidence?: number
      department?: string
    }
    if (parsed.workType !== "commercial" && parsed.workType !== "it" && parsed.workType !== "hr") {
      return null
    }
    return {
      workType: parsed.workType,
      summary: normalizeText(parsed.summary || ""),
      confidence: clampConfidence(parsed.confidence ?? 0.6, 0.6),
      department: normalizeText(parsed.department || "General"),
    }
  } catch {
    return null
  }
}

function findQuoteBounds(source: string, quote: string) {
  const normalized = quote.trim()
  if (!normalized) return null
  const start = source.indexOf(normalized)
  if (start < 0) return null
  return { start, end: start + normalized.length }
}

function chooseInboxId(
  department: WorkType,
  departmentInboxes: Array<{ id: string; slug: string; name: string }>
) {
  const slugMatchers: Record<WorkType, string[]> = {
    it: ["it-support", "it", "technical"],
    hr: ["hr", "human-resources", "human"],
    commercial: ["commercial", "sales", "business"],
  }
  const target = departmentInboxes.find((inbox) =>
    slugMatchers[department].some((matcher) => inbox.slug.includes(matcher) || inbox.name.toLowerCase().includes(matcher))
  )
  return target?.id ?? departmentInboxes[0]?.id ?? null
}

async function classifyAndTriageConversation(params: {
  workspaceId: string
  conversationId: string
}) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.conversationId, workspaceId: params.workspaceId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  })

  if (!conversation) {
    return { error: "Conversation not found", status: 404 as const }
  }

  const latestInboundMessage =
    [...conversation.messages].reverse().find((m) => m.direction === "INBOUND") ?? conversation.messages[conversation.messages.length - 1]
  const emailBody = latestInboundMessage?.bodyText || latestInboundMessage?.body || ""
  const subject = conversation.subject || ""

  const aiResult = await callAI({
    temperature: 0.3,
    maxTokens: 500,
    responseFormat: "json",
    messages: [
      { role: "system", content: WORK_TYPE_CLASSIFICATION_PROMPT },
      { role: "user", content: `Subject: ${subject}\n\nBody: ${emailBody.slice(0, 3000)}` },
    ],
  })

  const fallback = classifyWithRules(subject, emailBody)
  const classification = safeParseClassification(aiResult.messageContent) ?? fallback
  const taskDrafts = decomposeWithRules(subject, emailBody, classification.workType)

  const departmentInboxes = await prisma.inbox.findMany({
    where: {
      workspaceId: params.workspaceId,
      kind: InboxKind.DEPARTMENT,
    },
    select: {
      id: true,
      slug: true,
      name: true,
    },
    orderBy: { createdAt: "asc" },
  })

  const triageTasks = taskDrafts
    .map((task, index) => {
      const inboxId = chooseInboxId(task.targetDepartment, departmentInboxes)
      if (!inboxId) return null
      const quoteBounds = findQuoteBounds(emailBody, task.sourceQuote)
      return {
        workspaceId: params.workspaceId,
        conversationId: conversation.id,
        inboxId,
        sourceMessageId: latestInboundMessage?.id ?? null,
        origin: "AI" as const,
        status: "PENDING" as const,
        questionTitle: task.questionTitle,
        questionBody: task.questionBody,
        confidence: task.confidence,
        reason: task.reason,
        sourceQuoteStart: quoteBounds?.start ?? null,
        sourceQuoteEnd: quoteBounds?.end ?? null,
        sortOrder: index,
      }
    })
    .filter((task): task is NonNullable<typeof task> => Boolean(task))

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        workType: classification.workType,
        aiIntentSummary: classification.summary,
        aiRouteConfidence: classification.confidence,
        aiTriagedAt: new Date(),
        labels: [classification.workType],
      },
    })

    await tx.inquiryTask.deleteMany({
      where: {
        workspaceId: params.workspaceId,
        conversationId: conversation.id,
        origin: "AI",
      },
    })

    if (triageTasks.length > 0) {
      await tx.inquiryTask.createMany({
        data: triageTasks,
      })
    }

    await tx.agentRun.create({
      data: {
        workspaceId: params.workspaceId,
        conversationId: conversation.id,
        kind: "TRIAGE",
        status: "COMPLETED",
        input: { subject, bodyPreview: emailBody.slice(0, 500) },
        output: {
          classification,
          triageTaskCount: triageTasks.length,
          mode: aiResult.messageContent ? "llm+rule" : "rule-only",
        },
      },
    })
  })

  return {
    classification,
    triage: {
      taskCount: triageTasks.length,
      mode: aiResult.messageContent ? "llm+rule" : "rule-only",
    },
    status: 200 as const,
  }
}

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
        const result = await classifyAndTriageConversation({
          workspaceId: session.workspaceId,
          conversationId,
        })
        if ("error" in result) {
          return NextResponse.json({ error: result.error }, { status: result.status })
        }
        return NextResponse.json(result)
      }

      case "triage": {
        const { conversationId } = body
        if (!conversationId || typeof conversationId !== "string") {
          return NextResponse.json({ error: "conversationId required" }, { status: 400 })
        }
        const result = await classifyAndTriageConversation({
          workspaceId: session.workspaceId,
          conversationId,
        })
        if ("error" in result) {
          return NextResponse.json({ error: result.error }, { status: result.status })
        }
        return NextResponse.json(result)
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

        const latestInbound =
          [...conversation.messages].reverse().find((m) => m.direction === "INBOUND")?.bodyText ||
          [...conversation.messages].reverse().find((m) => m.direction === "INBOUND")?.body ||
          conversation.preview
        const fallbackDraft = [
          `Subject: Re: ${conversation.subject}`,
          "",
          `Hi ${conversation.senderName || "there"},`,
          "",
          "Thank you for your email.",
          "We have received your request and our team is reviewing the details now.",
          "",
          `Summary we captured: ${normalizeText(latestInbound).slice(0, 240)}`,
          "",
          "We will get back to you with a concrete update shortly.",
          "",
          "Best regards,",
          "Combine AI Team",
        ].join("\n")
        const draftReply = result.messageContent?.trim() || fallbackDraft

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
