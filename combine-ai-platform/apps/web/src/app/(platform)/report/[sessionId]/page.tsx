"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import {
  Download,
  Loader2,
  Brain,
  BarChart3,
  ArrowLeft,
  FileText,
  BookOpen,
  Sparkles,
  Plus,
  Trash2,
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
const PdfHighlightViewer = dynamic(
  () => import("@/features/report/components/pdf-highlight-viewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center min-h-[300px] bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
      </div>
    ),
  }
)

interface TableRow {
  field: string
  value: string
  page?: number
}

interface ReportSummary {
  summary: string
  keyPoints: string[]
  kbReferences: Array<{
    articleTitle: string
    knowledgeBaseName: string
    relevance: string
  }>
  searchType: "semantic" | "keyword" | "none"
}

interface SessionData {
  id: string
  title: string
  status: string
  rows?: TableRow[]
  summary?: ReportSummary | null
  draftNote?: string | null
  updatedAt: string
}

export default function ReportSessionPage() {
  const params = useParams()
  const sessionId = params?.sessionId as string

  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [extractedRows, setExtractedRows] = useState<TableRow[]>([])
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null)
  const [highlightEnabled, setHighlightEnabled] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{
    page?: number
    field: string
    value: string
  } | null>(null)
  const [model, setModel] = useState(DEFAULT_MODELS.report)
  const [summarizing, setSummarizing] = useState(false)
  const [rowsManuallyEdited, setRowsManuallyEdited] = useState(false)
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null)
  const [editingField, setEditingField] = useState("")
  const [editingValue, setEditingValue] = useState("")
  const [refineInstruction, setRefineInstruction] = useState("")
  const [refining, setRefining] = useState(false)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileAvailable, setFileAvailable] = useState(false)
  const [fileChecked, setFileChecked] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const summaryFetchedRef = useRef(false)

  // ── Load session data ──
  const loadSession = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch("/api/report/sessions")
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { detail?: string; error?: string }).detail ||
            (body as { error?: string }).error ||
            `Failed to load sessions (${res.status})`
        )
      }
      const data = await res.json()
      const found = (data.sessions || []).find((s: SessionData) => s.id === sessionId)
      if (found) {
        setSession(found)
        if (found.rows && Array.isArray(found.rows)) {
          setExtractedRows(found.rows as TableRow[])
        }
        // Load cached summary from DB — avoids re-calling AI
        if (found.summary && !reportSummary) {
          setReportSummary(found.summary as ReportSummary)
          summaryFetchedRef.current = true
        }
        // Stop polling when done or failed
        if (found.status === "completed" || found.status === "failed" || found.status === "active") {
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      } else {
        setError("Session not found")
      }
    } catch (err) {
      console.error("Failed to load session:", err)
      setError(err instanceof Error ? err.message : "Failed to load session")
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Initial load
  useEffect(() => {
    loadSession()
  }, [loadSession])

  // Set up file preview URL — check if file actually exists
  useEffect(() => {
    if (!sessionId) return
    const url = `/api/report/sessions/${encodeURIComponent(sessionId)}/file`
    setFileUrl(url)
    setFileName(session?.title || "Document")
    // Check if file is available
    fetch(url, { method: "HEAD" })
      .then((r) => {
        if (r.ok) setFileAvailable(true)
      })
      .catch(() => setFileAvailable(false))
      .finally(() => setFileChecked(true))
  }, [sessionId, session?.title])

  // Poll while processing
  useEffect(() => {
    if (session?.status === "processing" && !intervalRef.current) {
      intervalRef.current = setInterval(loadSession, 3000)
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [session?.status, loadSession])

  // When extraction completes (rows appear), generate summary automatically
  useEffect(() => {
    if (
      extractedRows.length > 0 &&
      !reportSummary &&
      !summarizing &&
      !summaryFetchedRef.current &&
      (session?.status === "completed" || session?.status === "active")
    ) {
      summaryFetchedRef.current = true
      fetchSummary(extractedRows)
    }
  }, [extractedRows, reportSummary, summarizing, session?.status])

  async function fetchSummary(rows: TableRow[]) {
    setSummarizing(true)
    try {
      const res = await fetch("/api/report/agent?action=summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          fileName: session?.title,
        }),
      })
      if (res.ok) {
        const summary = (await res.json()) as ReportSummary
        setReportSummary(summary)
        setRowsManuallyEdited(false)
        // Persist to DB so it's available on subsequent page loads
        await fetch("/api/report/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId, summary }),
        }).catch((err) => console.error("Failed to persist summary:", err))
      }
    } catch (err) {
      console.error("Failed to fetch summary:", err)
    } finally {
      setSummarizing(false)
    }
  }

  // ── Row editing handlers ──
  function startEditRow(index: number) {
    const row = extractedRows[index]
    if (!row) return
    setEditingRowIndex(index)
    setEditingField(row.field)
    setEditingValue(row.value)
  }

  function saveEditRow() {
    if (editingRowIndex === null) return
    const updated = [...extractedRows]
    updated[editingRowIndex] = {
      ...updated[editingRowIndex],
      field: editingField.trim() || updated[editingRowIndex].field,
      value: editingValue.trim(),
    }
    setExtractedRows(updated)
    setEditingRowIndex(null)
    setEditingField("")
    setEditingValue("")
    persistRows(updated)
    setRowsManuallyEdited(true)
  }

  function cancelEditRow() {
    setEditingRowIndex(null)
    setEditingField("")
    setEditingValue("")
  }

  function deleteRow(index: number) {
    const updated = extractedRows.filter((_, i) => i !== index)
    setExtractedRows(updated)
    if (editingRowIndex === index) cancelEditRow()
    persistRows(updated)
    setRowsManuallyEdited(true)
  }

  function addRow() {
    const updated = [...extractedRows, { field: "New Field", value: "" }]
    setExtractedRows(updated)
    setRowsManuallyEdited(true)
    setEditingRowIndex(extractedRows.length)
    setEditingField("New Field")
    setEditingValue("")
  }

  function moveRow(from: number, to: number) {
    if (to < 0 || to >= extractedRows.length) return
    const updated = [...extractedRows]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    setExtractedRows(updated)
    if (editingRowIndex === from) setEditingRowIndex(to)
    else if (editingRowIndex === to) setEditingRowIndex(from)
    persistRows(updated)
    setRowsManuallyEdited(true)
  }

  async function persistRows(rows: TableRow[]) {
    if (!sessionId) return
    try {
      await fetch("/api/report/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId, rows }),
      })
    } catch (err) {
      console.error("Failed to persist rows:", err)
    }
  }

  // ── Refine with AI ──
  async function handleRefine() {
    if (!refineInstruction.trim() || extractedRows.length === 0) return
    setRefining(true)
    try {
      const res = await fetch("/api/report/agent?action=refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          currentRows: extractedRows,
          instructions: refineInstruction,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || "Refinement failed")
      }
      const data = (await res.json()) as { rows?: TableRow[]; changes?: string; applied?: boolean }
      if (data.rows && data.rows.length > 0) {
        setExtractedRows(data.rows)
        persistRows(data.rows)
        setRowsManuallyEdited(false)
        // Re-generate summary with refined data
        summaryFetchedRef.current = false
        setReportSummary(null)
      }
      setRefineInstruction("")
    } catch (err) {
      console.error("Refine error:", err)
      setError(err instanceof Error ? err.message : "Failed to refine extraction")
    } finally {
      setRefining(false)
    }
  }

  async function downloadExportBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportWord() {
    if (!reportSummary) return
    try {
      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "docx",
          rows: extractedRows.length > 0 ? extractedRows : undefined,
          summary: reportSummary.summary,
          keyPoints: reportSummary.keyPoints,
          kbReferences: reportSummary.kbReferences,
          fileName: session?.title || fileName || undefined,
        }),
      })
      if (!res.ok) throw new Error("Export failed")
      await downloadExportBlob(await res.blob(), `report-summary-${Date.now()}.docx`)
    } catch (err) {
      console.error("Export Word error:", err)
    }
  }

  async function exportExcel() {
    if (extractedRows.length === 0) return
    try {
      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "xlsx",
          rows: extractedRows,
        }),
      })
      if (!res.ok) throw new Error("Export failed")
      await downloadExportBlob(await res.blob(), `report-export-${Date.now()}.xlsx`)
    } catch (err) {
      console.error("Export Excel error:", err)
    }
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error || "Session not found"}</p>
          <Link href="/report" className="text-sm text-primary hover:underline">
            Back to Report Agent
          </Link>
        </div>
      </div>
    )
  }

  const isProcessing = session.status === "processing"
  const isPdfPreview = fileAvailable && fileName?.toLowerCase().endsWith(".pdf")

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/report"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-lg font-semibold">{session.title}</h1>
          <StatusBadge status={session.status} />
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector value={model} onChange={setModel} />
          <button
            type="button"
            onClick={exportWord}
            disabled={!reportSummary}
            className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export Word (.docx)
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={extractedRows.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export Excel (.xlsx)
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel ── */}
        <div className="w-1/2 overflow-y-auto border-r p-6">
          {/* Processing indicator */}
          {isProcessing && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <Brain className="h-5 w-5 animate-pulse text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-800">AI is analyzing your document...</p>
                <p className="text-xs text-blue-600">
                  You can navigate away — analysis continues in the background. Results will appear here automatically.
                </p>
              </div>
              <Loader2 className="ml-auto h-4 w-4 animate-spin text-blue-500" />
            </div>
          )}

          {/* Failed status */}
          {session.status === "failed" && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">Analysis failed</p>
              <p className="text-xs text-red-600">
                Something went wrong during document analysis. Try uploading the document again.
              </p>
              <Link
                href="/report"
                className="mt-2 inline-block text-sm font-medium text-red-700 hover:underline"
              >
                Go to Report Agent →
              </Link>
            </div>
          )}

          {/* ── Extracted Data Table ── */}
          {extractedRows.length > 0 && (
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Extracted Data</h2>
                  <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                    {extractedRows.length} fields
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addRow}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Plus className="h-3 w-3" />
                    Add Row
                  </button>
                  {rowsManuallyEdited && (
                    <span className="text-[10px] text-amber-600">(edited)</span>
                  )}
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr>
                      <th className="w-12 px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                        #
                      </th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                        Field
                      </th>
                      <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                        Value
                      </th>
                      <th className="w-12 px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">
                        Pg
                      </th>
                      <th className="w-20 px-2 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractedRows.map((row, i) => (
                      <tr
                        key={i}
                        className={cn(
                          "border-t transition-colors",
                          editingRowIndex === i
                            ? "bg-primary/5"
                            : "hover:bg-muted/30 cursor-pointer"
                        )}
                        onDoubleClick={() => {
                          setHighlightEnabled(true)
                          setFocusTarget({
                            page: row.page,
                            field: row.field,
                            value: row.value,
                          })
                        }}
                        title="Double-click to highlight in PDF"
                      >
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                          {i + 1}
                        </td>
                        {editingRowIndex === i ? (
                          <>
                            <td className="px-1 py-1">
                              <input
                                value={editingField}
                                onChange={(e) => setEditingField(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEditRow()
                                  if (e.key === "Escape") cancelEditRow()
                                }}
                                className="w-full rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                autoFocus
                              />
                            </td>
                            <td className="px-1 py-1">
                              <input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEditRow()
                                  if (e.key === "Escape") cancelEditRow()
                                }}
                                className="w-full rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </td>
                          </>
                        ) : (
                          <>
                            <td
                              className="cursor-pointer px-2 py-1.5 text-xs font-medium"
                              onClick={() => startEditRow(i)}
                              title="Click to edit"
                            >
                              {row.field}
                            </td>
                            <td
                              className="cursor-pointer px-2 py-1.5 text-xs"
                              onClick={() => startEditRow(i)}
                              title="Click to edit"
                            >
                              {row.value || (
                                <span className="italic text-muted-foreground/50">
                                  empty
                                </span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                          {row.page || "—"}
                        </td>
                        <td className="px-1 py-1 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {editingRowIndex === i ? (
                              <>
                                <button
                                  onClick={saveEditRow}
                                  className="rounded p-0.5 text-green-600 hover:bg-green-50"
                                  title="Save"
                                >
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                </button>
                                <button
                                  onClick={cancelEditRow}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                  title="Cancel"
                                >
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEditRow(i)}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="Edit"
                                >
                                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button
                                  onClick={() => moveRow(i, i - 1)}
                                  disabled={i === 0}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-20"
                                  title="Move up"
                                >
                                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>
                                </button>
                                <button
                                  onClick={() => deleteRow(i)}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Refine with AI */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={refineInstruction}
                    onChange={(e) => setRefineInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleRefine()
                      }
                    }}
                    placeholder="Ask AI to refine the extraction (e.g., combine duplicate fields, fix dates)..."
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={refining}
                  />
                  <button
                    onClick={handleRefine}
                    disabled={refining || !refineInstruction.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {refining ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {refining ? "Refining..." : "Refine with AI"}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  AI will modify, add, or remove fields based on your instruction. You can also edit fields directly by clicking them.
                </p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {extractedRows.length === 0 && !isProcessing && (
            <div className="mb-6 flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                {session.status === "active"
                  ? "No data extracted yet."
                  : "No extracted data available."}
              </p>
              <Link
                href="/report"
                className="mt-2 text-sm text-primary hover:underline"
              >
                Upload a document in Report Agent →
              </Link>
            </div>
          )}

          {/* ── Report Summary ── */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Report Summary</h2>
                {reportSummary && reportSummary.searchType !== "none" && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    KB {reportSummary.searchType === "semantic" ? "語意搜尋" : "關鍵字搜尋"}
                  </span>
                )}
              </div>
              {rowsManuallyEdited && reportSummary && (
                <button
                  type="button"
                  onClick={() => fetchSummary(extractedRows)}
                  disabled={summarizing || extractedRows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  {summarizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Refresh summary
                </button>
              )}
            </div>
            {rowsManuallyEdited && reportSummary && (
              <p className="mb-3 text-[10px] text-amber-600">
                Row data changed — refresh to update summary text
              </p>
            )}

            {summarizing || isProcessing ? (
              <div className="flex h-32 flex-col items-center justify-center rounded-lg border bg-muted/20 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {isProcessing ? "Waiting for extraction to complete..." : "Generating summary..."}
                </p>
              </div>
            ) : extractedRows.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed text-center">
                <BookOpen className="h-7 w-7 text-muted-foreground/40" />
                <p className="mt-2 text-xs text-muted-foreground">
                  Upload a document to generate an AI summary
                </p>
              </div>
            ) : !reportSummary ? (
              <div className="space-y-2">
                <div className="flex h-32 flex-col items-center justify-center rounded-lg border bg-muted/20 text-center">
                  <BookOpen className="h-6 w-6 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">Summary not yet generated</p>
                </div>
                <button
                  onClick={() => {
                    summaryFetchedRef.current = false
                    fetchSummary(extractedRows)
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  <Sparkles className="h-4 w-4" />
                  Generate Summary
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">總述</p>
                  <p className="text-sm leading-relaxed">{reportSummary.summary}</p>
                </div>

                {reportSummary.keyPoints.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      知識庫相關要點
                    </p>
                    <ul className="space-y-1.5">
                      {reportSummary.keyPoints.map((point, i) => (
                        <li key={i} className="flex gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                          <span className="mt-0.5 shrink-0 text-primary">•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {reportSummary.kbReferences.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      參考條文
                    </p>
                    <div className="space-y-2">
                      {reportSummary.kbReferences.map((ref, i) => (
                        <div key={i} className="rounded-md border bg-accent/20 px-3 py-2">
                          <p className="text-sm font-medium">{ref.articleTitle}</p>
                          <p className="text-xs text-muted-foreground">{ref.knowledgeBaseName}</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ref.relevance}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel: PDF Preview ── */}
        <div className="flex w-1/2 flex-col overflow-hidden">
          {!fileChecked ? (
            <div className="flex h-full items-center justify-center bg-muted/20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
            </div>
          ) : isPdfPreview && fileUrl ? (
            <PdfHighlightViewer
              fileUrl={fileUrl}
              fileName={fileName || "Document"}
              highlights={[]}
              highlightEnabled={highlightEnabled}
              onHighlightEnabledChange={setHighlightEnabled}
              focusTarget={focusTarget}
              className="h-full"
            />
          ) : fileAvailable && fileUrl ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted/20 text-center">
              <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-10">
                <FileText className="mx-auto h-14 w-14 text-muted-foreground/30" />
                <p className="mt-4 text-sm font-medium text-muted-foreground">Document Available</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  {fileName || "Document"} is available but not a PDF.
                  <br />
                  Download it to view the full content.
                </p>
                <a
                  href={fileUrl}
                  download={fileName || "document"}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted/20 text-center">
              <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-10">
                <FileText className="mx-auto h-14 w-14 text-muted-foreground/30" />
                <p className="mt-4 text-sm font-medium text-muted-foreground">No Document</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  No file was stored for this session.
                  <br />
                  Upload a document from the Report Agent to see it here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    processing: { label: "Processing", className: "bg-blue-100 text-blue-700" },
    completed: { label: "Done", className: "bg-green-100 text-green-700" },
    failed: { label: "Failed", className: "bg-red-100 text-red-700" },
    active: { label: "Ready", className: "bg-muted text-muted-foreground" },
  }
  const cfg = config[status] || { label: status, className: "bg-muted text-muted-foreground" }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {cfg.label}
    </span>
  )
}
