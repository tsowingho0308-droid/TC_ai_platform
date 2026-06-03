"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Upload, FileSpreadsheet, Download, Plus, Trash2, Loader2, Brain, BarChart3 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface TableRow {
  field: string
  value: string
}

interface TraceEvent {
  id: string
  at: string
  stage: string
  status: "pending" | "running" | "complete" | "error"
  title: string
  detail?: string
}

export default function ReportPage() {
  const [rows, setRows] = useState<TableRow[]>([])
  const [extracting, setExtracting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [thinkingText, setThinkingText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [streamingStatus, setStreamingStatus] = useState<"idle" | "connecting" | "thinking" | "done" | "error">("idle")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function addRow() {
    setRows([...rows, { field: "", value: "" }])
  }

  function updateRow(index: number, update: Partial<TableRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...update } : r)))
  }

  function deleteRow(index: number) {
    setRows(rows.filter((_, i) => i !== index))
  }

  function resetState() {
    abortRef.current?.abort()
    setExtracting(false)
    setStreamingStatus("idle")
    setTraceEvents([])
    setThinkingText("")
    setError(null)
    setDocumentType(null)
    setConfidence(null)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    resetState()

    // Set preview
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setPreviewFile(file)

    // Start AI extraction
    await extractFromFile(file, note)
  }

  async function extractFromFile(file: File, instructions: string) {
    setExtracting(true)
    setStreamingStatus("connecting")

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // For images, use base64 for vision model support
      const reader = new FileReader()

      const fileDataPromise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error("Failed to read file"))
        if (file.type.startsWith("image/")) {
          reader.readAsDataURL(file)
        } else {
          reader.readAsText(file)
        }
      })

      const fileData = await fileDataPromise

      setStreamingStatus("thinking")

      // Stream extraction
      const response = await fetch("/api/report/agent/run?action=extract&stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: fileData,
          fileName: file.name,
          instructions: instructions || undefined,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(errData.detail || errData.error || `Server error: ${response.status}`)
      }

      if (!response.body) {
        throw new Error("Response body is not available for streaming")
      }

      // Process SSE stream
      const bodyReader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { value, done } = await bodyReader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
        }

        // Process SSE records
        let boundary = buffer.indexOf("\n\n")
        while (boundary >= 0) {
          const record = buffer.slice(0, boundary).trim()
          buffer = buffer.slice(boundary + 2)

          if (record) {
            processSseRecord(record)
          }

          boundary = buffer.indexOf("\n\n")
        }

        if (done) break
      }

      // Process remaining
      const remaining = buffer.trim()
      if (remaining) processSseRecord(remaining)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      console.error("Extraction error:", err)
      setError(err instanceof Error ? err.message : "Unknown error")
      setStreamingStatus("error")
    } finally {
      setExtracting(false)
    }
  }

  function processSseRecord(raw: string) {
    const lines = raw.split(/\r?\n/)
    let eventType = "message"
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trim()
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim())
      }
    }

    const data = dataLines.join("\n")
    if (!data) return

    try {
      const parsed = JSON.parse(data)

      switch (eventType) {
        case "trace": {
          const trace = parsed.trace as TraceEvent | undefined
          if (trace) {
            setTraceEvents((prev) => [...prev, trace])
          }
          break
        }
        case "thinking": {
          const text = parsed.text as string | undefined
          if (text) setThinkingText(text)
          break
        }
        case "result": {
          const result = parsed.result as {
            rows?: TableRow[]
            documentType?: string
            confidence?: number
          } | undefined
          if (result) {
            if (result.rows && result.rows.length > 0) {
              setRows(result.rows)
            }
            if (result.documentType) setDocumentType(result.documentType)
            if (result.confidence !== undefined) setConfidence(result.confidence)
            setStreamingStatus("done")
          }
          break
        }
        case "error": {
          const msg = (parsed.detail as string) || (parsed.error as string) || "Unknown error"
          setError(msg)
          setStreamingStatus("error")
          break
        }
      }
    } catch {
      // Skip unparseable records
    }
  }

  const extractWithNote = useCallback(() => {
    if (previewFile) {
      resetState()
      extractFromFile(previewFile, note)
    }
  }, [previewFile, note])

  async function exportToXlsx(rowsToExport: TableRow[]) {
    try {
      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToExport, format: "xlsx" }),
      })
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `report-${Date.now()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-muted text-muted-foreground"
      case "running":
        return "bg-blue-500/10 text-blue-600"
      case "complete":
        return "bg-green-500/10 text-green-600"
      case "error":
        return "bg-red-500/10 text-red-600"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  return (
    <div className="flex h-full">
      {/* Main Workspace */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Report Agent</h1>
            {documentType && (
              <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {documentType}
              </span>
            )}
            {confidence !== null && (
              <span className="text-xs text-muted-foreground">
                Confidence: {(confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => rows.length > 0 && exportToXlsx(rows)}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Upload & AI Status */}
          <div className="w-1/2 border-r p-6 overflow-y-auto">
            {/* Upload Zone */}
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                "hover:border-primary/50 hover:bg-accent/50",
                previewUrl ? "border-solid" : ""
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.docx,.doc,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              {previewUrl ? (
                <div className="space-y-4">
                  {previewFile?.type.startsWith("image/") ? (
                    <img src={previewUrl} alt="Preview" className="mx-auto max-h-48 rounded-lg object-contain" />
                  ) : (
                    <div className="flex items-center justify-center h-32 bg-muted rounded-lg">
                      <FileSpreadsheet className="h-10 w-10 text-muted-foreground/50" />
                      <span className="ml-3 text-sm text-muted-foreground">
                        {previewFile?.name || "Document"}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      fileInputRef.current?.click()
                      URL.revokeObjectURL(previewUrl)
                      setPreviewUrl(null)
                      setPreviewFile(null)
                      setRows([])
                      resetState()
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Change file
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer space-y-3"
                >
                  <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Upload document</p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, PDF, DOCX, or TXT (max 10MB)
                  </p>
                </div>
              )}
            </div>

            {/* AI Status Panel */}
            {streamingStatus !== "idle" && (
              <div className="mt-4 space-y-3">
                {/* Status bar */}
                <div className="flex items-center gap-2">
                  {streamingStatus === "connecting" && (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Connecting to AI...</span>
                    </>
                  )}
                  {streamingStatus === "thinking" && (
                    <>
                      <Brain className="h-4 w-4 text-blue-500 animate-pulse" />
                      <span className="text-sm text-blue-600">
                        AI is analyzing the document...
                      </span>
                    </>
                  )}
                  {streamingStatus === "done" && (
                    <>
                      <BarChart3 className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">
                        Extraction complete — {rows.length} fields found
                      </span>
                    </>
                  )}
                  {streamingStatus === "error" && (
                    <span className="text-sm text-red-600">{error || "Extraction failed"}</span>
                  )}
                </div>

                {/* Thinking display */}
                {thinkingText && (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">{thinkingText}</p>
                  </div>
                )}

                {/* Trace events */}
                {traceEvents.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      AI Process
                    </p>
                    {traceEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
                      >
                        <span
                          className={cn(
                            "inline-block h-2 w-2 rounded-full",
                            evt.status === "running" && "bg-blue-500 animate-pulse",
                            evt.status === "complete" && "bg-green-500",
                            evt.status === "error" && "bg-red-500",
                            evt.status === "pending" && "bg-muted-foreground/30"
                          )}
                        />
                        <span className="font-medium">{evt.title}</span>
                        {evt.detail && (
                          <span className="text-muted-foreground">— {evt.detail}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Spinner during processing */}
                {streamingStatus === "thinking" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Processing...
                  </div>
                )}
              </div>
            )}

            {/* Extract with note button */}
            {(extracting || previewFile) && (
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium">Notes / Instructions</label>
                <textarea
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm resize-none"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add specific instructions for AI (e.g., 'Extract dates in dd/mm/yyyy format')..."
                  disabled={extracting}
                />
                <button
                  onClick={extractWithNote}
                  disabled={extracting || !previewFile}
                  className="mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  <Brain className="h-3.5 w-3.5" />
                  {extracting ? "Extracting..." : "Re-extract with Instructions"}
                </button>
              </div>
            )}
          </div>

          {/* Right: Table Editor */}
          <div className="w-1/2 p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">
                Extracted Data
                {rows.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({rows.length} rows)
                  </span>
                )}
              </h2>
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                <Plus className="h-3 w-3" />
                Add Row
              </button>
            </div>

            {rows.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed text-center">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Upload a document to extract data
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  AI will analyze images, PDFs, and documents
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-start gap-2 group">
                    <input
                      type="text"
                      value={row.field}
                      onChange={(e) => updateRow(i, { field: e.target.value })}
                      placeholder="Field"
                      className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm font-medium"
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => updateRow(i, { value: e.target.value })}
                      placeholder="Value"
                      className="flex-[2] rounded-md border bg-transparent px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => deleteRow(i)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
