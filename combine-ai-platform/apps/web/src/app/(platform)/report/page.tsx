"use client"

import { useState, useRef, useEffect, Suspense } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Upload,
  Download,
  Loader2,
  Brain,
  BarChart3,
  Mail,
  ArrowLeft,
  Paperclip,
  FileText,
  BookOpen,
  Sparkles,
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

interface TraceEvent {
  id: string
  at: string
  stage: string
  status: "pending" | "running" | "complete" | "error"
  title: string
  detail?: string
}

interface EmailAttachment {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

interface EmailSource {
  id: string
  subject: string
  senderName: string
  senderEmail: string
  body: string
  attachments: EmailAttachment[]
}

function getPrimaryDocumentAttachment(
  attachments: EmailAttachment[],
  preferredId?: string | null
): EmailAttachment | null {
  if (preferredId) {
    const found = attachments.find((a) => a.id === preferredId)
    if (found) return found
  }
  return (
    attachments.find(
      (att) =>
        att.mimeType === "application/pdf" ||
        att.fileName.toLowerCase().endsWith(".pdf") ||
        att.fileName.toLowerCase().endsWith(".docx") ||
        att.fileName.toLowerCase().endsWith(".doc") ||
        att.fileName.toLowerCase().endsWith(".txt")
    ) || null
  )
}

function isAnalyzableAttachment(att: EmailAttachment): boolean {
  const name = att.fileName.toLowerCase()
  return (
    att.mimeType === "application/pdf" ||
    att.mimeType.startsWith("image/") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".doc") ||
    name.endsWith(".txt")
  )
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
      <ReportPageContent />
    </Suspense>
  )
}

