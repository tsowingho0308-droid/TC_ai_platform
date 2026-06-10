"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  MessageCircleQuestion,
  Send,
  Loader2,
  ExternalLink,
  Brain,
  ChevronUp,
  ChevronDown,
  Search,
  Ticket,
  RefreshCw,
} from "lucide-react"
import { cn, MarkdownContent } from "@combine-ai/shared-ui"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import {
  chatStream,
  type HelpdeskMessage,
} from "@/features/helpdesk/api/helpdesk-client"

// ── Types ────────────────────────────────────────────────────────

interface QATurn {
  role: "user" | "assistant"
  content: string
  thinking?: string
  sources?: Array<{ articleId: string; articleTitle: string; excerpt: string }>
  needsEscalation?: boolean
  suggestedDepartment?: string
}

interface ActiveToolCall {
  name: string
  status: "running" | "complete"
  summary?: string
}

// ── Department-aware suggested questions ─────────────────────────

const SUGGESTED_QUESTIONS: Record<string, string[]> = {
  GENERAL: [
    "How many annual leave days do I get?",
    "What is the meal allowance for business trips?",
    "How do I request a new laptop?",
    "What is the new employee onboarding process?",
    "How do I file an expense report?",
  ],
  HR: [
    "What is the maternity / paternity leave policy?",
    "How do I apply for training reimbursement?",
    "What are the flexible working hours rules?",
    "How do I update my personal information in the system?",
    "What is the performance review cycle?",
  ],
  IT: [
    "How do I reset my network password?",
    "How do I request software installation?",
    "What is the VPN setup process for remote work?",
    "How do I report a phishing email?",
    "What is the laptop replacement policy?",
  ],
  ADMIN: [
    "How do I book a meeting room?",
    "How do I request office supplies?",
    "What is the visitor registration process?",
    "How do I submit a facility maintenance request?",
    "What is the office access card replacement procedure?",
  ],
  FINANCE: [
    "What is the travel expense reimbursement limit?",
    "How do I get a purchase order approved?",
    "What is the corporate credit card policy?",
    "How do I submit an invoice for payment?",
    "What is the budget approval workflow?",
  ],
}

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching knowledge base",
  create_ticket: "Creating escalation ticket",
  check_ticket_status: "Checking ticket status",
}

// ── Main Component ───────────────────────────────────────────────

