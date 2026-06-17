// Client-side API for Helpdesk Agent
// Follows the pattern established by features/email/api/email-client.ts
// and features/context/api/context-client.ts

// ── Types ────────────────────────────────────────────────────────

export interface HelpdeskMessage {
  role: "user" | "assistant"
  content: string
}

export interface ChatRequest {
  messages: HelpdeskMessage[]
  department?: string
  conversationId?: string
  model?: string
}

export interface ChatResponse {
  conversationId: string
  answer: string
  sources: Array<{
    articleId: string
    articleTitle: string
    excerpt: string
  }>
  confidence: number
  needsEscalation: boolean
  suggestedDepartment: string
  ticketId?: string
}

export interface StreamCallbacks {
  onThinking?: (text: string) => void
  onToken?: (text: string) => void
  onToolUse?: (name: string, args: Record<string, unknown>) => void
  onToolResult?: (name: string, summary: string) => void
  onResult?: (result: ChatResponse, thinkingProcess?: string) => void
  onError?: (detail: string) => void
  onTrace?: (trace: {
    id: string
    stage: string
    status: string
    title: string
    detail?: string
  }) => void
  /** Fired when the backend auto-upgrades a complex request to async processing */
  onUpgradeToAsync?: (taskId: string, conversationId: string) => void
}

// ── Non-streaming Chat ───────────────────────────────────────────

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch("/api/helpdesk/agent?action=chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }))
    throw new Error(err.error || `Chat failed: ${res.status}`)
  }

  return res.json()
}

// ── Streaming Chat ───────────────────────────────────────────────

export interface StreamOptions {
  signal?: AbortSignal
}

export async function chatStream(
  req: ChatRequest,
  callbacks: StreamCallbacks,
  options?: StreamOptions
): Promise<void> {
  const res = await fetch("/api/helpdesk/agent?action=chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: options?.signal,
  })

  if (!res.ok || !res.body) {
    if (options?.signal?.aborted) return
    callbacks.onError?.(
      res.ok ? "No response body" : `Request failed: ${res.status}`
    )
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    if (options?.signal?.aborted) {
      reader.cancel()
      return
    }
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() || ""

    for (const part of parts) {
      const lines = part.split("\n")
      let eventType = "message"
      let dataStr = ""

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          dataStr = line.slice(5).trim()
        }
      }

      if (!dataStr) continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(dataStr)
      } catch {
        continue
      }

      switch (eventType) {
        case "trace":
          callbacks.onTrace?.(parsed.trace as StreamCallbacks["onTrace"] extends (t: infer T) => void ? T : never)
          break
        case "thinking":
          callbacks.onThinking?.((parsed.text as string) || "")
          break
        case "token":
          callbacks.onToken?.((parsed.text as string) || "")
          break
        case "tool_use":
          callbacks.onToolUse?.(
            (parsed.name as string) || "",
            (parsed.args as Record<string, unknown>) || {}
          )
          break
        case "tool_result":
          callbacks.onToolResult?.(
            (parsed.name as string) || "",
            (parsed.summary as string) || ""
          )
          break
        case "result":
          callbacks.onResult?.(
            parsed.result as ChatResponse,
            (parsed.thinkingProcess as string) || undefined
          )
          break
        case "error":
          callbacks.onError?.((parsed.detail as string) || "Unknown error")
          break
        case "upgrade_to_async":
          callbacks.onUpgradeToAsync?.(
            (parsed.taskId as string) || "",
            (parsed.conversationId as string) || ""
          )
          break
      }
    }
  }
}

// ── Async Chat (Redis queue + Python worker) ─────────────────────
// Returns immediately with taskId; caller polls for result

export interface AsyncChatResponse {
  taskId: string
  conversationId: string
  status: "queued"
  message: string
}

export interface PollStatusResponse {
  status: "queued" | "processing" | "completed" | "error" | "expired"
  result?: ChatResponse & { thinking?: string }
  error?: string
}

export async function chatAsync(req: ChatRequest): Promise<AsyncChatResponse> {
  const res = await fetch("/api/helpdesk/agent?action=chat-async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }))
    throw new Error(err.error || `Chat async failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Poll for the result of an async chat task.
 * Returns null if the task is still pending, the result when completed.
 * Throws on error status.
 */
export async function pollTaskStatus(
  taskId: string
): Promise<PollStatusResponse> {
  const res = await fetch(`/api/helpdesk/agent/status/${encodeURIComponent(taskId)}`)

  if (!res.ok) {
    if (res.status === 404) {
      return { status: "expired" }
    }
    const err = await res.json().catch(() => ({ error: "Poll failed" }))
    throw new Error(err.error || `Poll failed: ${res.status}`)
  }

  return res.json()
}

/**
 * Poll repeatedly until the task completes or times out.
 * @param taskId - The task ID to poll
 * @param maxWaitMs - Maximum time to wait (default 60s)
 * @param intervalMs - Poll interval (default 1000ms)
 */
export async function waitForTaskResult(
  taskId: string,
  maxWaitMs = 60000,
  intervalMs = 1000
): Promise<PollStatusResponse> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const status = await pollTaskStatus(taskId)

    if (status.status === "completed" || status.status === "error" || status.status === "expired") {
      return status
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return { status: "expired", error: "Task timed out" }
}
