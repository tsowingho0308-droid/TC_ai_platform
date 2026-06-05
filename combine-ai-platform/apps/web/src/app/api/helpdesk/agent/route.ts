import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { getDashScopeProvider, DEFAULT_MODELS } from "@combine-ai/ai-provider"
import type { ChatMessage, ToolDefinition } from "@combine-ai/ai-provider"
import {
  searchKnowledgeBase,
  checkPgVector,
  formatSourcesText,
  type SearchResult,
} from "@/features/helpdesk/api/helpdesk-search"
import { parseAIJson } from "@/lib/server/parse-json"

export const dynamic = "force-dynamic"

// ── AI Call Wrapper ──────────────────────────────────────────────

async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  messages: ChatMessage[]
  tools?: ToolDefinition[]
}) {
  const provider = getDashScopeProvider()
  const result = await provider.createCompletion({
    model: req.model || DEFAULT_MODELS.helpdesk,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 2000,
    messages: req.messages,
    tools: req.tools,
  })
  return {
    messageContent: result.messageContent,
    toolCalls: result.toolCalls,
    model: result.model,
  }
}

// ── System Prompt ────────────────────────────────────────────────

const HELPDESK_SYSTEM_PROMPT = `You are a professional internal helpdesk assistant for a Hong Kong enterprise. Your name is "Combine AI Helpdesk". You help employees find information from company policies and procedures, answer their questions, and escalate issues when necessary.

## Personality & Tone
- Professional, friendly, and respectful — treat every employee with patience
- Respond in the SAME LANGUAGE as the user (Traditional Chinese / Cantonese style for Chinese, or English)
- Be concise but thorough — give enough detail to be genuinely helpful
- If unsure, be honest: state what you know AND what you cannot confirm
- Use bullet points for lists, keep paragraphs short for readability

## Behavior Rules
- Answer based ONLY on the provided knowledge sources and search results
- If the answer IS found in sources: provide a clear answer and cite the article title(s)
- If the answer is NOT found: clearly state that, explain what information is missing, and recommend escalation
- NEVER fabricate policies, procedures, numbers, or deadlines
- NEVER disclose confidential information about other employees
- When an employee seems frustrated, acknowledge their feelings and offer to escalate

## Escalation Triggers
Call create_ticket when ANY of these are true:
1. The question cannot be answered from available knowledge sources
2. The question requires human judgment or approval (exceptions, discretionary decisions, appeals)
3. The employee explicitly asks to speak to a human
4. The question involves sensitive personal data (salary, discipline, performance reviews, medical)
5. After 2+ follow-up questions, the issue remains unresolved and needs hands-on support

## Required Reading for Process Questions
When the user asks about a multi-step business process (onboarding, leave application, procurement, IT setup, etc.):
1. Check if any result is marked as PLAYBOOK or PROCESS_MAP — these are navigation documents that describe complete processes
2. If a playbook exists for the process, list its recommended steps IN ORDER
3. Include a "requiredReading" array in your JSON response containing all documents referenced by the playbook
4. Present each process step with the specific article/source that covers it in detail

## Context-Aware Answering
- If results contain PLAYBOOK or PROCESS_MAP documents, follow their guidance as the authoritative source
- If only GENERAL department articles match but the user's department is specific (HR, IT, etc.), DO NOT say "not found"
- Instead: present the GENERAL information as a starting point, note it may vary by department, and suggest escalation for department-specific confirmation
- If ALL search results come from GENERAL KB and the user is in a specific department, acknowledge this and recommend checking department-specific policies

## Available Tools
You have access to tools. Use them proactively:
- **search_knowledge_base**: Search for relevant policies and procedures. Use this when the initial context does NOT contain the answer. Provide a specific search query. **IMPORTANT: Only call this ONCE. If it returns no results, do NOT search again — tell the user the information is not in the knowledge base and call create_ticket.**
- **create_ticket**: Escalate to a human team. Include a clear reason for escalation and any partial answer you've gathered.
- **check_ticket_status**: Look up the current status of an existing ticket by its ID.

## Current Knowledge Context
{sources}

## Final Response Format
After using any necessary tools, provide your final answer as a JSON object with this shape:
{
  "answer": "Your detailed answer to the employee (markdown allowed for formatting)",
  "sources": [{"articleId": "...", "articleTitle": "...", "excerpt": "..."}],
  "confidence": 0.0-1.0,
  "needsEscalation": false,
  "suggestedDepartment": "HR|IT|ADMIN|FINANCE|GENERAL",
  "requiredReading": [{"articleId": "...", "articleTitle": "...", "reason": "Why this document is needed"}],
  "processSteps": [{"step": 1, "title": "...", "description": "...", "sourceArticleTitle": "..."}]
}

Include "requiredReading" when the answer depends on multiple documents (e.g., playbook references).
Include "processSteps" ONLY when answering a multi-step process question and a playbook/process map was found.`

