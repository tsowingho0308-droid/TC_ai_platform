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
  waitForTaskResult,
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

// ══════════════════════════════════════════════════════════════════
// Global Session Cache — survives component unmount/remount when
// user switches between Agents in the sidebar. Without this, any
// in-progress AI stream or async task would be lost on unmount
// because the DB hasn't received the final AI response yet.
// ══════════════════════════════════════════════════════════════════

interface RoomCacheEntry {
  streamContent: string
  streamThinking: string
  toolCalls: ActiveToolCall[]
  loading: boolean
}

// ── Cache eviction limits ──────────────────────────────────────
const MAX_CACHED_ROOMS = 20          // max rooms to keep in memory
const CACHE_TTL_MS = 30 * 60_000     // 30 min — unused rooms are evicted
const roomLastAccess = new Map<string, number>()

// Per-room message history (survives unmount/remount)
const roomTurnsCache = new Map<string, QATurn[]>()
// Per-room live streaming state
const roomStreamCache = new Map<string, RoomCacheEntry>()
// Per-room SSE abort controllers
const roomAbortCache = new Map<string, AbortController>()
// Which room currently has an active SSE stream connection
let activeStreamRoomId: string | null = null

/** Evict least-recently-used entry if cache is full. */
function evictIfNeeded() {
  if (roomTurnsCache.size < MAX_CACHED_ROOMS) return
  let oldest = "", oldestTime = Infinity
  for (const [id, time] of roomLastAccess) {
    if (time < oldestTime) { oldest = id; oldestTime = time }
  }
  if (oldest) {
    roomTurnsCache.delete(oldest)
    roomStreamCache.delete(oldest)
    roomAbortCache.delete(oldest)
    roomLastAccess.delete(oldest)
  }
}

/** Sweep entries that haven't been accessed in >30 min. */
function cacheSweep() {
  const now = Date.now()
  for (const [id, time] of roomLastAccess) {
    if (now - time > CACHE_TTL_MS) {
      roomTurnsCache.delete(id)
      roomStreamCache.delete(id)
      roomAbortCache.delete(id)
      roomLastAccess.delete(id)
    }
  }
}

function cacheTurnsSet(roomId: string, turns: QATurn[]) {
  evictIfNeeded()
  roomTurnsCache.set(roomId, turns)
  roomLastAccess.set(roomId, Date.now())
}

function getRoomStream(roomId: string): RoomCacheEntry {
  let e = roomStreamCache.get(roomId)
  if (!e) {
    e = { streamContent: "", streamThinking: "", toolCalls: [], loading: false }
    roomStreamCache.set(roomId, e)
  }
  roomLastAccess.set(roomId, Date.now())
  return e
}

