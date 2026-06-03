"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Upload, FileText, Download, Plus, Trash2, Loader2, GitCompare, Brain, BarChart3, Search } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"

interface TenderField {
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

interface Template {
  id: string
  locale: string
  title: string
  scenario: string | null
  description?: string
  updatedAt?: string
}

export default function TenderPage() {
  const router = useRouter()
  const [tenders, setTenders] = useState<Array<{ id: string; name: string; fields: TenderField[]; type: string | null }>>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODELS.tender)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [thinkingText, setThinkingText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [streamingStatus, setStreamingStatus] = useState<"idle" | "connecting" | "thinking" | "done" | "error">("idle")
  const [confidence, setConfidence] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch templates on mount
  useEffect(() => {
    fetch("/api/tender/templates")
      .then((r) => r.json())
      .then((data) => {
        if (data.templates) setTemplates(data.templates)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function resetState() {
    abortRef.current?.abort()
    setAnalyzing(false)
    setStreamingStatus("idle")
    setTraceEvents([])
    setThinkingText("")
    setError(null)
    setConfidence(null)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    resetState()
    setAnalyzing(true)
    setStreamingStatus("connecting")
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Read file as text
      const reader = new FileReader()
      const fileText = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error("Failed to read file"))
        reader.readAsText(file)
      })

      setStreamingStatus("thinking")

      // Stream AI extraction
      const response = await fetch("/api/tender/agent?action=extract&stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText: fileText,
          fileName: file.name,
          templateId: selectedTemplate || undefined,
          model,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(errData.detail || errData.error || `Server error: ${response.status}`)
      }

      if (!response.body) {
        throw new Error("Response body is not available")
      }

      // Process SSE stream
      const bodyReader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let result: { fields?: TenderField[]; tenderTitle?: string; tenderType?: string; confidence?: number } | null = null

      while (true) {
        const { value, done } = await bodyReader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
        }

        let boundary = buffer.indexOf("\n\n")
        while (boundary >= 0) {
          const record = buffer.slice(0, boundary).trim()
          buffer = buffer.slice(boundary + 2)

          if (record) {
            const parsed = parseSseRecord(record)

            switch (parsed.event) {
              case "trace":
                if (parsed.data?.trace) {
                  setTraceEvents((prev) => [...prev, parsed.data!.trace as TraceEvent])
                }
                break
              case "thinking":
                if (parsed.data?.text) setThinkingText(parsed.data.text)
                break
              case "result":
                if (parsed.data?.result) {
                  result = parsed.data.result
                }
                break
              case "error":
                setError(parsed.data?.detail || parsed.data?.error || "Unknown error")
                setStreamingStatus("error")
                break
            }
          }

          boundary = buffer.indexOf("\n\n")
        }

        if (done) break
      }

      const remaining = buffer.trim()
      if (remaining) {
        const parsed = parseSseRecord(remaining)
        if (parsed.event === "result" && parsed.data?.result) {
          result = parsed.data.result
        }
      }

      if (result && result.fields && result.fields.length > 0) {
        const newTender = {
          id: `tender-${Date.now()}`,
          name: result.tenderTitle || file.name.replace(/\.(pdf|docx?|txt)$/i, ""),
          fields: result.fields,
          type: result.tenderType || null,
        }
        setTenders((prev) => [...prev, newTender])
        if (result.confidence !== undefined) setConfidence(result.confidence)
        setStreamingStatus("done")
      } else {
        setError("No fields were extracted from the document")
        setStreamingStatus("error")
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      console.error("Tender extraction error:", err)
      setError(err instanceof Error ? err.message : "Unknown error")
      setStreamingStatus("error")
    } finally {
      setAnalyzing(false)
    }
  }

  function parseSseRecord(raw: string): { event: string; data: Record<string, any> | null } {
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

    if (dataLines.length === 0) return { event: eventType, data: null }

    try {
      return { event: eventType, data: JSON.parse(dataLines.join("\n")) }
    } catch {
      return { event: eventType, data: null }
    }
  }

  function addField(tenderIndex: number) {
    setTenders(
      tenders.map((t, i) =>
        i === tenderIndex ? { ...t, fields: [...t.fields, { field: "", value: "" }] } : t
      )
    )
  }

  function updateField(tenderIndex: number, fieldIndex: number, update: Partial<TenderField>) {
    setTenders(
      tenders.map((t, i) =>
        i === tenderIndex
          ? { ...t, fields: t.fields.map((f, j) => (j === fieldIndex ? { ...f, ...update } : f)) }
          : t
      )
    )
  }

  function deleteField(tenderIndex: number, fieldIndex: number) {
    setTenders(
      tenders.map((t, i) =>
        i === tenderIndex ? { ...t, fields: t.fields.filter((_, j) => j !== fieldIndex) } : t
      )
    )
  }

  function removeTender(tenderIndex: number) {
    setTenders(tenders.filter((_, i) => i !== tenderIndex))
  }

  function navigateToCompare() {
    router.push("/tender/compare")
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending": return "bg-muted text-muted-foreground"
      case "running": return "bg-blue-500/10 text-blue-600"
      case "complete": return "bg-green-500/10 text-green-600"
      case "error": return "bg-red-500/10 text-red-600"
      default: return "bg-muted text-muted-foreground"
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Tender & Bidding Agent</h1>
            {confidence !== null && (
              <span className="text-xs text-muted-foreground">
                Confidence: {(confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector value={model} onChange={setModel} />
            {tenders.length >= 2 && (
              <button
                onClick={navigateToCompare}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                <GitCompare className="h-4 w-4" />
                Compare ({tenders.length})
              </button>
            )}
            <button
              disabled={tenders.length === 0}
              onClick={() => {
                // Export all tender data as XLSX
                const rows = tenders.flatMap((t) =>
                  t.fields.map((f) => ({ field: `${t.name} - ${f.field}`, value: f.value }))
                )
                fetch("/api/report/export", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rows, format: "xlsx" }),
                })
                  .then((r) => r.blob())
                  .then((blob) => {
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = `tender-comparison-${Date.now()}.xlsx`
                    a.click()
                    URL.revokeObjectURL(url)
                  })
                  .catch(console.error)
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export All
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Upload Panel */}
          <div className="w-80 border-r p-6 overflow-y-auto">
            {/* Upload Zone */}
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer",
                "hover:border-primary/50 hover:bg-accent/50"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Upload Tender Document</p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, DOCX, or TXT tender/bidding documents
              </p>
            </div>

            {/* AI Status */}
            {streamingStatus !== "idle" && (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  {streamingStatus === "connecting" && (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Connecting...</span>
                    </>
                  )}
                  {streamingStatus === "thinking" && (
                    <>
                      <Brain className="h-4 w-4 text-blue-500 animate-pulse" />
                      <span className="text-sm text-blue-600">AI is analyzing...</span>
                    </>
                  )}
                  {streamingStatus === "done" && (
                    <>
                      <BarChart3 className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Analysis complete</span>
                    </>
                  )}
                  {(streamingStatus === "error") && (
                    <span className="text-sm text-red-600">{error || "Analysis failed"}</span>
                  )}
                </div>

                {thinkingText && (
                  <div className="rounded-lg border bg-muted/30 p-2">
                    <p className="text-xs text-muted-foreground">{thinkingText}</p>
                  </div>
                )}

                {traceEvents.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      AI Process
                    </p>
                    {traceEvents.map((evt) => (
                      <div key={evt.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs">
                        <span className={cn("inline-block h-2 w-2 rounded-full",
                          evt.status === "running" && "bg-blue-500 animate-pulse",
                          evt.status === "complete" && "bg-green-500",
                          evt.status === "error" && "bg-red-500",
                          evt.status === "pending" && "bg-muted-foreground/30"
                        )} />
                        <span className="font-medium">{evt.title}</span>
                        {evt.detail && <span className="text-muted-foreground">— {evt.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Template Selector */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold flex items-center gap-2">
                <Search className="h-4 w-4" />
                Tender Type
              </h3>
              <select
                value={selectedTemplate || ""}
                onChange={(e) => setSelectedTemplate(e.target.value || null)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                <option value="">Auto-detect</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.scenario || "general"})
                  </option>
                ))}
                {templates.length === 0 && (
                  <>
                    <option value="it-tender">IT Services Tender</option>
                    <option value="construction">Construction Tender</option>
                    <option value="consulting">Consulting Services Tender</option>
                    <option value="procurement">Procurement Tender</option>
                  </>
                )}
              </select>
            </div>

            {/* Uploaded Tenders List */}
            {tenders.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold">
                  Analyzed Tenders ({tenders.length})
                </h3>
                <div className="space-y-1">
                  {tenders.map((t, i) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-accent/50 group"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{t.name}</span>
                      {t.type && (
                        <span className="text-xs text-muted-foreground capitalize">
                          {t.type.replace(/_/g, " ")}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeTender(i)
                        }}
                        className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Tender Details */}
          <div className="flex-1 p-6 overflow-y-auto">
            {tenders.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <FileText className="h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-semibold">Tender & Bidding Agent</h3>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Upload tender documents to analyze key information, compare multiple tenders side-by-side, and export comparison tables.
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  Upload a PDF, DOCX, or TXT file to get started
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {tenders.map((tender, ti) => (
                  <div key={tender.id}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h2 className="font-semibold">{tender.name}</h2>
                        {tender.type && (
                          <span className="text-xs text-muted-foreground capitalize">
                            {tender.type.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => addField(ti)}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        >
                          <Plus className="h-3 w-3" />
                          Add Field
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {tender.fields.map((field, fi) => (
                        <div key={fi} className="flex items-start gap-2 group">
                          <input
                            type="text"
                            value={field.field}
                            onChange={(e) => updateField(ti, fi, { field: e.target.value })}
                            placeholder="Field"
                            className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm font-medium"
                          />
                          <input
                            type="text"
                            value={field.value}
                            onChange={(e) => updateField(ti, fi, { value: e.target.value })}
                            placeholder="Value"
                            className="flex-[3] rounded-md border bg-transparent px-3 py-2 text-sm"
                          />
                          <button
                            onClick={() => deleteField(ti, fi)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {tender.fields.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No fields extracted — <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-primary hover:underline"
                        >
                          upload a new document
                        </button>
                      </p>
                    )}
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
