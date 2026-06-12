"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface ReportSession {
  id: string
  title: string
  status: string
  updatedAt: string
  rows?: Array<{ field: string; value: string }>
}

type ExportFormat = "batch-md" | "batch-xlsx"

export default function BatchExportPage() {
  const [sessions, setSessions] = useState<ReportSession[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

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

  async function exportSelected(format: ExportFormat) {
    if (selected.size === 0) return

    setExporting(format)
    try {
      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          sessionIds: Array.from(selected),
          includeSummaries: true,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || "Export failed")
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download =
        format === "batch-md"
          ? `integrated-report-${Date.now()}.md`
          : `integrated-report-${Date.now()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Batch export error:", err)
    } finally {
      setExporting(null)
    }
  }

  const isExporting = exporting !== null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/report" className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Batch Export</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={selected.size === 0 || isExporting}
            onClick={() => exportSelected("batch-md")}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent",
              "disabled:opacity-50"
            )}
          >
            {exporting === "batch-md" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Export Integrated Report (.md)
          </button>
          <button
            disabled={selected.size === 0 || isExporting}
            onClick={() => exportSelected("batch-xlsx")}
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground",
              "disabled:opacity-50"
            )}
          >
            {exporting === "batch-xlsx" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export Combined Spreadsheet (.xlsx)
          </button>
        </div>
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
                {selected.size > 0 && ` · ${selected.size} selected`}
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
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(session.id)}
                    onChange={() => toggleSession(session.id)}
                    className="h-4 w-4 rounded border-primary accent-primary"
                  />
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{session.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.updatedAt).toLocaleDateString("en-HK", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {session.rows && session.rows.length > 0
                        ? ` · ${session.rows.length} fields`
                        : ""}
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
