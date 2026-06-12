"use client"

import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react"
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
  Plus,
  Trash2,
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import {
  getInitialSelectedAttachmentIds,
  getSelectedAnalyzableAttachments,
  isAnalyzableEmailAttachment,
  parseAttachmentIdsFromSearchParams,
} from "@/features/cross-agent/email-attachments"
import {
  ReportUploadQueue,
  buildUploadFileId,
  type PendingUploadFile,
} from "@/features/report/components/report-upload-queue"
import type { ExtractionRow } from "@/features/report/components/report-extraction-table"
import type { PreviewDocument } from "@/features/report/components/pdf-highlight-viewer"
import { buildReportDraftNote } from "@/features/report/lib/report-draft-note"
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

interface TableRow extends ExtractionRow {}

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
  const attachmentIdsParam = searchParams.get("attachmentIds")
  const [emailSource, setEmailSource] = useState<EmailSource | null>(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(new Set())
  const [loadingEmailExtract, setLoadingEmailExtract] = useState(false)
  const [extractedRows, setExtractedRows] = useState<TableRow[]>([])
  const [kbHighlightPhrases, setKbHighlightPhrases] = useState<string[]>([])
  const [highlightEnabled, setHighlightEnabled] = useState(false)
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<{
    page?: number
    field: string
    value: string
  } | null>(null)
  const [selectedTableRowIndex, setSelectedTableRowIndex] = useState<number | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingUploadFile[]>([])
  const [selectedUploadFileIds, setSelectedUploadFileIds] = useState<Set<string>>(new Set())
  const [loadingBatchExtract, setLoadingBatchExtract] = useState(false)
  const [savingRows, setSavingRows] = useState(false)
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODELS.report)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [thinkingText, setThinkingText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [mockWarning, setMockWarning] = useState<string | null>(null)
  const [documentType, setDocumentType] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [streamingStatus, setStreamingStatus] = useState<
    "idle" | "connecting" | "thinking" | "highlighting" | "done" | "error"
  >("idle")
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null)
  const [editingField, setEditingField] = useState("")
  const [editingValue, setEditingValue] = useState("")
  const [refineInstruction, setRefineInstruction] = useState("")
  const [refining, setRefining] = useState(false)
  const [rowsManuallyEdited, setRowsManuallyEdited] = useState(false)
  const [refreshingSummary, setRefreshingSummary] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const extractMergeRef = useRef<{ appendRows: boolean; sourceLabel?: string }>({
    appendRows: false,
  })
  const rowsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const traceSeqRef = useRef(0)

  function buildSummaryDraftNote(summary: ReportSummary): string {
    return buildReportDraftNote(summary)
  }

  const persistSessionRows = useCallback(async (rows: TableRow[]) => {
    if (!activeSessionId) return
    setSavingRows(true)
    try {
      await fetch("/api/report/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeSessionId, rows }),
      })
      window.dispatchEvent(new Event("report:sessions-updated"))
    } catch (err) {
      console.error("Failed to save rows:", err)
    } finally {
      setSavingRows(false)
    }
  }, [activeSessionId])

  const persistSessionSummary = useCallback(async (summary: ReportSummary) => {
    if (!activeSessionId) return
    try {
      await fetch("/api/report/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeSessionId,
          summary,
          draftNote: buildSummaryDraftNote(summary),
        }),
      })
      window.dispatchEvent(new Event("report:sessions-updated"))
    } catch (err) {
      console.error("Failed to save summary:", err)
    }
  }, [activeSessionId])

  const ensureSessionId = useCallback(async (titleHint?: string): Promise<string | null> => {
    if (activeSessionId) return activeSessionId
    const id = `report-${Date.now()}`
    const title = titleHint || `Report ${new Date().toLocaleDateString()}`
    try {
      const res = await fetch("/api/report/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      })
      if (res.ok) {
        setActiveSessionId(id)
        window.dispatchEvent(new Event("report:sessions-updated"))
        return id
      }
    } catch (err) {
      console.error("Failed to create session:", err)
    }
    return null
  }, [activeSessionId])

  useEffect(() => {
    if (!activeSessionId || extractedRows.length === 0) return
    if (rowsSaveTimerRef.current) clearTimeout(rowsSaveTimerRef.current)
    rowsSaveTimerRef.current = setTimeout(() => {
      void persistSessionRows(extractedRows)
    }, 800)
    return () => {
      if (rowsSaveTimerRef.current) clearTimeout(rowsSaveTimerRef.current)
    }
  }, [extractedRows, activeSessionId, persistSessionRows])

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
        const preferredIds = parseAttachmentIdsFromSearchParams(attachmentIdsParam, attachmentIdParam)
        setSelectedAttachmentIds(
          getInitialSelectedAttachmentIds(attachments, preferredIds, { includeImages: true })
        )
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
  }, [fromEmailId, emailSubjectParam, attachmentIdParam, attachmentIdsParam])

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
    traceSeqRef.current = 0
    setThinkingText("")
    setError(null)
    setMockWarning(null)
    setDocumentType(null)
    setConfidence(null)
    setReportSummary(null)
    setExtractedRows([])
    setKbHighlightPhrases([])
    setFocusTarget(null)
    setSelectedTableRowIndex(null)
    setRowsManuallyEdited(false)
  }

  function resetState() {
    resetAnalysisState()
  }

  async function loadEmailAttachmentAndExtract(
    attachmentId: string,
    options?: { skipPreviewReset?: boolean }
  ) {
    if (!emailSource) return
    const att = emailSource.attachments.find((a) => a.id === attachmentId)
    if (!att) return

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

    if (!options?.skipPreviewReset) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(file))
      setPreviewFile(file)
    }

    extractMergeRef.current = {
      appendRows: Boolean(options?.skipPreviewReset),
      sourceLabel: att.fileName,
    }

    await extractFromFile(file, await ensureSessionId(att.fileName))
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
    const sessionId = await ensureSessionId(emailSource.subject)

    try {
      setStreamingStatus("thinking")

      const response = await fetch("/api/report/agent?action=extract&stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText: emailSource.body,
          fileName: `${emailSource.subject || "email"}.txt`,
          model,
          sessionId: sessionId || undefined,
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
    const selected = getSelectedAnalyzableAttachments(
      emailSource.attachments,
      selectedAttachmentIds,
      { includeImages: true }
    )

    if (selected.length > 0) {
      resetAnalysisState()
      setLoadingEmailExtract(true)
      setError(null)
    setMockWarning(null)
      try {
        for (let i = 0; i < selected.length; i++) {
          await loadEmailAttachmentAndExtract(selected[i].id, {
            skipPreviewReset: i > 0,
          })
        }
      } catch (err) {
        console.error("Email attachment extract error:", err)
        setError(err instanceof Error ? err.message : "Failed to analyze email attachment")
        setStreamingStatus("error")
      } finally {
        setLoadingEmailExtract(false)
        extractMergeRef.current = { appendRows: false }
      }
      return
    }

    if (emailSource.body.trim()) {
      resetState()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPreviewFile(null)
      extractMergeRef.current = { appendRows: false }
      await extractFromEmailText()
    } else {
      setError("Select at least one attachment to analyze")
      setStreamingStatus("error")
    }
  }

  const selectedAnalyzableAttachments = emailSource
    ? getSelectedAnalyzableAttachments(emailSource.attachments, selectedAttachmentIds, {
        includeImages: true,
      })
    : []

  const emailAnalyzableAttachments = emailSource
    ? emailSource.attachments.filter((att) =>
        isAnalyzableEmailAttachment(att, { includeImages: true })
      )
    : []

  const canAnalyzeEmail = Boolean(
    emailSource &&
      (selectedAnalyzableAttachments.length > 0 || emailSource.body.trim().length > 0)
  )

  function toggleAttachmentSelection(attachmentId: string) {
    setSelectedAttachmentIds((prev) => {
      const next = new Set(prev)
      if (next.has(attachmentId)) next.delete(attachmentId)
      else next.add(attachmentId)
      return next
    })
  }

  function selectAllAnalyzableAttachments() {
    if (!emailSource) return
    setSelectedAttachmentIds(new Set(emailAnalyzableAttachments.map((att) => att.id)))
  }

  function clearAttachmentSelection() {
    setSelectedAttachmentIds(new Set())
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const nextEntries = files.map((file) => ({
      id: buildUploadFileId(file),
      file,
    }))

    resetAnalysisState()

    setPendingFiles((prev) => {
      const existingIds = new Set(prev.map((p) => p.id))
      const merged = [...prev]
      for (const entry of nextEntries) {
        if (!existingIds.has(entry.id)) merged.push(entry)
      }
      return merged
    })
    setSelectedUploadFileIds((prev) => {
      const next = new Set(prev)
      for (const entry of nextEntries) next.add(entry.id)
      return next
    })

    const firstFile = nextEntries[0].file
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(firstFile))
    setPreviewFile(firstFile)

    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function clearUploadedFiles() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewFile(null)
    setPendingFiles([])
    setSelectedUploadFileIds(new Set())
    resetAnalysisState()
  }

  async function handleAnalyzeFile() {
    if (!previewFile) return
    resetAnalysisState()
    const sessionId = await ensureSessionId(previewFile.name)
    await extractFromFile(previewFile, sessionId)
  }

  function handleHighlightEnabledChange(enabled: boolean) {
    setHighlightEnabled(enabled)
  }

  function toggleUploadFileSelection(fileId: string) {
    setSelectedUploadFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  function selectAllUploadFiles() {
    setSelectedUploadFileIds(new Set(pendingFiles.map((f) => f.id)))
  }

  function clearUploadFileSelection() {
    setSelectedUploadFileIds(new Set())
  }

  function removeUploadFile(fileId: string) {
    setPendingFiles((prev) => prev.filter((f) => f.id !== fileId))
    setSelectedUploadFileIds((prev) => {
      const next = new Set(prev)
      next.delete(fileId)
      return next
    })
  }

  function removeSelectedUploadFiles() {
    setPendingFiles((prev) => prev.filter((f) => !selectedUploadFileIds.has(f.id)))
    setSelectedUploadFileIds(new Set())
  }

  async function handleBatchAnalyzeSelected() {
    const selected = pendingFiles.filter((f) => selectedUploadFileIds.has(f.id))
    if (selected.length === 0) return

    resetAnalysisState()
    setLoadingBatchExtract(true)
    setError(null)
    setMockWarning(null)

    try {
      const sessionId = await ensureSessionId(
        selected.length === 1 ? selected[0].file.name : `Batch (${selected.length} files)`
      )

      for (let i = 0; i < selected.length; i++) {
        const entry = selected[i]
        if (i === 0) {
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          setPreviewUrl(URL.createObjectURL(entry.file))
          setPreviewFile(entry.file)
        }
        extractMergeRef.current = {
          appendRows: i > 0,
          sourceLabel: entry.file.name,
        }
        await extractFromFile(entry.file, sessionId)
      }
    } catch (err) {
      console.error("Batch extract error:", err)
      setError(err instanceof Error ? err.message : "Batch analysis failed")
      setStreamingStatus("error")
    } finally {
      setLoadingBatchExtract(false)
      extractMergeRef.current = { appendRows: false }
    }
  }

  const handleTableRowClick = useCallback((index: number, row: TableRow) => {
    setSelectedTableRowIndex(index)
    setHighlightEnabled(true)
    setFocusTarget({
      page: row.page,
      field: row.field,
      value: row.value,
    })
  }, [])

  const pdfPreviewDocuments = useMemo((): PreviewDocument[] => {
    return pendingFiles
      .filter((p) => p.file.type === "application/pdf")
      .map((p) => ({
        id: p.id,
        name: p.file.name,
        url: URL.createObjectURL(p.file),
      }))
  }, [pendingFiles])

  useEffect(() => {
    return () => {
      pdfPreviewDocuments.forEach((d) => URL.revokeObjectURL(d.url))
    }
  }, [pdfPreviewDocuments])

  useEffect(() => {
    if (pdfPreviewDocuments.length === 0) {
      setActivePreviewId(null)
      return
    }
    if (!activePreviewId || !pdfPreviewDocuments.some((d) => d.id === activePreviewId)) {
      setActivePreviewId(pdfPreviewDocuments[0].id)
    }
  }, [pdfPreviewDocuments, activePreviewId])

  const activePdfDoc =
    pdfPreviewDocuments.find((d) => d.id === activePreviewId) ?? pdfPreviewDocuments[0]

  const viewerFileUrl =
    activePdfDoc?.url ??
    (previewFile?.type === "application/pdf" ? previewUrl : null)

  const viewerFileName = activePdfDoc?.name ?? previewFile?.name ?? ""

  async function extractFromFile(file: File, sessionId?: string | null) {
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
            model,
            sessionId: sessionId || undefined,
          }),
          signal: controller.signal,
        })
      } else {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("model", model)
        if (sessionId) formData.append("sessionId", sessionId)

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
            const label = extractMergeRef.current.sourceLabel || previewFile?.name || "doc"
            const seq = traceSeqRef.current++
            setTraceEvents((prev) => [
              ...prev,
              { ...trace, id: `${trace.id}-${label}-${seq}` },
            ])
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
            sessionId?: string
            rows?: TableRow[]
            documentType?: string
            confidence?: number
            model?: string
          } | undefined
          if (result) {
            if (result.model === "mock-template") {
              setMockWarning(
                "未連接大模型，目前為演示資料。請確認 combine-ai-platform/.env 中的 DASHSCOPE_API_KEY 並重啟 dev server。"
              )
            } else {
              setMockWarning(null)
            }
            if (result.sessionId) setSessionId(result.sessionId)
            const sourceLabel = extractMergeRef.current.sourceLabel
            if (result.rows && result.rows.length > 0) {
              const rows = sourceLabel
                ? result.rows.map((row) => ({
                    ...row,
                    field: `${sourceLabel} · ${row.field}`,
                  }))
                : result.rows
              setExtractedRows((prev) =>
                extractMergeRef.current.appendRows ? [...prev, ...rows] : rows
              )
              if (!extractMergeRef.current.appendRows) {
                setRowsManuallyEdited(false)
              }
            }
            if (result.documentType) setDocumentType(result.documentType)
            if (result.confidence !== undefined) setConfidence(result.confidence)
            setStreamingStatus("highlighting")
            if (!extractMergeRef.current.appendRows) {
              setHighlightEnabled(true)
            }
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
            setRowsManuallyEdited(false)
            setStreamingStatus("done")
            void persistSessionSummary(summary)
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
    setRowsManuallyEdited(true)
  }

  function cancelEditRow() {
    setEditingRowIndex(null)
    setEditingField("")
    setEditingValue("")
  }

  function deleteRow(index: number) {
    setExtractedRows((prev) => prev.filter((_, i) => i !== index))
    if (editingRowIndex === index) cancelEditRow()
    setRowsManuallyEdited(true)
  }

  function addRow() {
    setExtractedRows((prev) => [...prev, { field: "New Field", value: "" }])
    setRowsManuallyEdited(true)
    // Start editing the new row immediately
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
    setRowsManuallyEdited(true)
  }

  async function refreshSummaryFromRows(rows: TableRow[]) {
    if (rows.length === 0) return
    setRefreshingSummary(true)
    try {
      const res = await fetch("/api/report/agent?action=summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          fileName: previewFile?.name || emailSource?.subject,
          documentType: documentType || undefined,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || "Summary refresh failed")
      }
      const summary = (await res.json()) as ReportSummary
      setReportSummary(summary)
      await persistSessionSummary(summary)
      setRowsManuallyEdited(false)
    } catch (err) {
      console.error("Refresh summary error:", err)
      setError(err instanceof Error ? err.message : "Failed to refresh summary")
    } finally {
      setRefreshingSummary(false)
    }
  }

  async function handleRefine() {
    if (!refineInstruction.trim() || extractedRows.length === 0) return
    setRefining(true)
    try {
      const res = await fetch("/api/report/agent?action=refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        setRowsManuallyEdited(false)
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
          fileName: previewFile?.name || emailSource?.subject,
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

  const isPdfPreview = Boolean(viewerFileUrl)

  const isAnalyzing = extracting || loadingBatchExtract || loadingEmailExtract

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
            {sessionId && (
              <Link
                href={`/report/${sessionId}`}
                className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-200"
              >
                <BookOpen className="h-3 w-3" />
                Session saved — view
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector value={model} onChange={setModel} />
            {rowsManuallyEdited && (
              <span className="text-[10px] text-amber-600" title="Row data changed — refresh summary to update narrative text">
                Rows edited
              </span>
            )}
            <button
              onClick={exportWord}
              disabled={!reportSummary}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Word (.docx)
            </button>
            <button
              onClick={exportExcel}
              disabled={extractedRows.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel (.xlsx)
            </button>
          </div>
        </header>

        {mockWarning && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            {mockWarning}
          </div>
        )}

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
                        : selectedAnalyzableAttachments.length > 1
                          ? `Analyze ${selectedAnalyzableAttachments.length} Documents`
                          : "Analyze Email"}
                    </button>
                    {emailSource.attachments.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Attachments — select one or more
                          </p>
                          {emailAnalyzableAttachments.length > 0 && (
                            <div className="flex items-center gap-2 text-[10px]">
                              <button
                                type="button"
                                onClick={selectAllAnalyzableAttachments}
                                className="text-primary hover:underline"
                              >
                                All
                              </button>
                              <button
                                type="button"
                                onClick={clearAttachmentSelection}
                                className="text-muted-foreground hover:underline"
                              >
                                Clear
                              </button>
                            </div>
                          )}
                        </div>
                        {emailSource.attachments.map((att) => {
                          const analyzable = isAnalyzableEmailAttachment(att, { includeImages: true })
                          const selected = selectedAttachmentIds.has(att.id)
                          return (
                          <div
                            key={att.id}
                            className={cn(
                              "flex items-start gap-2 rounded-md border p-2",
                              analyzable && "hover:bg-accent/50",
                              selected && "border-primary bg-primary/5"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!analyzable}
                              onChange={() => {
                                if (analyzable) toggleAttachmentSelection(att.id)
                              }}
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary disabled:opacity-40"
                              aria-label={`Select ${att.fileName}`}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">{att.fileName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {Math.max(1, Math.round(att.sizeBytes / 1024))} KB
                                {!analyzable && " — not analyzable"}
                              </p>
                            </div>
                            <a
                              href={`/api/email/attachments?action=download&id=${encodeURIComponent(att.id)}`}
                              className="shrink-0 text-[10px] text-primary hover:underline"
                            >
                              Download
                            </a>
                          </div>
                          )
                        })}
                        {selectedAnalyzableAttachments.length > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            {selectedAnalyzableAttachments.length} selected for analysis
                          </p>
                        )}
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

            {!fromEmailId && (
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                "hover:border-primary/50 hover:bg-accent/50",
                previewUrl ? "border-solid" : ""
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.docx,.doc,.txt"
                multiple
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
                  <ReportUploadQueue
                    pendingFiles={pendingFiles}
                    selectedFileIds={selectedUploadFileIds}
                    extracting={isAnalyzing}
                    onToggleFile={toggleUploadFileSelection}
                    onSelectAll={selectAllUploadFiles}
                    onClearSelection={clearUploadFileSelection}
                    onRemoveSelected={removeSelectedUploadFiles}
                    onRemoveFile={removeUploadFile}
                    onAnalyzeSelected={handleBatchAnalyzeSelected}
                    onAnalyzeSingle={handleAnalyzeFile}
                    className="mt-0 text-left"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm text-primary hover:underline"
                  >
                    Add more files
                  </button>
                  <button
                    type="button"
                    onClick={clearUploadedFiles}
                    className="block w-full text-sm text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer space-y-3"
                >
                  <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Upload document(s)</p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, PDF, DOCX, or TXT — pick one or more to analyze
                  </p>
                </div>
              )}
            </div>
            )}

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

            {/* ── Extracted Data Table ── */}
            {extractedRows.length > 0 && (
              <div className="mt-6">
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
                              : "hover:bg-muted/30",
                            isPdfPreview && editingRowIndex !== i && "cursor-pointer",
                            isPdfPreview &&
                              selectedTableRowIndex === i &&
                              editingRowIndex !== i &&
                              "bg-primary/5 ring-1 ring-inset ring-primary/30"
                          )}
                          onClick={() => {
                            if (isPdfPreview && editingRowIndex !== i) {
                              handleTableRowClick(i, row)
                            }
                          }}
                          title={isPdfPreview ? "Click to highlight in PDF" : undefined}
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
                                className="px-2 py-1.5 text-xs font-medium"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEditRow(i)
                                }}
                                title="Click to edit"
                              >
                                {row.field}
                              </td>
                              <td
                                className="px-2 py-1.5 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEditRow(i)
                                }}
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
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      startEditRow(i)
                                    }}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    title="Edit"
                                  >
                                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      moveRow(i, i - 1)
                                    }}
                                    disabled={i === 0}
                                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-20"
                                    title="Move up"
                                  >
                                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      deleteRow(i)
                                    }}
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

            {/* Report Summary — lives in the left panel */}
            <div className="mt-6">
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
                    onClick={() => refreshSummaryFromRows(extractedRows)}
                    disabled={refreshingSummary || extractedRows.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {refreshingSummary ? (
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
                </div>
              )}
            </div>

          </div>

          {/* Right: PDF Preview — always full height */}
          <div className="flex w-1/2 flex-col overflow-hidden">
            {isPdfPreview && viewerFileUrl ? (
              <PdfHighlightViewer
                fileUrl={viewerFileUrl}
                fileName={viewerFileName}
                documents={pdfPreviewDocuments}
                activeDocumentId={activePreviewId ?? undefined}
                onDocumentChange={setActivePreviewId}
                highlights={[]}
                highlightEnabled={highlightEnabled}
                onHighlightEnabledChange={handleHighlightEnabledChange}
                focusTarget={focusTarget}
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
                    AI key highlights (yellow) appear after analysis; click a row for blue focus.
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
