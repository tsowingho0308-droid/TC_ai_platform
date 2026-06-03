"use client"

import { useState, useRef, useEffect } from "react"
import { MessageCircleQuestion, Send, Loader2, ExternalLink, Brain, ChevronDown, ChevronUp } from "lucide-react"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"

interface QATurn {
  role: "user" | "assistant"
  content: string
  thinking?: string
  sources?: Array<{ articleId: string; articleTitle: string; excerpt: string }>
  needsEscalation?: boolean
}

export default function HelpdeskPage() {
  const [question, setQuestion] = useState("")
  const [turns, setTurns] = useState<QATurn[]>([])
  const [loading, setLoading] = useState(false)
  const [department, setDepartment] = useState("GENERAL")
  const [model, setModel] = useState(DEFAULT_MODELS.helpdesk)
  const [streamingContent, setStreamingContent] = useState("")
  const [streamingThinking, setStreamingThinking] = useState("")
  const [thinkingExpanded, setThinkingExpanded] = useState(true)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns, streamingContent])

  async function handleAsk() {
    if (!question.trim() || loading) return

    const q = question.trim()
    setQuestion("")
    setTurns((prev) => [...prev, { role: "user", content: q }])
    setLoading(true)
    setStreamingContent("")
    setStreamingThinking("")
    setThinkingExpanded(true)

    try {
      const res = await fetch("/api/helpdesk/agent?action=ask-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, department, model }),
      })

      if (!res.ok || !res.body) {
        // Fallback to non-streaming
        await handleAskFallback(q)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let result: Record<string, unknown> | null = null

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
              eventType = line.slice("event:".length).trim()
            } else if (line.startsWith("data:")) {
              dataStr = line.slice("data:".length).trim()
            }
          }

          if (!dataStr) continue
          let parsed: Record<string, any>
          try { parsed = JSON.parse(dataStr) } catch { continue }

          switch (eventType) {
            case "thinking":
              setStreamingThinking((prev) => prev + (parsed.text || ""))
              break
            case "token":
              setStreamingContent((prev) => prev + (parsed.text || ""))
              break
            case "result":
              result = parsed.result || parsed
              break
            case "error":
              setTurns((prev) => [
                ...prev,
                { role: "assistant", content: `Error: ${parsed.detail || "Unknown error"}` },
              ])
              break
          }
        }
      }

      // Finalize turn
      if (result) {
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: (result.answer as string) || streamingContent || "No response",
            thinking: streamingThinking || undefined,
            sources: result.sources as QATurn["sources"],
            needsEscalation: result.needsEscalation as boolean,
          },
        ])
      } else if (streamingContent) {
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: streamingContent,
            thinking: streamingThinking || undefined,
          },
        ])
      }
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ])
    } finally {
      setLoading(false)
      setStreamingContent("")
      setStreamingThinking("")
    }
  }

  async function handleAskFallback(q: string) {
    try {
      const res = await fetch("/api/helpdesk/agent?action=ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, department }),
      })
      if (res.ok) {
        const data = await res.json()
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer || "Sorry, I could not process this question.",
            sources: data.sources,
            needsEscalation: data.needsEscalation,
          },
        ])
      } else {
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong." },
        ])
      }
    } catch {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: "Network error." },
      ])
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Helpdesk Agent</h1>
          <p className="text-xs text-muted-foreground">AI-powered knowledge base Q&A with deep thinking</p>
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

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircleQuestion className="h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">How can I help you?</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Ask any question about company policies, IT support, HR procedures, or administrative processes.
            </p>
            <div className="mt-6 grid gap-2 w-full max-w-md">
              {[
                "How many annual leave days do I get?",
                "What is the meal allowance for business trips?",
                "How do I request a new laptop?",
                "What is the new employee onboarding process?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); setTimeout(() => handleAsk(), 100) }}
                  className="rounded-lg border px-4 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {turns.map((turn, i) => (
              <div
                key={i}
                className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    turn.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {/* Thinking process (collapsible) */}
                  {turn.thinking && (
                    <details className="mb-2" open>
                      <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium opacity-60 hover:opacity-100">
                        <Brain className="h-3 w-3" />
                        Thinking process
                      </summary>
                      <div className="mt-2 rounded bg-background/50 p-2 text-xs opacity-70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {turn.thinking}
                      </div>
                    </details>
                  )}

                  <p className="text-sm whitespace-pre-wrap">{turn.content}</p>

                  {/* Sources */}
                  {turn.sources && turn.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs font-medium opacity-70">Sources:</p>
                      {turn.sources.map((s, si) => (
                        <div key={si} className="mt-1 flex items-start gap-1">
                          <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 opacity-50" />
                          <span className="text-xs opacity-70">{s.articleTitle}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Escalation */}
                  {turn.needsEscalation && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs opacity-70">
                        Would you like me to escalate this to the appropriate team?
                      </p>
                      <button className="mt-1 text-xs font-medium underline opacity-70 hover:opacity-100">
                        Yes, create a ticket
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Streaming indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-muted px-4 py-3">
                  {streamingThinking && (
                    <details className="mb-2" open={thinkingExpanded}>
                      <summary
                        className="flex cursor-pointer items-center gap-1 text-xs font-medium opacity-60 hover:opacity-100"
                        onClick={(e) => { e.preventDefault(); setThinkingExpanded(!thinkingExpanded) }}
                      >
                        <Brain className="h-3 w-3" />
                        Thinking...
                        {thinkingExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </summary>
                      <div className="mt-2 rounded bg-background/50 p-2 text-xs opacity-70 whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {streamingThinking}
                      </div>
                    </details>
                  )}
                  {streamingContent ? (
                    <p className="text-sm whitespace-pre-wrap">{streamingContent}<span className="animate-pulse">▊</span></p>
                  ) : !streamingThinking ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <p className="text-sm text-muted-foreground">Searching knowledge base...</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t p-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            placeholder="Ask a question about company policies, IT, HR, or admin..."
            className="flex-1 rounded-md border bg-transparent px-4 py-2 text-sm"
            disabled={loading}
          />
          <button
            onClick={handleAsk}
            disabled={loading || !question.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Ask
          </button>
        </div>
      </div>
    </div>
  )
}