function restoreRoomStream(roomId: string | null) {
  if (!roomId) return { streamContent: "", streamThinking: "", toolCalls: [] as ActiveToolCall[], loading: false }
  return roomStreamCache.get(roomId) ?? { streamContent: "", streamThinking: "", toolCalls: [] as ActiveToolCall[], loading: false }
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
  const firstQuestionRef = useRef(false)

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

  // ── Sync streaming state from global cache ──────────────────
  // When user switches away and back while an SSE stream is still
  // running, the old callbacks update only the module-level cache
  // (the old React setters are stale). This effect polls the cache
  // to keep the new component's React state in sync.
  useEffect(() => {
    if (!activeRoomId) return
    const entry = roomStreamCache.get(activeRoomId)
    if (!entry?.loading) return

    const interval = setInterval(() => {
      const e = roomStreamCache.get(activeRoomId!)
      if (!e) { clearInterval(interval); return }
      setStreamingContent(e.streamContent)
      setStreamingThinking(e.streamThinking)
      setActiveToolCalls(e.toolCalls)
      if (!e.loading) {
        clearInterval(interval)
        setLoading(false)
        setStreamingContent("")
        setStreamingThinking("")
      }
    }, 100)

    return () => clearInterval(interval)
  }, [activeRoomId])

  // ── Auto-select most recent room on mount ──────────────────
  // Prioritises rooms with an active stream/async task in the
  // global cache (survived unmount), so the user sees their
  // in-progress conversation when switching back to Helpdesk.

  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true

    async function loadLatestRoom() {
      try {
        cacheSweep() // evict expired entries on mount

        // ══ Check global cache for rooms with active streams first ══
        for (const [roomId, stream] of roomStreamCache) {
          if (stream.loading) {
            const cachedTurns = roomTurnsCache.get(roomId) || []
            setActiveRoomId(roomId)
            setTurns(cachedTurns)
            firstQuestionRef.current = cachedTurns.length > 0
            setStreamingContent(stream.streamContent)
            setStreamingThinking(stream.streamThinking)
            setActiveToolCalls(stream.toolCalls)
            setLoading(stream.loading)
            return // ← restored active room, skip DB
          }
        }

        // ══ No active streams — load latest room from DB ══
        const res = await fetch("/api/helpdesk/conversations")
        if (!res.ok) return
        const data = await res.json()
        const conversations = (data.conversations || []) as ChatRoom[]
        if (conversations.length === 0) return

        const latest = conversations[0] // already sorted by updatedAt desc
        // Check cache first for this room
        const cached = roomTurnsCache.get(latest.id)
        if (cached) {
          setActiveRoomId(latest.id)
          setTurns(cached)
          firstQuestionRef.current = cached.length > 0
          return
        }

        // Load full conversation with messages from DB
        const detailRes = await fetch(
          `/api/helpdesk/conversations?id=${encodeURIComponent(latest.id)}`
        )
        if (!detailRes.ok) return
        const detailData = await detailRes.json()
        const conv = detailData.conversation
        const messages = (conv?.messages as QATurn[]) || []

        cacheTurnsSet(latest.id, messages)
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

      cacheSweep() // evict expired entries before adding new ones

      // Save current turns + streaming state for old room
      if (activeRoomId) {
        if (turns.length > 0) {
          cacheTurnsSet(activeRoomId, turns)
          persistMessages(activeRoomId, turns)
        }
        // Save streaming state (don't lose in-progress AI)
        getRoomStream(activeRoomId).streamContent = streamingContent
        getRoomStream(activeRoomId).streamThinking = streamingThinking
        getRoomStream(activeRoomId).toolCalls = activeToolCalls
        getRoomStream(activeRoomId).loading = loading
      }

      // Try loading turns from local cache first
      const cached = roomTurnsCache.get(roomId)
      if (cached) {
        setActiveRoomId(roomId)
        setTurns(cached)
        firstQuestionRef.current = cached.length > 0
        const rs = restoreRoomStream(roomId)
        setStreamingContent(rs.streamContent)
        setStreamingThinking(rs.streamThinking)
        setActiveToolCalls(rs.toolCalls)
        setLoading(rs.loading)
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
          cacheTurnsSet(roomId, dbMessages)
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
      const rs2 = restoreRoomStream(roomId)
      setStreamingContent(rs2.streamContent)
      setStreamingThinking(rs2.streamThinking)
      setActiveToolCalls(rs2.toolCalls)
      setLoading(rs2.loading)
    },
    [activeRoomId, turns, streamingContent, streamingThinking, activeToolCalls, loading, persistMessages]
  )

  // ── Start a fresh room ───────────────────────────────────────

  const handleNewRoom = useCallback(async () => {
    // Save current turns + streaming state to DB before switching
    if (activeRoomId) {
      if (turns.length > 0) {
        cacheTurnsSet(activeRoomId, turns)
        persistMessages(activeRoomId, turns)
      }
      getRoomStream(activeRoomId).streamContent = streamingContent
      getRoomStream(activeRoomId).streamThinking = streamingThinking
      getRoomStream(activeRoomId).toolCalls = activeToolCalls
      getRoomStream(activeRoomId).loading = loading
    }

    const newId = await createNewRoom()
    if (newId) {
      setActiveRoomId(newId)
      setTurns([])
      firstQuestionRef.current = false
      const rs3 = restoreRoomStream(newId)
      setStreamingContent(rs3.streamContent)
      setStreamingThinking(rs3.streamThinking)
      setActiveToolCalls(rs3.toolCalls)
      setLoading(rs3.loading)
      setError(null)
    }
  }, [activeRoomId, turns, streamingContent, streamingThinking, activeToolCalls, loading, createNewRoom, persistMessages])

  // ── Delete room ──────────────────────────────────────────────

  const handleDeleteRoom = useCallback(
    (roomId: string) => {
      // Abort any active AI stream for this room
      roomAbortCache.get(roomId)?.abort()
      roomAbortCache.delete(roomId)

      // Clean up all refs for this room
      roomTurnsCache.delete(roomId)
      roomStreamCache.delete(roomId)
      if (activeStreamRoomId === roomId) {
        activeStreamRoomId = null
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

    // ── All turn operations use roomTurnsCache (per-room, never shared) ──
    const roomTurns = roomTurnsCache.get(capturedRoomId) || []
    const turnsWithUser = [...roomTurns, { role: "user" as const, content: userContent }]
    cacheTurnsSet(capturedRoomId, turnsWithUser)
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
    const streamState = getRoomStream(capturedRoomId)
    streamState.streamContent = ""
    streamState.streamThinking = ""
    streamState.toolCalls = []
    streamState.loading = true
    activeStreamRoomId = capturedRoomId

    // Create AbortController for this room (abort previous if exists)
    roomAbortCache.get(capturedRoomId)?.abort()
    const abortController = new AbortController()
    roomAbortCache.set(capturedRoomId, abortController)

    // Check if room still exists (hasn't been deleted)
    const roomExists = () => roomTurnsCache.has(capturedRoomId) || activeRoomId === capturedRoomId

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
            streamState.streamThinking = latestThinking
            if (activeRoomId === capturedRoomId) setStreamingThinking(latestThinking)
          },

          onToken: (text) => {
            if (!roomExists()) return
            latestContent += text
            streamState.streamContent = latestContent
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

            const currentTurns = roomTurnsCache.get(capturedRoomId) || []
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
            cacheTurnsSet(capturedRoomId, updated)
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
            const currentTurns = roomTurnsCache.get(capturedRoomId) || []
            const updated = [
              ...currentTurns,
              { role: "assistant" as const, content: `Sorry, something went wrong: ${detail}` },
            ]
            cacheTurnsSet(capturedRoomId, updated)
            if (activeRoomId === capturedRoomId) setTurns(updated)
          },

          onUpgradeToAsync: (taskId) => {
            if (!roomExists()) return
            // Stop streaming — the task is now handled by the Python worker
            streamState.loading = false
            if (activeStreamRoomId === capturedRoomId) {
              activeStreamRoomId = null
            }
            // Start background polling; the placeholder UI is set by handleUpgradeToAsync
            handleUpgradeToAsync(capturedRoomId, taskId, userContent)
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
      activeStreamRoomId = null
      roomAbortCache.delete(capturedRoomId)
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
        const currentTurns = roomTurnsCache.get(roomId) || []
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
        cacheTurnsSet(roomId, updated)
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

  // ── Upgrade to async (called when backend detects complex task) ──

  async function handleUpgradeToAsync(
    capturedRoomId: string,
    taskId: string,
    userContent: string
  ) {
    const roomTurns = roomTurnsCache.get(capturedRoomId) || []

    // Add placeholder turn showing background processing
    const turnsWithPlaceholder = [
      ...roomTurns,
      {
        role: "assistant" as const,
        content: "📥 **已自動轉入背景處理** — 正在為您查閱知識庫 / 執行工單流程，您可以先切換到其他聊天室，完成後將自動為您呈現結果。",
        needsEscalation: false,
      },
    ]
    cacheTurnsSet(capturedRoomId, turnsWithPlaceholder)
    persistMessages(capturedRoomId, turnsWithPlaceholder)

    if (activeRoomId === capturedRoomId) {
      setTurns(turnsWithPlaceholder)
      setLoading(false)
      setStreamingContent("")
      setStreamingThinking("")
      setActiveToolCalls([])
    }

    const streamState = getRoomStream(capturedRoomId)
    streamState.loading = false

    setSidebarRefreshKey((k) => k + 1)

    // Poll for result in background
    try {
      const result = await waitForTaskResult(taskId, 120000)

      if (result.status === "completed" && result.result) {
        const answer = result.result.answer || "No response."

        const currentTurns = roomTurnsCache.get(capturedRoomId) || []
        // Replace the placeholder with the actual answer
        const withoutPlaceholder = currentTurns.filter(
          (t) => !t.content.startsWith("📥 **已自動轉入背景處理**")
        )
        const updated = [
          ...withoutPlaceholder,
          {
            role: "assistant" as const,
            content: answer,
            thinking: result.result.thinking || undefined,
            sources: result.result.sources,
            needsEscalation: result.result.needsEscalation,
            suggestedDepartment: result.result.suggestedDepartment,
          },
        ]
        cacheTurnsSet(capturedRoomId, updated)
        persistMessages(capturedRoomId, updated)

        if (activeRoomId === capturedRoomId) {
          setTurns(updated)
        }
        setSidebarRefreshKey((k) => k + 1)
      } else {
        throw new Error(result.error || "Background processing failed")
      }
    } catch (err) {
      const errorMsg = (err as Error).message || "Background processing failed"
      const currentTurns = roomTurnsCache.get(capturedRoomId) || []
      const withoutPlaceholder = currentTurns.filter(
        (t) => !t.content.startsWith("📥 **已自動轉入背景處理**")
      )
      const updated = [
        ...withoutPlaceholder,
        { role: "assistant" as const, content: `Sorry, something went wrong: ${errorMsg}` },
      ]
      cacheTurnsSet(capturedRoomId, updated)
      if (activeRoomId === capturedRoomId) setTurns(updated)
    }
  }

  // ── Suggested questions for current department ───────────────

  const suggestions =
    SUGGESTED_QUESTIONS[department] || SUGGESTED_QUESTIONS.GENERAL

  const conversationTitle = activeRoomId
    ? roomTurnsCache.get(activeRoomId)?.[0]?.content?.slice(0, 60) ||
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