// ── Legacy Prompt (kept for backward-compatible ask/ask-stream) ──

const QA_PROMPT = HELPDESK_SYSTEM_PROMPT

// ── Tool Definitions ─────────────────────────────────────────────

const SEARCH_KB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_knowledge_base",
    description:
      "Search the company knowledge base for policies, procedures, and information relevant to the employee's question. Use this when the pre-loaded context doesn't have the answer, or when the employee asks about a topic not covered in the initial sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Specific search query — use key terms from the employee's question",
        },
        department: {
          type: "string",
          enum: ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"],
          description: "Optional department to narrow the search",
        },
      },
      required: ["query"],
    },
  },
}

const CREATE_TICKET_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_ticket",
    description:
      "Create an escalation ticket when the question cannot be fully answered from knowledge sources, requires human judgment, or the employee explicitly asks to speak to a human. Call this INSTEAD of setting needsEscalation=true in the JSON response.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The employee's original question or request",
        },
        department: {
          type: "string",
          enum: ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"],
          description: "Which department should handle this escalation",
        },
        reason: {
          type: "string",
          description:
            "Clear explanation of why this needs human intervention (e.g., 'policy not found in KB', 'requires manager approval')",
        },
        aiAnswer: {
          type: "string",
          description: "Any partial answer or context you've already gathered for the employee",
        },
      },
      required: ["question", "department", "reason"],
    },
  },
}

const CHECK_TICKET_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "check_ticket_status",
    description:
      "Check the current status of an existing helpdesk ticket. Use when an employee asks about a previously created ticket.",
    parameters: {
      type: "object",
      properties: {
        ticketId: {
          type: "string",
          description: "The full ticket ID to look up (e.g., 'cm1234567890abc')",
        },
      },
      required: ["ticketId"],
    },
  },
}

const HELPDESK_TOOLS = [SEARCH_KB_TOOL, CREATE_TICKET_TOOL, CHECK_TICKET_TOOL]

// ── Tool Execution ───────────────────────────────────────────────

interface ToolCallResult {
  result: unknown
  messages: ChatMessage[]
}

