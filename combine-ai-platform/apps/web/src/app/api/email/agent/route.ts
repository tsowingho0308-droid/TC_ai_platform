import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { getDashScopeProvider, DEFAULT_MODELS } from "@combine-ai/ai-provider"

export const dynamic = "force-dynamic"

/** Unified AI call via DashScope provider */
async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string | unknown[] }>
  tools?: unknown[]
}) {
  const provider = getDashScopeProvider()
  return provider.createCompletion({
    model: req.model || DEFAULT_MODELS.email,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 2000,
    responseFormat: req.responseFormat,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: req.messages as any,
    tools: req.tools as any,
  })
}

const WORK_TYPE_CLASSIFICATION_PROMPT = `You are an email classifier. Analyze the email and classify it into ONE of these work types:
- "commercial": Sales, procurement, contracts, billing, business deals, tenders, RFPs
- "it": Technical issues, bugs, integrations, API questions, hardware, software
- "hr": Personnel matters, hiring, onboarding, leave requests, training, policies

Also provide a 1-sentence summary, confidence score (0-1), and department routing suggestion.

Respond in JSON format: {"workType": "commercial|it|hr", "summary": "...", "confidence": 0.0-1.0, "department": "..."}`

const TRIAGE_DECOMPOSITION_PROMPT = `You are an enterprise email triage planner.
Break one incoming email into 1 to 6 actionable department tasks.

Departments allowed:
- commercial
- it
- hr

Rules:
- Return concise, non-overlapping tasks.
- Each task must include:
  - title: short title
  - body: concrete action request
  - department: one of commercial|it|hr
  - workType: one of commercial|it|hr
  - confidence: number from 0 to 1
  - quote: exact short quote copied from the email to justify this task
- Also include a top-level overallSummary and primaryWorkType.

Respond ONLY JSON:
{
  "overallSummary": "...",
  "primaryWorkType": "commercial|it|hr",
  "tasks": [
    {
      "title": "...",
      "body": "...",
      "department": "commercial|it|hr",
      "workType": "commercial|it|hr",
      "confidence": 0.0,
      "quote": "..."
    }
  ]
}`

type SupportedDepartment = "commercial" | "it" | "hr"

