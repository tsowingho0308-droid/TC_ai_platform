import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import { getDashScopeProvider } from "@combine-ai/ai-provider/server"
import type { ChatMessage } from "@combine-ai/ai-provider"
import {
  searchKnowledgeBase,
  formatSourcesText,
  extractDateFromQuery,
  type SearchResult,
} from "@/features/helpdesk/api/helpdesk-search"
import {
  callAI,
  executeToolCall,
  parseJsonResult,
  buildKBContext,
  HELPDESK_SYSTEM_PROMPT,
  HELPDESK_TOOLS,
} from "@/features/helpdesk/api/helpdesk-tools"
import {
  pushTask,
  getTaskStatus,
  getTaskResult,
} from "@/features/helpdesk/api/helpdesk-queue"

export const dynamic = "force-dynamic"

// ── Legacy Prompt (kept for backward-compatible ask/ask-stream) ──

const QA_PROMPT = HELPDESK_SYSTEM_PROMPT

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
            let clientDisconnected = false
            const sendSSE = (event: string, data: Record<string, unknown>) => {
              if (clientDisconnected) return
              try {
                controller.enqueue(
                  streamEncoder.encode(
                    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                  )
                )
              } catch {
                clientDisconnected = true
              }
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
              if (!clientDisconnected) controller.close()
            } catch (err) {
              sendSSE("error", {
                detail: err instanceof Error ? err.message : "Unknown error",
              })
              if (!clientDisconnected) controller.close()
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
      // NEW: chat-async (push to Redis queue, processed by Python worker)
      // ══════════════════════════════════════════════════════════
      case "chat-async": {
        const {
          messages: rawAsyncMessages,
          department: asyncDept,
          conversationId: asyncConvId,
          model: asyncModel,
        } = body as {
          messages?: Array<{ role: string; content: string }>
          department?: string
          conversationId?: string
          model?: string
        }

        if (
          !rawAsyncMessages ||
          !Array.isArray(rawAsyncMessages) ||
          rawAsyncMessages.length === 0
        ) {
          return NextResponse.json(
            { error: "messages array required" },
            { status: 400 }
          )
        }

        // ── Conversation management (synchronous) ────────────────
        let convId = asyncConvId
        if (convId) {
          const existing = await prisma.helpdeskConversation.findFirst({
            where: { id: convId, workspaceId: session.workspaceId },
          })
          if (!existing) convId = undefined
        }
        if (!convId) {
          const lastMsg = [...rawAsyncMessages]
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
                asyncDept === "HR" ||
                asyncDept === "IT" ||
                asyncDept === "ADMIN" ||
                asyncDept === "FINANCE"
                  ? asyncDept
                  : "GENERAL",
            },
          })
          convId = conv.id
        }

        // ── Pre-load context from KB (synchronous) ──────────────
        const lastAsyncUserMsg = [...rawAsyncMessages]
          .reverse()
          .find((m: { role: string }) => m.role === "user")
        const asyncUserQuestion =
          typeof lastAsyncUserMsg?.content === "string"
            ? lastAsyncUserMsg.content
            : ""

        const asyncDateFilter = extractDateFromQuery(asyncUserQuestion)
        const asyncSearchResult = asyncUserQuestion
          ? await searchKnowledgeBase(asyncUserQuestion, {
              workspaceId: session.workspaceId,
              department: asyncDept as string | undefined,
              topK: 5,
              minSimilarity: 0.42,
              dateFilter: asyncDateFilter.type
                ? (asyncDateFilter as { type: "exact" | "recent"; date?: Date })
                : undefined,
            })
          : {
              articles: [] as SearchResult[],
              suggestions: [] as SearchResult[],
              maxScore: 0,
              tier: "none" as const,
              searchMethod: "none" as const,
            }

        const {
          articles: asyncArticles,
          suggestions: asyncSuggestions,
          tier: asyncSearchTier,
          maxScore: asyncMaxScore,
        } = asyncSearchResult

        const asyncSourcesText = await buildKBContext(
          asyncUserQuestion,
          session.workspaceId,
          asyncDept as string | undefined,
          asyncArticles,
          asyncSuggestions,
          asyncMaxScore,
          asyncSearchTier
        )

        const deptCoverage = [
          ...new Set(
            [...asyncArticles, ...asyncSuggestions].map((a) => a.department)
          ),
        ]
        const deptCtx =
          deptCoverage.length > 0
            ? `\n\n## Search Context\nDepartments with matching results: ${deptCoverage.join(", ")}\nUser's selected department: ${asyncDept || "GENERAL"}`
            : ""
        const systemPrompt =
          HELPDESK_SYSTEM_PROMPT.replace("{sources}", asyncSourcesText) + deptCtx

        // ── Build messages ──────────────────────────────────────
        const asyncAiMessages: ChatMessage[] = [
          { role: "system", content: systemPrompt },
          ...rawAsyncMessages.map(
            (m: { role: string; content: string }) =>
              ({ role: m.role as ChatMessage["role"], content: m.content })
          ),
        ]

        // ── Generate task ID and push to Redis ──────────────────
        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        await pushTask({
          taskId,
          conversationId: convId,
          workspaceId: session.workspaceId,
          userId: session.sub,
          department: (asyncDept as string) || "GENERAL",
          model: (asyncModel as string) || DEFAULT_MODELS.helpdesk,
          messages: asyncAiMessages,
          tools: HELPDESK_TOOLS.map((t) => ({ ...t })),
          systemPrompt,
          createdAt: new Date().toISOString(),
        })

        // Persist the user message to the conversation immediately
        try {
          const conv = await prisma.helpdeskConversation.findUnique({
            where: { id: convId },
            select: { messages: true },
          })
          const existingMessages =
            (conv?.messages as Array<Record<string, unknown>>) || []
          const updatedMessages = [
            ...existingMessages,
            {
              role: "user",
              content: asyncUserQuestion,
            },
          ]
          await prisma.helpdeskConversation.update({
            where: { id: convId },
            data: { messages: updatedMessages as never },
          })
        } catch (err) {
          console.error("Failed to persist user message to conversation:", err)
        }

        // Log AgentRun start
        await prisma.agentRun
          .create({
            data: {
              workspaceId: session.workspaceId,
              kind: "HELPDESK_QA",
              status: "RUNNING",
              input: {
                messagesCount: rawAsyncMessages.length,
                department: asyncDept || "GENERAL",
                taskId,
                asyncMode: true,
              } as never,
              output: {} as never,
            },
          })
          .catch((err) =>
            console.error("Failed to log async agent run:", err)
          )

        return NextResponse.json(
          {
            taskId,
            conversationId: convId,
            status: "queued",
            message:
              "Your question has been queued for processing. Poll /api/helpdesk/agent/status/{taskId} for results.",
          },
          { status: 202 }
        )
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

        const dateFilter = extractDateFromQuery(userQuestion)
        const searchResult = userQuestion
          ? await searchKnowledgeBase(userQuestion, {
              workspaceId: session.workspaceId,
              department: department as string | undefined,
              topK: 5,
              minSimilarity: 0.42,
              dateFilter: dateFilter.type ? dateFilter as { type: "exact" | "recent"; date?: Date } : undefined,
            })
          : { articles: [] as SearchResult[], suggestions: [] as SearchResult[], maxScore: 0, tier: "none" as const, searchMethod: "none" as const }

        const { articles, suggestions, tier: searchTier, maxScore } = searchResult

        // Build sources text — include suggestions when in suggestions tier
        let sourcesText: string
        if (searchTier === "suggestions" && suggestions.length > 0) {
          const sugTitles = suggestions.map((s) => `"${s.title}" (${s.department}, ${Math.round((s.similarity ?? 0) * 100)}% match)`).join(", ")
          sourcesText = `⚠️ SUGGESTIONS FALLBACK — These documents are the CLOSEST matches found (best score: ${Math.round(maxScore * 100)}%).

You MUST follow these IRON RULES:
1. You MUST NOT say "找不到相關資料" / "未找到" / "I cannot find" / "not found" — these phrases are FORBIDDEN.
2. You MUST acknowledge the closest match and present it helpfully.
3. You MUST respond in this EXACT format (adapt language to match the user):

"沒有找到完全100%匹配的文件，但為您找到最接近的相關文件如下：

📄 **${suggestions[0]?.title || "[文件標題]"}**（${suggestions[0]?.department || ""}，相關度 ${Math.round((suggestions[0]?.similarity ?? 0) * 100)}%）
> ${suggestions[0]?.content.slice(0, 200) || ""}...
${suggestions.length > 1 ? `\n📄 **${suggestions[1]?.title || "[文件標題]"}**（${suggestions[1]?.department || ""}，相關度 ${Math.round((suggestions[1]?.similarity ?? 0) * 100)}%）\n> ${suggestions[1]?.content.slice(0, 200) || ""}...` : ""}

這份就是目前知識庫中最接近您需求的內容。請問需要我為您：
- 📖 提供這份文件的完整摘要？
- 🎫 建立工單請相關部門提供更精確的文件？
- 🔍 用其他關鍵字重新搜尋？"

4. Do NOT call search_knowledge_base. Do NOT call create_ticket unless user explicitly requests it.
5. Do NOT answer the user's original question — you don't have enough info. Focus on presenting the closest match.
6. Respond in the SAME LANGUAGE as the user.`
        } else {
          sourcesText = formatSourcesText(articles)
        }

        const departmentCoverage = [...new Set([...articles, ...suggestions].map((a) => a.department))]
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
            let clientDisconnected = false

            const sendSSE = (event: string, data: Record<string, unknown>) => {
              if (clientDisconnected) return
              try {
                controller.enqueue(
                  streamEncoder.encode(
                    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
                  )
                )
              } catch {
                clientDisconnected = true
              }
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

              const streamDateFilter = extractDateFromQuery(userQuestion)
              const searchResult = userQuestion
                ? await searchKnowledgeBase(userQuestion, {
                    workspaceId: session.workspaceId,
                    department: streamDept as string | undefined,
                    topK: 5,
                    minSimilarity: 0.42,
                    dateFilter: streamDateFilter.type ? streamDateFilter as { type: "exact" | "recent"; date?: Date } : undefined,
                  })
                : { articles: [] as SearchResult[], suggestions: [] as SearchResult[], maxScore: 0, tier: "none" as const, searchMethod: "none" as const }

              const { articles, suggestions, tier: searchTier, maxScore } = searchResult

              // Build sources text with suggestions fallback
              let sourcesText: string
              if (searchTier === "suggestions" && suggestions.length > 0) {
                sourcesText = `⚠️ SUGGESTIONS FALLBACK — CLOSEST matches (best: ${Math.round(maxScore * 100)}%).

IRON RULES:
1. NEVER say "找不到" / "not found" / "沒有相關資料"
2. MUST present the closest match with title and preview
3. MUST use this format:
"沒有找到完全100%匹配的文件，但為您找到最接近的相關文件：

📄 **${suggestions[0]?.title || ""}**（${suggestions[0]?.department || ""}，相關度 ${Math.round((suggestions[0]?.similarity ?? 0) * 100)}%）
> ${suggestions[0]?.content.slice(0, 200) || ""}...

這份就是目前知識庫中最接近您需求的內容。請問需要我提供更多資訊，還是為您建立工單？"
4. Do NOT call tools unless user requests.

${suggestions.map((s) => `[Doc] ${s.title} (${s.department}, ${Math.round((s.similarity ?? 0) * 100)}%)\n${s.content.slice(0, 500)}`).join("\n\n")}`
              } else {
                sourcesText = formatSourcesText(articles)
              }

              sendSSE("trace", {
                trace: {
                  id: "conv-start",
                  at: new Date().toISOString(),
                  stage: "search",
                  status: "complete",
                  title: searchTier === "suggestions"
                    ? `No strong matches — ${suggestions.length} suggestion${suggestions.length !== 1 ? "s" : ""} found`
                    : `Found ${articles.length} relevant article${articles.length !== 1 ? "s" : ""}`,
                  detail: [...articles, ...suggestions].map((a) => a.title).join(", ") || "None",
                },
              })

              const deptCoverage = [...new Set([...articles, ...suggestions].map((a) => a.department))]
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
                  const answer = accumulatedContent || result.messageContent
                  const finalResult = parseJsonResult(answer)

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

                  // Persist the AI response to the conversation's messages
                  if (convId) {
                    try {
                      const conv = await prisma.helpdeskConversation.findUnique({
                        where: { id: convId },
                        select: { messages: true },
                      })
                      const existingMessages =
                        (conv?.messages as Array<Record<string, unknown>>) || []
                      const updatedMessages = [
                        ...existingMessages,
                        {
                          role: "assistant",
                          content: answer,
                          thinking: accumulatedThinking || undefined,
                          sources: finalResult.sources || undefined,
                          needsEscalation: finalResult.needsEscalation || false,
                          suggestedDepartment: finalResult.suggestedDepartment || undefined,
                        },
                      ]
                      await prisma.helpdeskConversation.update({
                        where: { id: convId },
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        data: { messages: updatedMessages as any },
                      })
                    } catch (err) {
                      console.error("Failed to persist AI response to conversation:", err)
                    }
                  }

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
                  if (!clientDisconnected) {
                    controller.close()
                  }
                  return
                }

                // ── Tool calls detected → auto-upgrade to async ──
                // Push messages BEFORE the incomplete tool-call turn.
                // The Python worker will re-do the AI call from scratch
                // with a clean tool-calling loop — no orphaned tool calls.
                const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

                await pushTask({
                  taskId,
                  conversationId: convId,
                  workspaceId: session.workspaceId,
                  userId: session.sub,
                  department: streamDept || "GENERAL",
                  model: (streamModel as string) || DEFAULT_MODELS.helpdesk,
                  messages: currentMessages, // pre-tool-call state — clean
                  tools: streamTools.length > 0 ? streamTools : undefined,
                  systemPrompt,
                  createdAt: new Date().toISOString(),
                })

                // Notify frontend to switch to polling mode
                sendSSE("upgrade_to_async", {
                  taskId,
                  conversationId: convId,
                })

                if (!clientDisconnected) {
                  controller.close()
                }
                return
              }

              // Max rounds exceeded
              sendSSE("error", {
                detail:
                  "I could not find the information you need in our knowledge base. Please try rephrasing or contact a human agent for assistance.",
              })
              if (!clientDisconnected) controller.close()
            } catch (err) {
              sendSSE("error", {
                detail: err instanceof Error ? err.message : "Unknown error",
              })
              if (!clientDisconnected) controller.close()
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