async function executeToolCall(
  toolCall: NonNullable<Awaited<ReturnType<typeof callAI>>["toolCalls"]>[number],
  session: { workspaceId: string; sub: string }
): Promise<ToolCallResult> {
  const fn = toolCall.function
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(fn.arguments)
  } catch {
    return {
      result: null,
      messages: [
        {
          role: "tool" as const,
          toolCallId: toolCall.id,
          name: fn.name,
          content: JSON.stringify({ error: "Invalid JSON arguments" }),
        },
      ],
    }
  }

  switch (fn.name) {
    // ── search_knowledge_base ──
    case "search_knowledge_base": {
      const { articles, searchMethod } = await searchKnowledgeBase(
        args.query as string,
        {
          workspaceId: session.workspaceId,
          department: args.department as string | undefined,
          topK: 5,
          minSimilarity: 0.7,
        }
      )

      // If no results, tell the AI to NOT search again — go straight to create_ticket
      const noResultsHint =
        articles.length === 0
          ? "IMPORTANT: No results found. Do NOT call search_knowledge_base again. Instead, call create_ticket to escalate to a human team."
          : ""

      // Context-aware: detect when all results are from GENERAL KB
      const userDept = (args.department as string) || "GENERAL"
      const allFromGeneral = articles.length > 0 && articles.every((a) => a.department === "GENERAL")
      const contextAwareHint =
        allFromGeneral && userDept !== "GENERAL"
          ? `NOTE: All ${articles.length} results are from the GENERAL knowledge base. The user's context is ${userDept}. Present these as general guidance and mention that ${userDept}-specific policies may differ. Recommend checking with ${userDept} department for full accuracy.`
          : ""

      // Resolve linked articles for playbooks
      let playbookContext: Record<string, unknown> | undefined
      const playbookArticle = articles.find(
        (a) => a.documentType === "PLAYBOOK" || a.documentType === "PROCESS_MAP"
      )
      if (playbookArticle) {
        try {
          const fullArticle = await prisma.knowledgeArticle.findUnique({
            where: { id: playbookArticle.id },
            select: { linkedArticleIds: true, businessProcesses: true },
          })
          if (fullArticle?.linkedArticleIds?.length) {
            const linkedArticles = await prisma.knowledgeArticle.findMany({
              where: { id: { in: fullArticle.linkedArticleIds } },
              select: { id: true, title: true, documentType: true },
            })
            playbookContext = {
              playbookTitle: playbookArticle.title,
              playbookId: playbookArticle.id,
              businessProcesses: fullArticle.businessProcesses || [],
              requiredReading: linkedArticles.map((la) => ({
                articleId: la.id,
                articleTitle: la.title,
                documentType: la.documentType,
              })),
            }
          }
        } catch (err) {
          console.warn("Failed to resolve playbook linked articles:", err)
        }
      }

      const resultContent: Record<string, unknown> = {
        query: args.query,
        totalResults: articles.length,
        searchMethod,
        noResultsHint: noResultsHint || undefined,
        contextAwareHint: contextAwareHint || undefined,
        playbookContext: playbookContext || undefined,
        results: articles.map((a) => ({
          id: a.id,
          title: a.title,
          content: a.content.slice(0, 2000),
          department: a.department,
          knowledgeBaseName: a.knowledgeBaseName,
          similarity: a.similarity,
          documentType: a.documentType,
          businessProcesses: a.businessProcesses,
        })),
      }

      return {
        result: articles,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    // ── create_ticket ──
    case "create_ticket": {
      const dep = (args.department as string) || "GENERAL"
      const validDepartments = ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"]

      let kb = null
      try {
        kb = await prisma.knowledgeBase.findFirst({
          where: {
            workspaceId: session.workspaceId,
            department: validDepartments.includes(dep)
              ? (dep as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL")
              : "GENERAL",
          },
        })
      } catch {
        // KB lookup is best-effort
      }

      const ticket = await prisma.helpdeskTicket.create({
        data: {
          workspaceId: session.workspaceId,
          userId: session.sub,
          question: (args.question as string) || "Escalated from Helpdesk",
          aiAnswer: (args.aiAnswer as string) || null,
          aiConfidence: null,
          status: "OPEN",
          department: validDepartments.includes(dep)
            ? (dep as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL")
            : "GENERAL",
          knowledgeBaseId: kb?.id || null,
        },
      })

      const shortId = ticket.id.slice(0, 8)
      const resultContent = {
        ticketId: ticket.id,
        status: "OPEN",
        message: `Ticket #${shortId} has been created. The ${dep} team will follow up with you. You can reference ticket ID ${shortId} to check status later.`,
      }

      return {
        result: ticket,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    // ── check_ticket_status ──
    case "check_ticket_status": {
      const ticketId = args.ticketId as string
      const ticket = await prisma.helpdeskTicket.findFirst({
        where: { id: ticketId, workspaceId: session.workspaceId },
        select: {
          id: true,
          status: true,
          department: true,
          question: true,
          humanReply: true,
          createdAt: true,
          resolvedAt: true,
        },
      })

      const resultContent = ticket
        ? {
            found: true,
            ticketId: ticket.id,
            shortId: ticket.id.slice(0, 8),
            status: ticket.status,
            department: ticket.department,
            question: ticket.question.slice(0, 200),
            humanReply: ticket.humanReply?.slice(0, 500) || null,
            createdAt: ticket.createdAt,
            resolvedAt: ticket.resolvedAt,
          }
        : {
            found: false,
            message: `No ticket found with ID "${ticketId}". Please double-check the ID and try again.`,
          }

      return {
        result: ticket,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    default:
      return {
        result: null,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify({ error: `Unknown tool: ${fn.name}` }),
          },
        ],
      }
  }
}

// ── Result Parsing ───────────────────────────────────────────────

function parseJsonResult(content: string): Record<string, unknown> {
  const parsed = parseAIJson(content)
  return parsed ?? { answer: content, confidence: 0.5, needsEscalation: false }
}

// ── POST Handler ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "ask"
    const body = (await request.json()) as Record<string, unknown>

    // ══════════════════════════════════════════════════════════════
    // Legacy: ask (non-streaming, no tools, backward-compatible)
    // ══════════════════════════════════════════════════════════════
    switch (action) {
      case "ask": {
        const { question, department } = body
        if (!question || typeof question !== "string") {
          return NextResponse.json({ error: "question required" }, { status: 400 })
        }

        const { articles, searchMethod } = await searchKnowledgeBase(question, {
          workspaceId: session.workspaceId,
          department: department as string | undefined,
          topK: 5,
        })

        const sourcesText = formatSourcesText(articles)
        const prompt = QA_PROMPT.replace("{sources}", sourcesText).replace(
          "{question}",
          question
        )

        const result = await callAI({
          temperature: 0.3,
          maxTokens: 1500,
          messages: [{ role: "system", content: prompt }],
        })

        let qaResult: Record<string, unknown> = {}
        try {
          qaResult = parseJsonResult(result.messageContent)
        } catch {
          qaResult = {
            answer: result.messageContent,
            confidence: 0.5,
            needsEscalation: false,
          }
        }

        // Auto-create ticket if AI can't answer confidently
        if (
          qaResult.needsEscalation ||
          (qaResult.confidence && Number(qaResult.confidence) < 0.6)
        ) {
          const dept = (qaResult.suggestedDepartment || department || "GENERAL") as string
          const validDepartments = ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"]
          const safeDept = validDepartments.includes(dept)
            ? (dept as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL")
            : "GENERAL"

          let kb = null
          try {
            kb = await prisma.knowledgeBase.findFirst({
              where: {
                workspaceId: session.workspaceId,
                department: safeDept,
              },
            })
          } catch {
            // best-effort
          }

          const ticket = await prisma.helpdeskTicket.create({
            data: {
              workspaceId: session.workspaceId,
              userId: session.sub,
              question: question,
              aiAnswer: (qaResult.answer as string) || null,
              aiConfidence: qaResult.confidence ? Number(qaResult.confidence) : null,
              aiSources: qaResult.sources || undefined,
              status: "OPEN",
              department: safeDept,
              knowledgeBaseId: kb?.id || null,
            },
          })

          await prisma.agentRun.create({
            data: {
              workspaceId: session.workspaceId,
              kind: "HELPDESK_QA",
              status: "COMPLETED",
              input: {
                question: question as string,
                department: department as string,
                searchMethod,
              } as any,
              output: { ticketId: ticket.id, ...qaResult } as any,
            },
          })

          return NextResponse.json({
            answer:
              (qaResult.answer as string) ||
              "A ticket has been created. Our team will respond shortly.",
            sources: qaResult.sources || [],
            confidence: qaResult.confidence || 0,
            needsEscalation: true,
            suggestedDepartment: dept,
            ticketId: ticket.id,
          })
        }

        // Successful answer
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            kind: "HELPDESK_QA",
            status: "COMPLETED",
            input: {
              question: question as string,
              department: department as string,
              searchMethod,
            } as any,
            output: qaResult as any,
          },
        })

        return NextResponse.json({
          answer:
            (qaResult.answer as string) ||
            "I found some information but could not formulate a clear answer.",
          sources: qaResult.sources || [],
          confidence: qaResult.confidence || 0.5,
          needsEscalation: false,
          suggestedDepartment: qaResult.suggestedDepartment || department || "GENERAL",
        })
      }

      // ══════════════════════════════════════════════════════════
      // Legacy: ask-stream (streaming, no tools, backward-compatible)
      // ══════════════════════════════════════════════════════════
      case "ask-stream": {
        const {
          question: qStream,
          department: deptStream,
          model: modelStream,
        } = body
        if (!qStream || typeof qStream !== "string") {
          return NextResponse.json({ error: "question required" }, { status: 400 })
        }

        const { articles: streamArticles, searchMethod: streamSearchMethod } =
          await searchKnowledgeBase(qStream, {
            workspaceId: session.workspaceId,
            department: deptStream as string | undefined,
            topK: 5,
          })

        const streamSourcesText = formatSourcesText(streamArticles)
        const streamPrompt = QA_PROMPT.replace(
          "{sources}",
          streamSourcesText
        ).replace("{question}", qStream)

        // SSE streaming
        const streamEncoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const sendSSE = (event: string, data: Record<string, unknown>) => {
              controller.enqueue(
                streamEncoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                )
              )
            }
            try {
              sendSSE("trace", {
                trace: {
                  id: "helpdesk-start",
                  at: new Date().toISOString(),
                  stage: "qa",
                  status: "running",
                  title: "Searching knowledge base",
                  detail: `Found ${streamArticles.length} articles`,
                },
              })

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

              let qaStreamResult: Record<string, unknown> = {}
              try {
                qaStreamResult = parseJsonResult(fullContent)
              } catch {
                qaStreamResult = {
                  answer: fullContent,
                  confidence: 0.5,
                  needsEscalation: false,
                }
              }

              // Save AgentRun
              await prisma.agentRun.create({
                data: {
                  workspaceId: session.workspaceId,
                  kind: "HELPDESK_QA",
                  status: "COMPLETED",
                  input: {
                    question: qStream,
                    department: deptStream || "GENERAL",
                    searchMethod: streamSearchMethod,
                  } as any,
                  output: {
                    ...qaStreamResult,
                    thinkingLength: fullThinking.length,
                  } as any,
                },
              })

              sendSSE("result", {
                result: qaStreamResult,
                thinkingProcess: fullThinking || undefined,
              })
              controller.close()
            } catch (err) {
              sendSSE("error", {
                detail: err instanceof Error ? err.message : "Unknown error",
              })
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

      // ══════════════════════════════════════════════════════════
      // Legacy: escalate (no AI, just creates ticket)
      // ══════════════════════════════════════════════════════════
      case "escalate": {
        const { question: q, department: dept } = body

        const kb = await prisma.knowledgeBase.findFirst({
          where: {
            workspaceId: session.workspaceId,
            department: (dept as
              | "HR"
              | "IT"
              | "ADMIN"
              | "FINANCE"
              | "GENERAL") || "GENERAL",
          },
        })

        const ticket = await prisma.helpdeskTicket.create({
          data: {
            workspaceId: session.workspaceId,
            userId: session.sub,
            question: (q as string) || "Escalated question",
            status: "OPEN",
            department: (dept as
              | "HR"
              | "IT"
              | "ADMIN"
              | "FINANCE"
              | "GENERAL") || "GENERAL",
            knowledgeBaseId: kb?.id || null,
          },
        })

        return NextResponse.json({ ticket }, { status: 201 })
      }

      // ══════════════════════════════════════════════════════════
      // NEW: chat (non-streaming, tool-enabled, multi-turn)
      // ══════════════════════════════════════════════════════════
      case "chat": {
        const {
          messages: rawMessages,
          department,
          conversationId,
          model: chatModel,
        } = body as {
          messages?: Array<{ role: string; content: string }>
          department?: string
          conversationId?: string
          model?: string
        }

        if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
          return NextResponse.json(
            { error: "messages array required" },
            { status: 400 }
          )
        }

        // ── Conversation management ──────────────────────────
        let convId = conversationId

        // Try to find existing conversation
        if (convId) {
          const existing = await prisma.helpdeskConversation.findFirst({
            where: { id: convId, workspaceId: session.workspaceId },
          })
          if (!existing) {
            // Conversation not found — create new
            convId = undefined
          }
        }

        if (!convId) {
          const lastUserMsg = [...rawMessages]
            .reverse()
            .find((m: { role: string }) => m.role === "user")
          const conv = await prisma.helpdeskConversation.create({
            data: {
              workspaceId: session.workspaceId,
              userId: session.sub,
              title:
                typeof lastUserMsg?.content === "string"
                  ? lastUserMsg.content.slice(0, 100)
                  : "Helpdesk Query",
              department:
                department === "HR" ||
                department === "IT" ||
                department === "ADMIN" ||
                department === "FINANCE"
                  ? department
                  : "GENERAL",
            },
          })
          convId = conv.id
        }

        // ── Pre-load context from KB ─────────────────────────
        const lastUserMsg = [...rawMessages]
          .reverse()
          .find((m: { role: string }) => m.role === "user")
        const userQuestion =
          typeof lastUserMsg?.content === "string" ? lastUserMsg.content : ""

        const { articles } = userQuestion
          ? await searchKnowledgeBase(userQuestion, {
              workspaceId: session.workspaceId,
              department: department as string | undefined,
              topK: 5,
              minSimilarity: 0.7,
            })
          : { articles: [] as SearchResult[] }

        const sourcesText = formatSourcesText(articles)
        const departmentCoverage = [...new Set(articles.map((a) => a.department))]
        const deptContext =
          departmentCoverage.length > 0
            ? `\n\n## Search Context\nDepartments with matching results: ${departmentCoverage.join(", ")}\nUser's selected department: ${department || "GENERAL"}`
            : ""
        const systemPrompt =
          HELPDESK_SYSTEM_PROMPT.replace("{sources}", sourcesText) + deptContext

        // ── Build AI messages ────────────────────────────────
        const aiMessages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          ...rawMessages.map(
            (m: { role: string; content: string }) =>
              ({ role: m.role as ChatMessage["role"], content: m.content })
          ),
        ]

        // ── Tool-calling loop ────────────────────────────────
        let rounds = 0
        const MAX_ROUNDS = 3
        let finalContent = ""
        let searchedKnowledgeBase = false
        // Dynamic tools: remove search_kb after first use to prevent loops
        let activeTools = [...HELPDESK_TOOLS]

        while (rounds < MAX_ROUNDS) {
          rounds++

          const result = await callAI({
            model: chatModel,
            temperature: 0.3,
            maxTokens: 2000,
            messages: aiMessages,
            tools: activeTools.length > 0 ? activeTools : undefined,
          })

          // No tool calls → final answer
          if (!result.toolCalls || result.toolCalls.length === 0) {
            finalContent = result.messageContent
            break
          }

          // Append assistant message with tool calls
          aiMessages.push({
            role: "assistant",
            content: result.messageContent || "",
            toolCalls: result.toolCalls,
          } as ChatMessage)

          // Execute each tool call and append results
          for (const tc of result.toolCalls) {
            // Track searches — remove tool after first use to prevent loops
            if (tc.function.name === "search_knowledge_base") {
              searchedKnowledgeBase = true
              activeTools = activeTools.filter(
                (t) => t.function.name !== "search_knowledge_base"
              )
            }
            const { messages: toolResultMessages } = await executeToolCall(
              tc,
              session
            )
            aiMessages.push(...toolResultMessages)
          }
        }

        if (!finalContent && rounds >= MAX_ROUNDS) {
          // Max rounds exceeded — return partial
          finalContent =
            aiMessages[aiMessages.length - 1]?.role === "assistant"
              ? (aiMessages[aiMessages.length - 1].content as string)
              : "I could not find the information you need in our knowledge base. A ticket has been or will be created for your question."
        }

        const qaResult = parseJsonResult(finalContent)

        // ── Log AgentRun ─────────────────────────────────────
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            kind: "HELPDESK_QA",
            status: "COMPLETED",
            input: {
              messagesCount: rawMessages.length,
              rounds,
              toolsUsed: rounds > 1,
              department: department || "GENERAL",
            } as any,
            output: qaResult as any,
          },
        })

        return NextResponse.json({
          conversationId: convId,
          answer: qaResult.answer || "I could not process this question.",
          sources: qaResult.sources ||
            articles.map((a) => ({
              articleId: a.id,
              articleTitle: a.title,
              excerpt: a.content.slice(0, 200),
            })),
          confidence: qaResult.confidence || 0.5,
          needsEscalation: qaResult.needsEscalation || false,
          suggestedDepartment:
            qaResult.suggestedDepartment || department || "GENERAL",
        })
      }

      // ══════════════════════════════════════════════════════════
      // NEW: chat-stream (streaming, tool-enabled, multi-turn)
      // ══════════════════════════════════════════════════════════
      case "chat-stream": {
        const {
          messages: rawStreamMessages,
          department: streamDept,
          conversationId: streamConvId,
          model: streamModel,
        } = body as {
          messages?: Array<{ role: string; content: string }>
          department?: string
          conversationId?: string
          model?: string
        }

        if (
          !rawStreamMessages ||
          !Array.isArray(rawStreamMessages) ||
          rawStreamMessages.length === 0
        ) {
          return NextResponse.json(
            { error: "messages array required" },
            { status: 400 }
          )
        }

        const streamEncoder = new TextEncoder()
        const stream = new ReadableStream({
          async start(controller) {
            const sendSSE = (event: string, data: Record<string, unknown>) => {
              controller.enqueue(
                streamEncoder.encode(
                  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                )
              )
            }

            try {
              // ── Conversation management ────────────────────
              let convId = streamConvId as string | undefined
              if (convId) {
                const existing = await prisma.helpdeskConversation.findFirst({
                  where: { id: convId, workspaceId: session.workspaceId },
                })
                if (!existing) convId = undefined
              }
              if (!convId) {
                const lastMsg = [...rawStreamMessages]
                  .reverse()
                  .find((m: { role: string }) => m.role === "user")
                const conv = await prisma.helpdeskConversation.create({
                  data: {
                    workspaceId: session.workspaceId,
                    userId: session.sub,
                    title:
                      typeof lastMsg?.content === "string"
                        ? lastMsg.content.slice(0, 100)
                        : "Helpdesk Query",
                    department:
                      streamDept === "HR" ||
                      streamDept === "IT" ||
                      streamDept === "ADMIN" ||
                      streamDept === "FINANCE"
                        ? streamDept
                        : "GENERAL",
                  },
                })
                convId = conv.id
              }

              // ── Pre-load context from KB ───────────────────
              sendSSE("trace", {
                trace: {
                  id: "conv-start",
                  at: new Date().toISOString(),
                  stage: "search",
                  status: "running",
                  title: "Searching knowledge base...",
                },
              })

              const lastUserMsg = [...rawStreamMessages]
                .reverse()
                .find((m: { role: string }) => m.role === "user")
              const userQuestion =
                typeof lastUserMsg?.content === "string"
                  ? lastUserMsg.content
                  : ""

              const { articles } = userQuestion
                ? await searchKnowledgeBase(userQuestion, {
                    workspaceId: session.workspaceId,
                    department: streamDept as string | undefined,
                    topK: 5,
                    minSimilarity: 0.7,
                  })
                : { articles: [] as SearchResult[] }

              sendSSE("trace", {
                trace: {
                  id: "conv-start",
                  at: new Date().toISOString(),
                  stage: "search",
                  status: "complete",
                  title: `Found ${articles.length} relevant article${articles.length !== 1 ? "s" : ""}`,
                  detail: articles.map((a) => a.title).join(", ") || "None",
                },
              })

              const sourcesText = formatSourcesText(articles)
              const deptCoverage = [...new Set(articles.map((a) => a.department))]
              const deptCtx =
                deptCoverage.length > 0
                  ? `\n\n## Search Context\nDepartments with matching results: ${deptCoverage.join(", ")}\nUser's selected department: ${streamDept || "GENERAL"}`
                  : ""
              const systemPrompt =
                HELPDESK_SYSTEM_PROMPT.replace("{sources}", sourcesText) + deptCtx

              // ── Build initial messages ──────────────────────
              let currentMessages: ChatMessage[] = [
                { role: "system", content: systemPrompt },
                ...rawStreamMessages.map(
                  (m: { role: string; content: string }) =>
                    ({
                      role: m.role as ChatMessage["role"],
                      content: m.content,
                    })
                ),
              ]

              // ── Tool-calling streaming loop ─────────────────
              let rounds = 0
              const MAX_ROUNDS = 3
              let searchedKB = false
              let streamTools = [...HELPDESK_TOOLS]

              while (rounds < MAX_ROUNDS) {
                rounds++

                const provider = getDashScopeProvider()
                let accumulatedContent = ""
                let accumulatedThinking = ""

                const result = await provider.createStreamingCompletion(
                  {
                    model: (streamModel as string) || DEFAULT_MODELS.helpdesk,
                    temperature: 0.3,
                    maxTokens: 2000,
                    messages: currentMessages,
                    tools: streamTools.length > 0 ? streamTools : undefined,
                  },
                  {
                    onThinkingToken: (text) => {
                      accumulatedThinking += text
                      sendSSE("thinking", { text })
                    },
                    onToken: (text) => {
                      accumulatedContent += text
                      sendSSE("token", { text })
                    },
                  }
                )

                // No tool calls → final answer
                if (!result.toolCalls || result.toolCalls.length === 0) {
                  const finalResult = parseJsonResult(
                    accumulatedContent || result.messageContent
                  )

                  // Log AgentRun
                  await prisma.agentRun.create({
                    data: {
                      workspaceId: session.workspaceId,
                      kind: "HELPDESK_QA",
                      status: "COMPLETED",
                      input: {
                        messagesCount: rawStreamMessages.length,
                        rounds,
                        toolsUsed: rounds > 1,
                        department: streamDept || "GENERAL",
                      } as any,
                      output: {
                        ...finalResult,
                        thinkingLength: accumulatedThinking.length,
                        conversationId: convId,
                      } as any,
                    },
                  })

                  sendSSE("result", {
                    result: {
                      conversationId: convId,
                      ...finalResult,
                      sources: finalResult.sources ||
                        articles.map((a) => ({
                          articleId: a.id,
                          articleTitle: a.title,
                          excerpt: a.content.slice(0, 200),
                        })),
                    },
                    thinkingProcess: accumulatedThinking || undefined,
                  })
                  controller.close()
                  return
                }

                // Track searches — remove tool after first use to prevent loops
                for (const tc of result.toolCalls) {
                  if (tc.function.name === "search_knowledge_base") {
                    searchedKB = true
                    streamTools = streamTools.filter(
                      (t) => t.function.name !== "search_knowledge_base"
                    )
                  }
                }

                // Append assistant message with tool calls
                currentMessages.push({
                  role: "assistant",
                  content: accumulatedContent || "",
                  toolCalls: result.toolCalls,
                } as ChatMessage)

                // Execute each tool call
                for (const tc of result.toolCalls) {
                  let toolArgs: Record<string, unknown> = {}
                  try {
                    toolArgs = JSON.parse(tc.function.arguments)
                  } catch {
                    // invalid JSON — skip
                  }

                  sendSSE("tool_use", {
                    name: tc.function.name,
                    args: toolArgs,
                  })

                  const { messages: toolMsgs } = await executeToolCall(
                    tc,
                    session
                  )

                  // Extract summary for UI
                  let summary = "Done"
                  if (toolMsgs[0]?.content) {
                    try {
                      const parsed = JSON.parse(toolMsgs[0].content as string)
                      summary =
                        (parsed.message as string) ||
                        `Found ${parsed.totalResults || 0} results`
                    } catch {
                      summary = "Processing complete"
                    }
                  }

                  sendSSE("tool_result", {
                    name: tc.function.name,
                    summary,
                  })

                  currentMessages.push(...toolMsgs)
                }
              }

              // Max rounds exceeded
              sendSSE("error", {
                detail:
                  "I could not find the information you need in our knowledge base. Please try rephrasing or contact a human agent for assistance.",
              })
              controller.close()
            } catch (err) {
              sendSSE("error", {
                detail: err instanceof Error ? err.message : "Unknown error",
              })
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

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error("Helpdesk agent API error:", error)
    return NextResponse.json(
      {
        error: "Agent processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