type ClassificationResult = {
  workType: SupportedDepartment
  summary: string
  confidence: number
  department: string
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeDepartment(value: string | undefined): SupportedDepartment {
  const raw = (value || "").toLowerCase().trim()
  if (raw === "it" || raw.includes("tech")) return "it"
  if (raw === "hr" || raw.includes("human")) return "hr"
  return "commercial"
}

function normalizeWorkType(value: string | undefined): SupportedDepartment {
  return normalizeDepartment(value)
}

function mapDepartmentToInboxSlug(department: SupportedDepartment): string {
  if (department === "it") return "it-support"
  if (department === "hr") return "hr"
  return "commercial"
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n < 0) return 0
  if (n > 1) return 1
  return n
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

  const ranked: Array<{ type: SupportedDepartment; score: number; department: string }> = [
    { type: "commercial" as const, score: commercialScore, department: "Commercial" },
    { type: "it" as const, score: itScore, department: "IT Support" },
    { type: "hr" as const, score: hrScore, department: "Human Resources" },
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

function routeSentenceToDepartment(sentence: string, defaultType: SupportedDepartment): SupportedDepartment {
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

function safeParseClassification(value: string): ClassificationResult | null {
  try {
    const parsed = JSON.parse(value) as {
      workType?: string
      summary?: string
      confidence?: number
      department?: string
    }
    const workType = normalizeWorkType(parsed.workType)
    return {
      workType,
      summary: normalizeText(parsed.summary || `Customer inquiry routed to ${parsed.department || workType}.`),
      confidence: clampConfidence(parsed.confidence, 0.6),
      department: normalizeText(parsed.department || workType),
    }
  } catch {
    return null
  }
}

function buildFallbackTriagePlan(subject: string, body: string, fallbackType: SupportedDepartment) {
  const sentences = splitSentences(body)
  const candidateSentences = sentences
    .filter((item) => item.includes("?") || item.length > 24)
    .slice(0, 6)

  const picked = (candidateSentences.length ? candidateSentences : [normalizeText(subject), normalizeText(body)])
    .filter(Boolean)
    .slice(0, 6)

  return {
    overallSummary: normalizeText(`Customer inquiry split into ${picked.length} department task(s).`),
    primaryWorkType: fallbackType,
    tasks: picked.map((sentence, index) => {
      const department = routeSentenceToDepartment(sentence, fallbackType)
      return {
        title: titleFromSentence(sentence),
        body: sentence,
        department,
        workType: department,
        confidence: clampConfidence(0.58 + index * 0.03, 0.6),
        quote: sentence,
      }
    }),
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

        const conversation = await prisma.conversation.findFirst({
          where: { id: conversationId, workspaceId: session.workspaceId },
          include: {
            messages: { orderBy: { createdAt: "asc" }, take: 1 },
          },
        })

        if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 })

        const emailBody = conversation.messages[0]?.bodyText || conversation.messages[0]?.body || ""
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

        const classification = safeParseClassification(aiResult.messageContent) ?? classifyWithRules(subject, emailBody)

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            workType: classification.workType,
            aiIntentSummary: classification.summary,
            aiRouteConfidence: classification.confidence,
            aiTriagedAt: new Date(),
            labels: [classification.workType],
          },
        })

        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            conversationId,
            kind: "TRIAGE",
            status: "COMPLETED",
            input: { subject, bodyPreview: emailBody.slice(0, 500) },
            output: {
              classification,
              mode: aiResult.messageContent ? "llm" : "rule-only",
            },
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

      case "triage": {
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
        if (conversation.parentConversationId) {
          return NextResponse.json({ error: "Cannot triage a child conversation" }, { status: 400 })
        }

        const sourceMessage = conversation.messages[0]
        const emailBody = sourceMessage?.bodyText || sourceMessage?.body || ""
        const subject = conversation.subject || ""

        const aiResult = await callAI({
          temperature: 0.2,
          maxTokens: 1500,
          responseFormat: "json",
          messages: [
            { role: "system", content: TRIAGE_DECOMPOSITION_PROMPT },
            { role: "user", content: `Subject: ${subject}\n\nBody: ${emailBody.slice(0, 6000)}` },
          ],
        })

        let parsed: {
          overallSummary?: string
          primaryWorkType?: string
          tasks?: Array<{
            title?: string
            body?: string
            department?: string
            workType?: string
            confidence?: number
            quote?: string
          }>
        }

        try {
          parsed = aiResult.messageContent
            ? JSON.parse(aiResult.messageContent)
            : buildFallbackTriagePlan(subject, emailBody, classifyWithRules(subject, emailBody).workType)
        } catch {
          parsed = buildFallbackTriagePlan(subject, emailBody, classifyWithRules(subject, emailBody).workType)
        }

        const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 6) : []
        const fallbackDepartment = normalizeWorkType(parsed.primaryWorkType)
        const effectiveTasks = rawTasks.length > 0
          ? rawTasks
          : [
              {
                title: subject ? `Follow up: ${subject}` : "General inquiry follow-up",
                body: emailBody.slice(0, 600) || "Please review and respond to this inquiry.",
                department: fallbackDepartment,
                workType: fallbackDepartment,
                confidence: 0.5,
                quote: emailBody.slice(0, 160),
              },
            ]

        const requestedDepartments = Array.from(
          new Set(effectiveTasks.map((task) => mapDepartmentToInboxSlug(normalizeDepartment(task.department || task.workType))))
        )
        const departmentInboxes = await prisma.inbox.findMany({
          where: {
            workspaceId: session.workspaceId,
            slug: { in: requestedDepartments },
          },
          select: { id: true, slug: true },
        })
        const inboxBySlug = new Map(departmentInboxes.map((inbox) => [inbox.slug, inbox.id]))

        await prisma.$transaction(async (tx) => {
          await tx.inquiryTask.deleteMany({
            where: {
              workspaceId: session.workspaceId,
              conversationId,
              origin: "AI",
            },
          })
          await tx.conversation.deleteMany({
            where: {
              workspaceId: session.workspaceId,
              parentConversationId: conversationId,
            },
          })

          const createdTasks: Array<{ id: string; title: string }> = []

          for (let i = 0; i < effectiveTasks.length; i += 1) {
            const task = effectiveTasks[i]
            const department = normalizeDepartment(task.department || task.workType)
            const workType = normalizeWorkType(task.workType || task.department)
            const targetInboxSlug = mapDepartmentToInboxSlug(department)
            const targetInboxId = inboxBySlug.get(targetInboxSlug) || conversation.inboxId
            const quote = (task.quote || "").trim().slice(0, 500)
            const quoteStart = quote ? emailBody.indexOf(quote) : -1

            const childConversation = await tx.conversation.create({
              data: {
                workspaceId: session.workspaceId,
                inboxId: targetInboxId,
                parentConversationId: conversationId,
                folderId: "inbox",
                status: "OPEN",
                subject: `[${department.toUpperCase()}] ${task.title || "Department follow-up"}`,
                senderName: conversation.senderName,
                senderEmail: conversation.senderEmail,
                preview: (task.body || "").slice(0, 180),
                replyTo: conversation.replyTo,
                departmentQuestionTitle: task.title || "Department follow-up",
                departmentQuestionBody: task.body || "Please review this request.",
                departmentReviewStatus: "DRAFT",
                workType,
                aiIntentSummary: (task.body || "").slice(0, 400),
                aiRouteConfidence: clampConfidence(task.confidence),
                aiTriagedAt: new Date(),
                labels: [workType, department],
              },
            })

            await tx.message.create({
              data: {
                workspaceId: session.workspaceId,
                conversationId: childConversation.id,
                direction: "NOTE",
                body: [
                  `Task: ${task.title || "Department follow-up"}`,
                  "",
                  task.body || "Please review this request.",
                  "",
                  quote ? `Quote evidence:\n"${quote}"` : "Quote evidence: (not provided)",
                ].join("\n"),
                bodyText: task.body || "Please review this request.",
              },
            })

            const inquiryTask = await tx.inquiryTask.create({
              data: {
                workspaceId: session.workspaceId,
                conversationId,
                inboxId: targetInboxId,
                sourceMessageId: sourceMessage?.id,
                childConversationId: childConversation.id,
                origin: "AI",
                status: "PENDING",
                questionTitle: task.title || "Department follow-up",
                questionBody: task.body || "Please review this request.",
                confidence: clampConfidence(task.confidence),
                reason: `Routed to ${department}`,
                sourceQuoteStart: quoteStart >= 0 ? quoteStart : null,
                sourceQuoteEnd: quoteStart >= 0 ? quoteStart + quote.length : null,
                sortOrder: i,
              },
            })

            createdTasks.push({ id: inquiryTask.id, title: inquiryTask.questionTitle })
          }

          await tx.conversation.update({
            where: { id: conversationId },
            data: {
              workType: normalizeWorkType(parsed.primaryWorkType),
              aiIntentSummary: parsed.overallSummary || null,
              aiRouteConfidence: effectiveTasks.length > 0
                ? effectiveTasks.reduce((sum, t) => sum + clampConfidence(t.confidence), 0) / effectiveTasks.length
                : 0.5,
              aiTriagedAt: new Date(),
              labels: Array.from(new Set(effectiveTasks.map((t) => normalizeWorkType(t.workType || t.department)))),
            },
          })

          await tx.agentRun.create({
            data: {
              workspaceId: session.workspaceId,
              conversationId,
              kind: "TRIAGE",
              status: "COMPLETED",
              input: { subject, bodyPreview: emailBody.slice(0, 500) },
              output: {
                summary: parsed.overallSummary || null,
                primaryWorkType: normalizeWorkType(parsed.primaryWorkType),
                taskCount: createdTasks.length,
                tasks: createdTasks,
              },
            },
          })
        })

        const refreshed = await prisma.conversation.findFirst({
          where: { id: conversationId, workspaceId: session.workspaceId },
          include: {
            inquiryTasks: {
              orderBy: { sortOrder: "asc" },
              include: { childConversation: { select: { id: true, subject: true, status: true } } },
            },
          },
        })

        return NextResponse.json({
          triage: {
            summary: refreshed?.aiIntentSummary || null,
            workType: refreshed?.workType || null,
            confidence: refreshed?.aiRouteConfidence ?? null,
            tasks: refreshed?.inquiryTasks || [],
          },
        })
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
