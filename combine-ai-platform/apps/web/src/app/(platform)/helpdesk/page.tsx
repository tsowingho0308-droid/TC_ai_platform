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
  Paperclip,
  X,
} from "lucide-react"
import { cn, MarkdownContent } from "@combine-ai/shared-ui"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import {
  chatStream,
  type HelpdeskMessage,
} from "@/features/helpdesk/api/helpdesk-client"
import {
  ChatRoomSidebar,
  type ChatRoom,
  type AttachedDocument,
} from "@/features/helpdesk/components/chat-room-sidebar"

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

// ── Helper to generate title from first question ─────────────────

async function generateTitle(question: string): Promise<string> {
  try {
    const res = await fetch("/api/helpdesk/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    })
    if (res.ok) {
      const data = await res.json()
      // Use the conversation ID to patch the title via a separate call
      const conv = data.conversation as { id: string }
      if (conv?.id) {
        await fetch("/api/helpdesk/conversations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: conv.id,
            title: question.slice(0, 60) + (question.length > 60 ? "…" : ""),
          }),
        })
      }
      return question.slice(0, 60)
    }
  } catch {
    // best-effort
  }
  return question.slice(0, 50)
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
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Store turns per room so history survives switching
  const turnsByRoomRef = useRef<Map<string, QATurn[]>>(new Map())
  const firstQuestionRef = useRef(false)

  // Per-room streaming state — persists AI stream across room switches
  interface RoomStreamState {
    content: string
    thinking: string
    toolCalls: ActiveToolCall[]
    loading: boolean
  }
  const streamingByRoomRef = useRef<Map<string, RoomStreamState>>(new Map())
  const activeStreamRoomRef = useRef<string | null>(null)
  const abortByRoomRef = useRef<Map<string, AbortController>>(new Map())

  // Get or create streaming state for a room
  function getStreamState(roomId: string): RoomStreamState {
    let s = streamingByRoomRef.current.get(roomId)
    if (!s) {
      s = { content: "", thinking: "", toolCalls: [], loading: false }
      streamingByRoomRef.current.set(roomId, s)
    }
    return s
  }

  // Sync React streaming state from a room's persisted state
  function restoreStreamState(roomId: string | null) {
    if (!roomId) {
      setStreamingContent("")
      setStreamingThinking("")
      setActiveToolCalls([])
      setLoading(false)
      return
    }
    const s = streamingByRoomRef.current.get(roomId)
    if (s) {
      setStreamingContent(s.content)
      setStreamingThinking(s.thinking)
      setActiveToolCalls(s.toolCalls)
      setLoading(s.loading)
    } else {
      setStreamingContent("")
      setStreamingThinking("")
      setActiveToolCalls([])
      setLoading(false)
    }
  }

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

  // ── Auto-select most recent room on mount ──────────────────

  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true

    async function loadLatestRoom() {
      try {
        const res = await fetch("/api/helpdesk/conversations")
        if (!res.ok) return
        const data = await res.json()
        const conversations = (data.conversations || []) as ChatRoom[]
        if (conversations.length === 0) return

        const latest = conversations[0] // already sorted by updatedAt desc
        // Load full conversation with messages
        const detailRes = await fetch(
          `/api/helpdesk/conversations?id=${encodeURIComponent(latest.id)}`
        )
        if (!detailRes.ok) return
        const detailData = await detailRes.json()
        const conv = detailData.conversation
        const messages = (conv?.messages as QATurn[]) || []

        turnsByRoomRef.current.set(latest.id, messages)
        setActiveRoomId(latest.id)
        setTurns(messages)
        firstQuestionRef.current = messages.length > 0
      } catch (err) {
        console.error("Failed to auto-load latest room:", err)
      }
    }

    loadLatestRoom()
  }, [])

  // ── Auto-generate title on first question in new room ──────────

  async function ensureTitleGenerated(roomId: string, questionText: string) {
    if (firstQuestionRef.current) return
    firstQuestionRef.current = true
    try {
      const res = await fetch("/api/helpdesk/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: roomId,
          title: questionText.slice(0, 80) + (questionText.length > 80 ? "…" : ""),
        }),
      })
      if (res.ok) {
        setSidebarRefreshKey((k) => k + 1)
      }
    } catch {
      // best-effort
    }
  }

  // ── Create new room ──────────────────────────────────────────

  const createNewRoom = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/helpdesk/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department }),
      })
      if (res.ok) {
        const data = await res.json()
        const room = data.conversation as ChatRoom
        setSidebarRefreshKey((k) => k + 1)
        return room.id
      }
    } catch (err) {
      console.error("Failed to create room:", err)
    }
    return null
  }, [department])

  // ── Persist messages to DB ────────────────────────────────────

  const persistMessages = useCallback(
    async (roomId: string, messages: QATurn[]) => {
      try {
        await fetch("/api/helpdesk/conversations", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: roomId, messages }),
        })
      } catch (err) {
        console.error("Failed to persist messages:", err)
      }
    },
    []
  )

  // ── Switch to a room (loads history from DB) ────────────────

  const handleSelectRoom = useCallback(
    async (roomId: string) => {
      if (roomId === activeRoomId) return

      // Save current turns + streaming state for old room
      if (activeRoomId) {
        if (turns.length > 0) {
          turnsByRoomRef.current.set(activeRoomId, turns)
          persistMessages(activeRoomId, turns)
        }
        // Save streaming state (don't lose in-progress AI)
        getStreamState(activeRoomId).content = streamingContent
        getStreamState(activeRoomId).thinking = streamingThinking
        getStreamState(activeRoomId).toolCalls = activeToolCalls
        getStreamState(activeRoomId).loading = loading
      }

      // Try loading turns from local cache first
      const cached = turnsByRoomRef.current.get(roomId)
      if (cached) {
        setActiveRoomId(roomId)
        setTurns(cached)
        firstQuestionRef.current = cached.length > 0
        restoreStreamState(roomId)
        setError(null)
        return
      }

      // Load from DB
      try {
        const res = await fetch(
          `/api/helpdesk/conversations?id=${encodeURIComponent(roomId)}`
        )
        if (res.ok) {
          const data = await res.json()
          const conv = data.conversation
          const dbMessages = (conv?.messages as QATurn[]) || []
          turnsByRoomRef.current.set(roomId, dbMessages)
          setActiveRoomId(roomId)
          setTurns(dbMessages)
          firstQuestionRef.current = dbMessages.length > 0
        } else {
          setActiveRoomId(roomId)
          setTurns([])
          firstQuestionRef.current = false
        }
      } catch {
        setActiveRoomId(roomId)
        setTurns([])
        firstQuestionRef.current = false
      }
      setError(null)
      restoreStreamState(roomId)
    },
    [activeRoomId, turns, streamingContent, streamingThinking, activeToolCalls, loading, persistMessages]
  )

  // ── Start a fresh room ───────────────────────────────────────

  const handleNewRoom = useCallback(async () => {
    // Save current turns + streaming state to DB before switching
    if (activeRoomId) {
      if (turns.length > 0) {
        turnsByRoomRef.current.set(activeRoomId, turns)
        persistMessages(activeRoomId, turns)
      }
      getStreamState(activeRoomId).content = streamingContent
      getStreamState(activeRoomId).thinking = streamingThinking
      getStreamState(activeRoomId).toolCalls = activeToolCalls
      getStreamState(activeRoomId).loading = loading
    }

    const newId = await createNewRoom()
    if (newId) {
      setActiveRoomId(newId)
      setTurns([])
      firstQuestionRef.current = false
      restoreStreamState(newId)
      setError(null)
    }
  }, [activeRoomId, turns, streamingContent, streamingThinking, activeToolCalls, loading, createNewRoom, persistMessages])

  // ── Delete room ──────────────────────────────────────────────

  const handleDeleteRoom = useCallback(
    (roomId: string) => {
      // Abort any active AI stream for this room
      abortByRoomRef.current.get(roomId)?.abort()
      abortByRoomRef.current.delete(roomId)

      // Clean up all refs for this room
      turnsByRoomRef.current.delete(roomId)
      streamingByRoomRef.current.delete(roomId)
      if (activeStreamRoomRef.current === roomId) {
        activeStreamRoomRef.current = null
      }

      // If this was the active room, clear the display
      if (activeRoomId === roomId) {
        setTurns([])
        setStreamingContent("")
        setStreamingThinking("")
        setActiveToolCalls([])
        setLoading(false)
        setError(null)
        setActiveRoomId(null)
      }
      setSidebarRefreshKey((k) => k + 1)
    },
    [activeRoomId]
  )

  // ── Main ask handler (room-isolated — no cross-room contamination) ──

  async function handleAsk() {
    if (!question.trim() || loading) return

    // ── Capture room ID at invocation time (immutable for this call) ──
    const capturedRoomId = activeRoomId || (await createNewRoom())
    if (!capturedRoomId) {
      setError("Failed to create chat room. Please try again.")
      return
    }
    if (!activeRoomId) {
      setActiveRoomId(capturedRoomId)
      firstQuestionRef.current = false
    }

    const q = question.trim()
    setQuestion("")

    // ── Build user message (include attached document if present) ──
    const currentDoc = attachedDoc
    setAttachedDoc(null) // clear immediately

    let userContent = q
    if (currentDoc) {
      userContent = [
        `[Attached Document: ${currentDoc.articleTitle} (${currentDoc.knowledgeBaseName})]`,
        `> ${currentDoc.excerpt}`,
        "",
        q,
      ].join("\n")
    }

    // ── All turn operations use turnsByRoomRef (per-room, never shared) ──
    const roomTurns = turnsByRoomRef.current.get(capturedRoomId) || []
    const turnsWithUser = [...roomTurns, { role: "user" as const, content: userContent }]
    turnsByRoomRef.current.set(capturedRoomId, turnsWithUser)
    // Persist immediately so updatedAt reflects when user sent the message
    persistMessages(capturedRoomId, turnsWithUser)
    setSidebarRefreshKey((k) => k + 1)

    // Update React state ONLY if this room is currently displayed
    const isDisplayed = () => activeRoomId === capturedRoomId
    if (isDisplayed()) {
      setTurns(turnsWithUser)
      setError(null)
      setStreamingContent("")
      setStreamingThinking("")
      setThinkingExpanded(true)
      setActiveToolCalls([])
    }
    setLoading(isDisplayed())

    // Auto-generate title from first question
    ensureTitleGenerated(capturedRoomId, q)

    // Build message history from THIS room's turns only
    const historyMessages: HelpdeskMessage[] = roomTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }))

    // Initialize streaming state for this room
    const streamState = getStreamState(capturedRoomId)
    streamState.content = ""
    streamState.thinking = ""
    streamState.toolCalls = []
    streamState.loading = true
    activeStreamRoomRef.current = capturedRoomId

    // Create AbortController for this room (abort previous if exists)
    abortByRoomRef.current.get(capturedRoomId)?.abort()
    const abortController = new AbortController()
    abortByRoomRef.current.set(capturedRoomId, abortController)

    // Check if room still exists (hasn't been deleted)
    const roomExists = () => turnsByRoomRef.current.has(capturedRoomId) || activeRoomId === capturedRoomId

    // Track streaming state locally
    let latestContent = ""
    let latestThinking = ""

    try {
      await chatStream(
        {
          messages: [...historyMessages, { role: "user", content: userContent }],
          department,
          model,
          conversationId: capturedRoomId,
        },
        {

          onTrace: (trace) => {
            console.debug("[helpdesk]", trace.stage, trace.title)
          },

          onThinking: (text) => {
            if (!roomExists()) return // room deleted — discard
            latestThinking += text
            streamState.thinking = latestThinking
            if (activeRoomId === capturedRoomId) setStreamingThinking(latestThinking)
          },

          onToken: (text) => {
            if (!roomExists()) return
            latestContent += text
            streamState.content = latestContent
            if (activeRoomId === capturedRoomId) setStreamingContent(latestContent)
          },

          onToolUse: (name, _args) => {
            if (!roomExists()) return
            streamState.toolCalls = [...streamState.toolCalls, { name, status: "running" }]
            if (activeRoomId === capturedRoomId) setActiveToolCalls(streamState.toolCalls)
          },

          onToolResult: (name, summary) => {
            if (!roomExists()) return
            streamState.toolCalls = streamState.toolCalls.map((tc) =>
              tc.name === name
                ? { ...tc, status: "complete" as const, summary }
                : tc
            )
            if (activeRoomId === capturedRoomId) setActiveToolCalls(streamState.toolCalls)
          },

          onResult: (result, thinkingProcess) => {
            // If room was deleted, discard everything
            if (!roomExists()) {
              streamState.loading = false
              return
            }
            const answer = result.answer || latestContent || "No response received."
            streamState.loading = false

            const currentTurns = turnsByRoomRef.current.get(capturedRoomId) || []
            const updated = [
              ...currentTurns,
              {
                role: "assistant" as const,
                content: answer,
                thinking: latestThinking || thinkingProcess || undefined,
                sources: result.sources,
                needsEscalation: result.needsEscalation,
                suggestedDepartment: result.suggestedDepartment,
              },
            ]
            turnsByRoomRef.current.set(capturedRoomId, updated)
            persistMessages(capturedRoomId, updated)

            if (activeRoomId === capturedRoomId) {
              setTurns(updated)
              setLoading(false)
            }

            setSidebarRefreshKey((k) => k + 1)
          },

          onError: (detail) => {
            if (!roomExists()) return
            streamState.loading = false
            if (activeRoomId === capturedRoomId) {
              setError(detail)
              setLoading(false)
            }
            const currentTurns = turnsByRoomRef.current.get(capturedRoomId) || []
            const updated = [
              ...currentTurns,
              { role: "assistant" as const, content: `Sorry, something went wrong: ${detail}` },
            ]
            turnsByRoomRef.current.set(capturedRoomId, updated)
            if (activeRoomId === capturedRoomId) setTurns(updated)
          },
        },
        { signal: abortController.signal }
      )
    } catch (err) {
      if ((err as Error).name === "AbortError") return // stream aborted by room deletion
      streamState.loading = false
      if (activeRoomId === capturedRoomId) setLoading(false)
      await handleAskFallback(capturedRoomId, q)
    } finally {
      streamState.loading = false
      if (activeRoomId === capturedRoomId) {
        setLoading(false)
        setStreamingContent("")
        setStreamingThinking("")
      }
      activeStreamRoomRef.current = null
      abortByRoomRef.current.delete(capturedRoomId)
    }
  }

  // ── Legacy fallback (room-isolated) ──────────────────────────

  async function handleAskFallback(roomId: string, q: string) {
    try {
      const res = await fetch("/api/helpdesk/agent?action=ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, department }),
      })
      if (res.ok) {
        const data = await res.json()
        // Use THIS room's turns from ref
        const currentTurns = turnsByRoomRef.current.get(roomId) || []
        const updated = [
          ...currentTurns,
          {
            role: "assistant" as const,
            content: data.answer || "Sorry, I could not process this question.",
            sources: data.sources,
            needsEscalation: data.needsEscalation,
            suggestedDepartment: data.suggestedDepartment,
          },
        ]
        turnsByRoomRef.current.set(roomId, updated)
        persistMessages(roomId, updated)
        if (activeRoomId === roomId) setTurns(updated)
      } else {
        if (activeRoomId === roomId) setError(`Error ${res.status}`)
      }
    } catch {
      if (activeRoomId === roomId) {
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: "Network error. Please try again." },
        ])
      }
    }
  }

  // ── Suggested questions for current department ───────────────

  const suggestions =
    SUGGESTED_QUESTIONS[department] || SUGGESTED_QUESTIONS.GENERAL

  const conversationTitle = activeRoomId
    ? turnsByRoomRef.current.get(activeRoomId)?.[0]?.content?.slice(0, 60) ||
      "Chat"
    : null

  return (
    <div className="flex h-full">
      {/* ── Main Chat Area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
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
              {conversationTitle && (
                <div className="mb-4 text-center">
                  <span className="inline-block rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                    {conversationTitle}
                  </span>
                </div>
              )}

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
        <div className="border-t shrink-0">
          {/* Attached document indicator */}
          {attachedDoc && (
            <div className="mx-auto max-w-2xl px-4 pt-3">
              <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{attachedDoc.articleTitle}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {attachedDoc.knowledgeBaseName} — {attachedDoc.excerpt.slice(0, 80)}…
                  </p>
                </div>
                <button
                  onClick={() => setAttachedDoc(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-muted"
                  title="Remove attachment"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </div>
          )}
          <div className="p-4">
            <div className="mx-auto flex max-w-2xl gap-2">
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                placeholder={
                  attachedDoc
                    ? "Ask a question about the attached document..."
                    : activeRoomId
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
      </div>

      {/* ── Chat Room Sidebar (right side) ── */}
      <ChatRoomSidebar
        activeRoomId={activeRoomId}
        onSelectRoom={handleSelectRoom}
        onNewRoom={handleNewRoom}
        onDeleteRoom={handleDeleteRoom}
        onAttachDocument={setAttachedDoc}
        refreshKey={sidebarRefreshKey}
      />
    </div>
  )
}