function ReportPageContent() {
  const searchParams = useSearchParams()
  const fromEmailId = searchParams.get("fromEmail")
  const emailSubjectParam = searchParams.get("emailSubject")
  const attachmentIdParam = searchParams.get("attachmentId")
  const [emailSource, setEmailSource] = useState<EmailSource | null>(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const [loadingEmailExtract, setLoadingEmailExtract] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [extractedRows, setExtractedRows] = useState<TableRow[]>([])
  const [kbHighlightPhrases, setKbHighlightPhrases] = useState<string[]>([])
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODELS.report)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [thinkingText, setThinkingText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [streamingStatus, setStreamingStatus] = useState<
    "idle" | "connecting" | "thinking" | "highlighting" | "done" | "error"
  >("idle")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!fromEmailId) {
      setEmailSource(null)
      return
    }

    setLoadingEmail(true)
    fetch(`/api/email/mailbox?conversationId=${encodeURIComponent(fromEmailId)}`)
      .then((r) => r.json())
      .then((data) => {
        const conv = data.conversation
        if (!conv) return
        const messages = conv.messages as Array<{ body?: string; bodyText?: string }> | undefined
        const emailBody = (messages || [])
          .map((m) => m.bodyText || m.body || "")
          .filter(Boolean)
          .join("\n\n")
        const attachments = conv.attachments || []
        const primary = getPrimaryDocumentAttachment(attachments, attachmentIdParam)
        setSelectedAttachmentId(primary?.id ?? null)
        setEmailSource({
          id: conv.id,
          subject: emailSubjectParam || conv.subject,
          senderName: conv.senderName,
          senderEmail: conv.senderEmail,
          body: emailBody,
          attachments,
        })
      })
      .catch(console.error)
      .finally(() => setLoadingEmail(false))
  }, [fromEmailId, emailSubjectParam])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function resetAnalysisState() {
    abortRef.current?.abort()
    setExtracting(false)
    setStreamingStatus("idle")
    setTraceEvents([])
    setThinkingText("")
    setError(null)
    setDocumentType(null)
    setConfidence(null)
    setReportSummary(null)
    setExtractedRows([])
    setKbHighlightPhrases([])
  }

  function resetState() {
    resetAnalysisState()
  }

  async function loadEmailAttachmentAndExtract(attachmentId: string) {
    if (!emailSource) return
    const att = emailSource.attachments.find((a) => a.id === attachmentId)
    if (!att) return

    setLoadingEmailExtract(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/email/attachments?action=download&id=${encodeURIComponent(attachmentId)}`
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || "Failed to download attachment")
      }
      const blob = await res.blob()
      const mimeType = att.mimeType || blob.type || "application/octet-stream"
      const file = new File([blob], att.fileName, { type: mimeType })

      resetState()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setPreviewFile(file)
      setSelectedAttachmentId(attachmentId)

      await extractFromFile(file, note)
    } catch (err) {
      console.error("Email attachment extract error:", err)
      setError(err instanceof Error ? err.message : "Failed to analyze email attachment")
      setStreamingStatus("error")
    } finally {
      setLoadingEmailExtract(false)
    }
  }

  async function consumeExtractStream(response: Response) {
    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: string; detail?: string }
      throw new Error(errData.detail || errData.error || `Server error: ${response.status}`)
    }

    if (!response.body) {
      throw new Error("Response body is not available for streaming")
    }

    const bodyReader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

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
          processSseRecord(record)
        }

        boundary = buffer.indexOf("\n\n")
      }

      if (done) break
    }

    const remaining = buffer.trim()
    if (remaining) processSseRecord(remaining)
  }

  async function extractFromEmailText() {
    if (!emailSource?.body.trim()) return

    setExtracting(true)
    setStreamingStatus("connecting")

    const controller = new AbortController()
    abortRef.current = controller

    try {
      setStreamingStatus("thinking")

      const response = await fetch("/api/report/agent?action=extract&stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText: emailSource.body,
          fileName: `${emailSource.subject || "email"}.txt`,
          instructions: note || undefined,
          model,
        }),
        signal: controller.signal,
      })

      await consumeExtractStream(response)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      console.error("Email text extraction error:", err)
      setError(err instanceof Error ? err.message : "Unknown error")
      setStreamingStatus("error")
    } finally {
      setExtracting(false)
    }
  }

  async function handleAnalyzeEmail() {
    if (!emailSource) return
    const att = getPrimaryDocumentAttachment(
      emailSource.attachments,
      selectedAttachmentId || attachmentIdParam
    )
    if (att) {
      await loadEmailAttachmentAndExtract(att.id)
    } else if (emailSource.body.trim()) {
      resetState()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPreviewFile(null)
      await extractFromEmailText()
    } else {
      setError("Email has no content to analyze")
      setStreamingStatus("error")
    }
  }

  const emailAnalyzableAttachment = emailSource
    ? getPrimaryDocumentAttachment(
        emailSource.attachments,
        selectedAttachmentId || attachmentIdParam
      )
    : null

  const canAnalyzeEmail = Boolean(
    emailSource &&
      (emailAnalyzableAttachment || emailSource.body.trim().length > 0)
  )

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    resetAnalysisState()
    if (previewUrl) URL.revokeObjectURL(previewUrl)

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setPreviewFile(file)
  }

  async function handleAnalyzeFile() {
    if (!previewFile) return
    resetAnalysisState()
    await extractFromFile(previewFile, note)
  }

  async function extractFromFile(file: File, instructions: string) {
    setExtracting(true)
    setStreamingStatus("connecting")

    const controller = new AbortController()
    abortRef.current = controller

    try {
      setStreamingStatus("thinking")

      let response: Response

      if (file.type.startsWith("image/")) {
        const fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error("Failed to read file"))
          reader.readAsDataURL(file)
        })

        response = await fetch("/api/report/agent?action=extract&stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileBase64: fileData,
            fileName: file.name,
            instructions: instructions || undefined,
            model,
          }),
          signal: controller.signal,
        })
      } else {
        const formData = new FormData()
        formData.append("file", file)
        if (instructions) formData.append("instructions", instructions)
        formData.append("model", model)

        response = await fetch("/api/report/agent?action=extract&stream=1", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        })
      }

      await consumeExtractStream(response)
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
              setExtractedRows(result.rows)
            }
            if (result.documentType) setDocumentType(result.documentType)
            if (result.confidence !== undefined) setConfidence(result.confidence)
            setStreamingStatus("highlighting")
          }
          break
        }
        case "kbHighlights": {
          const payload = parsed as { phrases?: string[] }
          if (Array.isArray(payload.phrases)) {
            setKbHighlightPhrases(payload.phrases)
          }
          break
        }
        case "summary": {
          const summary = parsed.summary as ReportSummary | undefined
          if (summary) {
            setReportSummary(summary)
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

  async function generateFullReport() {
    if (!reportSummary && extractedRows.length === 0) return
    setGeneratingReport(true)
    try {
      const res = await fetch("/api/report/agent?action=generateReport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: extractedRows.length > 0 ? extractedRows : undefined,
          reportSummary: reportSummary || undefined,
          fileName: previewFile?.name || emailSource?.subject,
          documentType: documentType || undefined,
          emailContext: emailSource
            ? {
                subject: emailSource.subject,
                sender: `${emailSource.senderName} <${emailSource.senderEmail}>`,
                body: emailSource.body,
              }
            : undefined,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || "Generate report failed")
      }
      const data = (await res.json()) as { markdown: string; fileName: string }
      const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = data.fileName || `report-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Generate report error:", err)
      setError(err instanceof Error ? err.message : "Failed to generate report")
    } finally {
      setGeneratingReport(false)
    }
  }

  async function exportSummary() {
    if (!reportSummary) return
    try {
      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "md",
          summary: reportSummary.summary,
          keyPoints: reportSummary.keyPoints,
          kbReferences: reportSummary.kbReferences,
          fileName: previewFile?.name,
        }),
      })
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `report-summary-${Date.now()}.md`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
    }
  }

  const isPdfPreview =
    previewUrl && previewFile && previewFile.type === "application/pdf"

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Report Agent</h1>
            {emailSource && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                From Email Agent
              </span>
            )}
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
            <ModelSelector value={model} onChange={setModel} />
            <button
              onClick={exportSummary}
              disabled={!reportSummary}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Summary
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Upload, Email, AI Status, Notes */}
          <div className="w-1/2 overflow-y-auto border-r p-6">
            {fromEmailId && (
              <div className="mb-4 rounded-lg border bg-accent/30 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    From Email Agent
                  </span>
                </div>
                {loadingEmail ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading email...
                  </div>
                ) : emailSource ? (
                  <>
                    <p className="line-clamp-2 text-sm font-medium">{emailSource.subject}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {emailSource.senderName} &lt;{emailSource.senderEmail}&gt;
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Email forwarded — use the button below to analyze email content.
                    </p>
                    <button
                      onClick={handleAnalyzeEmail}
                      disabled={
                        !canAnalyzeEmail ||
                        extracting ||
                        loadingEmailExtract
                      }
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {loadingEmailExtract || extracting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      {loadingEmailExtract || extracting
                        ? "Analyzing..."
                        : "Analyze Email"}
                    </button>
                    {emailSource.attachments.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Attachments — click to select for analysis
                        </p>
                        {emailSource.attachments.map((att) => (
                          <div
                            key={att.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (isAnalyzableAttachment(att)) setSelectedAttachmentId(att.id)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && isAnalyzableAttachment(att)) {
                                setSelectedAttachmentId(att.id)
                              }
                            }}
                            className={cn(
                              "flex items-start gap-2 rounded-md border p-2",
                              isAnalyzableAttachment(att) && "cursor-pointer hover:bg-accent/50",
                              (selectedAttachmentId || attachmentIdParam) === att.id &&
                                "border-primary bg-primary/5"
                            )}
                          >
                            <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">{att.fileName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {Math.max(1, Math.round(att.sizeBytes / 1024))} KB
                                {!isAnalyzableAttachment(att) && " — not analyzable"}
                              </p>
                            </div>
                            <a
                              href={`/api/email/attachments?action=download&id=${encodeURIComponent(att.id)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 text-[10px] text-primary hover:underline"
                            >
                              Download
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Email not found or unavailable.</p>
                )}
                <Link
                  href="/email"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to Email
                </Link>
              </div>
            )}

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
                  ) : previewFile?.type === "application/pdf" ? (
                    <div className="flex h-32 flex-col items-center justify-center rounded-lg bg-muted">
                      <FileText className="h-10 w-10 text-muted-foreground/50" />
                      <span className="mt-2 text-sm text-muted-foreground">
                        {previewFile.name}
                      </span>
                      <span className="mt-1 text-xs text-muted-foreground/70">
                        PDF preview shown on the right
                      </span>
                    </div>
                  ) : (
                    <div className="flex h-32 items-center justify-center rounded-lg bg-muted">
                      <FileText className="h-10 w-10 text-muted-foreground/50" />
                      <span className="ml-3 text-sm text-muted-foreground">
                        {previewFile?.name || "Document"}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={handleAnalyzeFile}
                      disabled={extracting || loadingEmailExtract}
                      className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {extracting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {extracting ? "Analyzing..." : "Analyze File"}
                    </button>
                    <button
                      onClick={() => {
                        fileInputRef.current?.click()
                        URL.revokeObjectURL(previewUrl)
                        setPreviewUrl(null)
                        setPreviewFile(null)
                        resetAnalysisState()
                      }}
                      className="text-sm text-primary hover:underline"
                    >
                      Change file
                    </button>
                  </div>
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

            {streamingStatus !== "idle" && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  {streamingStatus === "connecting" && (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Connecting to AI...</span>
                    </>
                  )}
                  {streamingStatus === "thinking" && (
                    <>
                      <Brain className="h-4 w-4 animate-pulse text-blue-500" />
                      <span className="text-sm text-blue-600">
                        AI is analyzing the document...
                      </span>
                    </>
                  )}
                  {streamingStatus === "highlighting" && (
                    <>
                      <BarChart3 className="h-4 w-4 text-amber-500" />
                      <span className="text-sm text-amber-700">
                        Extraction complete — matching KB lines on PDF.
                        Generating summary…
                      </span>
                    </>
                  )}
                  {streamingStatus === "done" && (
                    <>
                      <BarChart3 className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">
                        Summary complete
                        {reportSummary && reportSummary.keyPoints.length > 0
                          ? ` — ${reportSummary.keyPoints.length} key points`
                          : ""}
                      </span>
                    </>
                  )}
                  {streamingStatus === "error" && (
                    <span className="text-sm text-red-600">{error || "Processing failed"}</span>
                  )}
                </div>

                {thinkingText && (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">{thinkingText}</p>
                  </div>
                )}

                {traceEvents.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                            evt.status === "running" && "animate-pulse bg-blue-500",
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

                {(streamingStatus === "thinking" || streamingStatus === "highlighting") && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {streamingStatus === "highlighting" ? "Generating summary..." : "Processing..."}
                  </div>
                )}
              </div>
            )}

            {((fromEmailId && emailSource) || previewFile) && (
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium">Notes / Instructions</label>
                <textarea
                  className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add specific instructions for AI (e.g., focus on compliance items)..."
                  disabled={extracting || loadingEmailExtract}
                />
              </div>
            )}

            {/* Report Summary — lives in the left panel */}
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Report Summary</h2>
                {reportSummary && reportSummary.searchType !== "none" && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                    KB {reportSummary.searchType === "semantic" ? "語意搜尋" : "關鍵字搜尋"}
                  </span>
                )}
              </div>

              {!reportSummary &&
              streamingStatus !== "thinking" &&
              streamingStatus !== "connecting" &&
              streamingStatus !== "highlighting" ? (
                <div className="flex h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed text-center">
                  <BookOpen className="h-7 w-7 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {emailSource
                      ? "Click Analyze Email to generate summary"
                      : "Analyze a file to generate AI summary"}
                  </p>
                </div>
              ) : !reportSummary ? (
                <div className="flex h-32 flex-col items-center justify-center rounded-lg border bg-muted/20 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
                  <p className="mt-2 text-xs text-muted-foreground">Generating summary...</p>
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

                  <button
                    onClick={generateFullReport}
                    disabled={generatingReport}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {generatingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {generatingReport ? "Generating Report..." : "Generate Report"}
                  </button>
                  <p className="text-center text-[10px] text-muted-foreground">
                    Download a full structured report with knowledge base references
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right: PDF Preview — always full height */}
          <div className="flex w-1/2 flex-col overflow-hidden">
            {isPdfPreview ? (
              <PdfHighlightViewer
                fileUrl={previewUrl}
                fileName={previewFile.name}
                kbPhrases={kbHighlightPhrases}
                className="h-full"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 bg-muted/20 text-center">
                <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-10">
                  <FileText className="mx-auto h-14 w-14 text-muted-foreground/30" />
                  <p className="mt-4 text-sm font-medium text-muted-foreground">PDF Preview</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Upload a PDF on the left to preview it here.
                    <br />
                    AI-highlighted key phrases will appear after analysis.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