export default function HelpdeskPage() {
  const [question, setQuestion] = useState("")
  const [turns, setTurns] = useState<QATurn[]>([])
  const [loading, setLoading] = useState(false)
  const [department, setDepartment] = useState("GENERAL")
  const [model, setModel] = useState(DEFAULT_MODELS.helpdesk)
  const [streamingContent, setStreamingContent] = useState("")
  const [streamingThinking, setStreamingThinking] = useState("")
  const [thinkingExpanded, setThinkingExpanded] = useState(true)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([])
  const [error, setError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Auto-scroll ──────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns, streamingContent, activeToolCalls])

  // ── Focus input after response ───────────────────────────────

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus()
    }
  }, [loading])

  // ── Main ask handler ─────────────────────────────────────────

  async function handleAsk() {
    if (!question.trim() || loading) return

    const q = question.trim()
    setQuestion("")
    setError(null)
    setTurns((prev) => [...prev, { role: "user", content: q }])
    setLoading(true)
    setStreamingContent("")
    setStreamingThinking("")
    setThinkingExpanded(true)
    setActiveToolCalls([])

    // Build message history (all turns so far + current question)
    const historyMessages: HelpdeskMessage[] = turns.map((t) => ({
      role: t.role,
      content: t.content,
    }))

    // Track streaming state locally (React setState is async — we need
    // the final values in onResult before the turn is committed)
    let latestContent = ""
    let latestThinking = ""

    try {
      await chatStream(
        {
          messages: [...historyMessages, { role: "user", content: q }],
          department,
          model,
          conversationId: conversationId || undefined,
        },
        {
          onTrace: (trace) => {
            console.debug("[helpdesk]", trace.stage, trace.title)
          },

          onThinking: (text) => {
            latestThinking += text
            setStreamingThinking((prev) => prev + text)
          },

          onToken: (text) => {
            latestContent += text
            setStreamingContent((prev) => prev + text)
          },

          onToolUse: (name, _args) => {
            setActiveToolCalls((prev) => [
              ...prev,
              { name, status: "running" },
            ])
          },

          onToolResult: (name, summary) => {
            setActiveToolCalls((prev) =>
              prev.map((tc) =>
                tc.name === name
                  ? { ...tc, status: "complete" as const, summary }
                  : tc
              )
            )
          },

          onResult: (result, thinkingProcess) => {
            setConversationId(result.conversationId)

            // Use the streamed content if result.answer is empty
            const answer = result.answer || latestContent || "No response received."

            setTurns((prev) => [
              ...prev,
              {
                role: "assistant",
                content: answer,
                thinking: latestThinking || thinkingProcess || undefined,
                sources: result.sources,
                needsEscalation: result.needsEscalation,
                suggestedDepartment: result.suggestedDepartment,
              },
            ])
          },

          onError: (detail) => {
            setError(detail)
            setTurns((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Sorry, something went wrong: ${detail}`,
              },
            ])
          },
        }
      )
    } catch {
      // Fallback: try legacy ask action
      await handleAskFallback(q)
    } finally {
      setLoading(false)
      setStreamingContent("")
      setStreamingThinking("")
    }
  }

  // ── Legacy fallback ──────────────────────────────────────────

  async function handleAskFallback(q: string) {
    try {
      const res = await fetch("/api/helpdesk/agent?action=ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, department }),
      })
      if (res.ok) {
        const data = await res.json()
        setConversationId(data.conversationId || null)
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer || "Sorry, I could not process this question.",
            sources: data.sources,
            needsEscalation: data.needsEscalation,
            suggestedDepartment: data.suggestedDepartment,
          },
        ])
      } else {
        setError(`Error ${res.status}`)
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong." },
        ])
      }
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ])
    }
  }

  // ── Start new conversation ───────────────────────────────────

  const startNewConversation = useCallback(() => {
    setConversationId(null)
    setTurns([])
    setError(null)
    setActiveToolCalls([])
    setStreamingContent("")
    setStreamingThinking("")
  }, [])

  // ── Suggested questions for current department ───────────────

  const suggestions =
    SUGGESTED_QUESTIONS[department] || SUGGESTED_QUESTIONS.GENERAL

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b px-6 py-3 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Helpdesk Agent</h1>
          <p className="text-xs text-muted-foreground">
            AI-powered knowledge base Q&A with tool calling
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector value={model} onChange={setModel} />
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="rounded-md border bg-transparent px-3 py-1.5 text-sm"
          >
            <option value="GENERAL">General</option>
            <option value="HR">HR</option>
            <option value="IT">IT</option>
            <option value="ADMIN">Admin</option>
            <option value="FINANCE">Finance</option>
          </select>
        </div>
      </header>

      {/* ── Conversation Header ──────────────────────────────── */}
      {conversationId && turns.length > 0 && (
        <div className="flex items-center justify-between border-b bg-muted/30 px-6 py-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">
            Conversation: {conversationId.slice(0, 8)}...
          </span>
          <button
            onClick={startNewConversation}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            New conversation
          </button>
        </div>
      )}

      {/* ── Chat Area ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        {turns.length === 0 ? (
          /* ── Welcome / empty state ── */
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircleQuestion className="h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">How can I help you?</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Ask any question about company policies, IT support, HR
              procedures, or administrative processes. The AI can search the
              knowledge base and escalate to a human if needed.
            </p>
            <div className="mt-6 grid w-full max-w-md gap-2">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuestion(q)
                    setTimeout(() => handleAsk(), 100)
                  }}
                  className="rounded-lg border px-4 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Chat messages ── */
          <div className="mx-auto max-w-2xl space-y-4">
            {turns.map((turn, i) => (
              <div
                key={i}
                className={`flex ${
                  turn.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-3",
                    turn.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                >
                  {/* Thinking process (collapsible) */}
                  {turn.thinking && (
                    <details className="mb-2">
                      <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium opacity-60 hover:opacity-100">
                        <Brain className="h-3 w-3" />
                        Thinking process
                      </summary>
                      <div className="mt-2 rounded bg-background/50 p-2 text-xs opacity-70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {turn.thinking}
                      </div>
                    </details>
                  )}

                  <MarkdownContent
                    className={turn.role === "user" ? "text-primary-foreground [&_*]:!text-primary-foreground [&_code]:!bg-white/20" : ""}
                  >
                    {turn.content}
                  </MarkdownContent>

                  {/* Sources */}
                  {turn.sources && turn.sources.length > 0 && (
                    <div className="mt-2 border-t border-border pt-2">
                      <p className="text-xs font-medium opacity-70">
                        Sources:
                      </p>
                      {turn.sources.map((s, si) => (
                        <div key={si} className="mt-1 flex items-start gap-1">
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-50" />
                          <span className="text-xs opacity-70">
                            {s.articleTitle}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Escalation indicator */}
                  {turn.needsEscalation && (
                    <div className="mt-2 border-t border-border pt-2">
                      <p className="text-xs opacity-70">
                        ⚠️ This has been escalated to{" "}
                        {turn.suggestedDepartment || "the appropriate team"}.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Streaming / tool indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-muted px-4 py-3">
                  {/* Tool call indicators */}
                  {activeToolCalls.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {activeToolCalls.map((tc, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <div
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              tc.status === "running"
                                ? "bg-amber-500 animate-pulse"
                                : "bg-green-500"
                            )}
                          />
                          {tc.status === "running" ? (
                            <span>
                              {tc.name === "search_knowledge_base" ? (
                                <>
                                  <Search className="inline h-3 w-3 mr-0.5" />
                                  Searching knowledge base...
                                </>
                              ) : tc.name === "create_ticket" ? (
                                <>
                                  <Ticket className="inline h-3 w-3 mr-0.5" />
                                  Creating ticket...
                                </>
                              ) : (
                                TOOL_LABELS[tc.name] || tc.name
                              )}
                            </span>
                          ) : (
                            <span>
                              {tc.summary || TOOL_LABELS[tc.name] || tc.name}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Thinking (collapsible during streaming) */}
                  {streamingThinking && (
                    <details
                      className="mb-2"
                      open={thinkingExpanded}
                    >
                      <summary
                        className="flex cursor-pointer items-center gap-1 text-xs font-medium opacity-60 hover:opacity-100"
                        onClick={(e) => {
                          e.preventDefault()
                          setThinkingExpanded(!thinkingExpanded)
                        }}
                      >
                        <Brain className="h-3 w-3" />
                        Thinking...
                        {thinkingExpanded ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </summary>
                      <div className="mt-2 rounded bg-background/50 p-2 text-xs opacity-70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {streamingThinking}
                      </div>
                    </details>
                  )}

                  {/* Streaming content */}
                  {streamingContent ? (
                    <div>
                      <MarkdownContent>{streamingContent}</MarkdownContent>
                      <span className="animate-pulse text-sm">▊</span>
                    </div>
                  ) : activeToolCalls.length === 0 && !streamingThinking ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <p className="text-sm text-muted-foreground">
                        Processing...
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="flex justify-center">
                <div className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
                  {error}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* ── Input Area ────────────────────────────────────────── */}
      <div className="border-t p-4 shrink-0">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            placeholder={
              conversationId
                ? "Ask a follow-up question..."
                : "Ask a question about company policies, IT, HR, or admin..."
            }
            className="flex-1 rounded-md border bg-transparent px-4 py-2 text-sm"
            disabled={loading}
          />
          <button
            onClick={handleAsk}
            disabled={loading || !question.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
          >
            <Send className="h-4 w-4" />
            Ask
          </button>
        </div>
      </div>
    </div>
  )
}
