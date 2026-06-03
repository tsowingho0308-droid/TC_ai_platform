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

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  if (Number.isNaN(n)) return 0.5
  if (n < 0) return 0
  if (n > 1) return 1
  return n
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

        const parsed = JSON.parse(aiResult.messageContent || "{}") as {
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
