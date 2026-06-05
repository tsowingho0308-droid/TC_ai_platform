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

export async function chatStream(
  req: ChatRequest,
  callbacks: StreamCallbacks
): Promise<void> {
  const res = await fetch("/api/helpdesk/agent?action=chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })

  if (!res.ok || !res.body) {
    callbacks.onError?.(
      res.ok ? "No response body" : `Request failed: ${res.status}`
    )
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
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
      }
    }
  }
}
