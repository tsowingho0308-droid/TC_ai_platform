"use client"

import { useState, useRef, useEffect } from "react"
import { Loader2, MessageSquare, Plus, Send } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import {
  ReportExtractionTable,
  type ExtractionRow,
} from "@/features/report/components/report-extraction-table"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

interface ReportExtractionPanelProps {
  rows: ExtractionRow[]
  sessionId?: string | null
  onUpdateRow: (index: number, update: Partial<ExtractionRow>) => void
  onAddRow: () => void
  onDeleteRow: (index: number) => void
  onRowsReplace: (rows: ExtractionRow[]) => void
  onRowClick?: (index: number, row: ExtractionRow) => void
  selectedRowIndex?: number | null
  saving?: boolean
  className?: string
}

export function ReportExtractionPanel({
  rows,
  sessionId,
  onUpdateRow,
  onAddRow,
  onDeleteRow,
  onRowsReplace,
  onRowClick,
  selectedRowIndex,
  saving,
  className,
}: ReportExtractionPanelProps) {
  const [command, setCommand] = useState("")
  const [refining, setRefining] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [refineError, setRefineError] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages])

  async function handleRefineCommand() {
    const instructions = command.trim()
    if (!instructions || refining) return

    setRefining(true)
    setRefineError(null)
    setCommand("")

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: instructions,
    }
    setChatMessages((prev) => [...prev, userMsg])

    try {
      const res = await fetch("/api/report/agent?action=refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          instructions,
          currentRows: rows,
        }),
      })

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errData.error || "Refinement failed")
      }

      const data = (await res.json()) as {
        rows?: ExtractionRow[]
        changes?: string
        applied?: boolean
      }

      if (data.rows) {
        onRowsReplace(data.rows)
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.changes || (data.applied ? "Changes applied." : "No changes made."),
        },
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Refinement failed"
      setRefineError(msg)
      setChatMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "assistant", content: msg },
      ])
    } finally {
      setRefining(false)
    }
  }

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">Extracted Fields</h2>
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          Add row
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto border-b">
        <ReportExtractionTable
          rows={rows}
          onUpdateRow={onUpdateRow}
          onAddRow={onAddRow}
          onDeleteRow={onDeleteRow}
          onRowClick={onRowClick}
          selectedRowIndex={selectedRowIndex}
          compact
          hideHeader
        />
      </div>

      {saving && (
        <p className="border-b px-3 py-1 text-[10px] text-muted-foreground">Saving changes…</p>
      )}

      <div className="border-b bg-muted/20 px-3 py-2">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          AI Commands
        </div>
        <div className="max-h-32 space-y-2 overflow-y-auto">
          {chatMessages.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              e.g. 刪除第 3 行、刪除含「備註」的列、把金額欄改成 HKD 格式
            </p>
          ) : (
            chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs",
                  msg.role === "user"
                    ? "ml-4 bg-primary/10 text-foreground"
                    : "mr-4 bg-background border text-muted-foreground"
                )}
              >
                {msg.content}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      <div className="flex gap-2 p-3">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleRefineCommand()
          }}
          placeholder="Tell AI what to change…"
          disabled={refining || rows.length === 0}
          className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleRefineCommand()}
          disabled={refining || !command.trim() || rows.length === 0}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {refineError && (
        <p className="px-3 pb-2 text-xs text-destructive">{refineError}</p>
      )}
    </div>
  )
}
