"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface ReportSession {
  id: string
  title: string
  status: string
  updatedAt: string
  rows?: Array<{ field: string; value: string }>
}

export default function BatchExportPage() {
  const [sessions, setSessions] = useState<ReportSession[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetch("/api/report/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sessions) setSessions(data.sessions)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function toggleSession(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === sessions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sessions.map((s) => s.id)))
    }
  }

  async function exportSelected() {
    if (selected.size === 0) return

    setExporting(true)
    try {
      // Collect all rows from selected sessions
      const allRows: Array<{ field: string; value: string }> = []

      for (const session of sessions) {
        if (!selected.has(session.id)) continue

        // Fetch full session data
        const res = await fetch(`/api/report/sessions`)
        const data = await res.json()
        const fullSession = (data.sessions || []).find(
          (s: ReportSession) => s.id === session.id
        )

        if (fullSession?.rows && Array.isArray(fullSession.rows)) {
          // Add section header
          allRows.push({ field: `=== ${session.title} ===`, value: "" })
          for (const row of fullSession.rows) {
            allRows.push(row)
          }
          allRows.push({ field: "", value: "" }) // spacer
        }
      }

      if (allRows.length === 0) {
        console.error("No data to export")
        return
      }

      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: allRows, format: "xlsx" }),
      })

      if (!res.ok) throw new Error("Export failed")

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `batch-report-${Date.now()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Batch export error:", err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/report" className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Batch Export</h1>
        </div>
        <button
          disabled={selected.size === 0 || exporting}
          onClick={exportSelected}
          className={cn(
            "inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground",
            "disabled:opacity-50"
          )}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {exporting ? "Exporting..." : `Export Selected (${selected.size})`}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">No report sessions</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create report sessions first, then export them in batch.
            </p>
            <Link href="/report" className="mt-4 text-sm text-primary hover:underline">
              Go to Report Agent
            </Link>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""} available
              </p>
              <button
                onClick={toggleAll}
                className="text-sm text-primary hover:underline"
              >
                {selected.size === sessions.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="space-y-2">
              {sessions.map((session) => (
                <label
                  key={session.id}
                  className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(session.id)}
                    onChange={() => toggleSession(session.id)}
                    className="h-4 w-4 rounded border-primary accent-primary"
                  />
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{session.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.updatedAt).toLocaleDateString("en-HK", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      session.status === "active"
                        ? "bg-green-500/10 text-green-600"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {session.status || "active"}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
