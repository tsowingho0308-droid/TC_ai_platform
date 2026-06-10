"use client"

import { useState, useRef, useEffect, useMemo, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Upload, FileText, Download, Plus, Trash2, Loader2,
  GitCompare, Brain, BarChart3, Search, Check, X, ArrowLeft,
  Mail, Paperclip, Sparkles,
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

// ── Types ──────────────────────────────────────────────────────

interface TenderField { field: string; value: string }

interface TenderItem {
  id: string
  name: string
  fields: TenderField[]
  type: string | null
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

interface ComparisonField {
  field: string
  values: Array<{ tenderId: string; tenderTitle: string; value: string }>
  match: boolean
  isKey: boolean
}

interface ComparisonResult {
  comparisonFields: ComparisonField[]
  tenders: Array<{ id: string; title: string }>
}

interface AiCompareResult {
  keyDifferences?: string[]
  risksA?: string[]
  risksB?: string[]
  recommendation?: { preferred?: string; reason?: string } | null
}

interface ExtractionResult {
  fields?: TenderField[]
  tenderTitle?: string
  tenderType?: string
  confidence?: number
}

// ── Helpers ────────────────────────────────────────────────────

const FIELD_CANONICAL_ALIASES: Record<string, string[]> = {
  submission_deadline: ["submission deadline", "closing date", "bid deadline", "截標", "截止遞交", "截标"],
  clarification_deadline: ["clarification deadline", "query deadline", "澄清截止"],
  tender_value: ["tender value", "estimated budget", "budget", "contract value", "預算", "金額", "標書價值"],
  payment_terms: ["payment terms", "payment schedule", "付款條款", "付款"],
  evaluation_criteria: ["evaluation criteria", "assessment criteria", "評審", "評分", "scoring"],
  bid_bond: ["bid bond", "tender bond", "投標保證金", "保證金"],
  contract_duration: ["contract duration", "contract period", "合約期限", "合約期"],
  contact_person: ["contact person", "contact name", "聯絡人", "聯系人"],
  tender_reference: ["tender reference", "reference number", "tender no", "標書編號", "招标编号"],
  issuing_organization: ["issuing organization", "issuing department", "發標機構", "招标机构"],
}

const KEY_FIELD_PATTERNS = [
  /deadline|submission|截標|截止|closing/i,
  /budget|value|amount|預算|金額|tender value/i,
  /payment|付款/i,
  /evaluation|criteria|weight|評審|評分|scoring/i,
  /bond|保證|guarantee/i,
  /validity|有效期/i,
  /duration|period|合約|期限|contract/i,
  /contact|聯絡|email|phone/i,
  /reference|title|organization|機構|編號/i,
]

function isKeyField(field: string): boolean {
  return KEY_FIELD_PATTERNS.some((p) => p.test(field))
}

function normalizeFieldName(field: string): string {
  const cleaned = field
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  for (const [canonical, aliases] of Object.entries(FIELD_CANONICAL_ALIASES)) {
    const canonicalLabel = canonical.replace(/_/g, " ")
    if (cleaned === canonicalLabel || cleaned.includes(canonicalLabel)) return canonical
    for (const alias of aliases) {
      if (cleaned.includes(alias) || alias.includes(cleaned)) return canonical
    }
  }
  return cleaned
}

function buildComparison(tenders: TenderItem[]): ComparisonResult | null {
  if (tenders.length < 2) return null

  const canonicalFields = new Map<string, string>()

  for (const t of tenders) {
    for (const f of t.fields) {
      if (!f.field.trim()) continue
      const canonical = normalizeFieldName(f.field)
      if (!canonicalFields.has(canonical)) {
        canonicalFields.set(canonical, f.field)
      }
    }
  }

  const comparisonFields: ComparisonField[] = Array.from(canonicalFields.entries()).map(
    ([canonical, displayField]) => {
      const values = tenders.map((t) => {
        const found = t.fields.find((f) => normalizeFieldName(f.field) === canonical)
        return {
          tenderId: t.id,
          tenderTitle: t.name,
          value: found?.value || "—",
        }
      })
      const allMatch = values.length >= 2 && values.every((v) => v.value === values[0].value)
      return {
        field: displayField,
        values,
        match: allMatch,
        isKey: isKeyField(displayField) || isKeyField(canonical),
      }
    }
  )

  comparisonFields.sort((a, b) => {
    if (a.isKey && !b.isKey) return -1
    if (!a.isKey && b.isKey) return 1
    return a.field.localeCompare(b.field)
  })

  return {
    comparisonFields,
    tenders: tenders.map((t) => ({ id: t.id, title: t.name })),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSseRecord(raw: string): { event: string; data: Record<string, any> | null } {
  const lines = raw.split(/\r?\n/)
  let eventType = "message"
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return { event: eventType, data: null }
  try { return { event: eventType, data: JSON.parse(dataLines.join("\n")) } }
  catch { return { event: eventType, data: null } }
}

// ── Component ──────────────────────────────────────────────────

export default function TenderPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
      <TenderPageContent />
    </Suspense>
  )
}

function TenderPageContent() {
  const searchParams = useSearchParams()
  const fromEmailId = searchParams.get("fromEmail")
  const emailSubjectParam = searchParams.get("emailSubject")
  const attachmentIdParam = searchParams.get("attachmentId")
  const attachmentIdsParam = searchParams.get("attachmentIds")

  const [viewMode, setViewMode] = useState<"edit" | "compare">("edit")
  const [tenders, setTenders] = useState<TenderItem[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODELS.tender)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [thinkingText, setThinkingText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [streamingStatus, setStreamingStatus] = useState<"idle" | "connecting" | "thinking" | "done" | "error">("idle")
  const [confidence, setConfidence] = useState<number | null>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showDiffsOnly, setShowDiffsOnly] = useState(true)
  const [aiCompareResult, setAiCompareResult] = useState<AiCompareResult | null>(null)
  const [loadingAiCompare, setLoadingAiCompare] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [emailSource, setEmailSource] = useState<EmailSource | null>(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(new Set())
  const [loadingEmailExtract, setLoadingEmailExtract] = useState(false)

  const comparisonResult = useMemo(() => buildComparison(tenders), [tenders])

  useEffect(() => {
    fetch("/api/tender/templates")
      .then((r) => r.json())
      .then((data) => { if (data.templates) setTemplates(data.templates) })
      .catch(() => {})
  }, [])

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
        setSelectedAttachmentIds(getInitialSelectedAttachmentIds(attachments, preferredIds))
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
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    if (tenders.length < 2 && viewMode === "compare") {
      setViewMode("edit")
    }
  }, [tenders.length, viewMode])

  useEffect(() => {
    if (viewMode !== "compare" || tenders.length < 2) {
      setAiCompareResult(null)
      return
    }

    let cancelled = false
    setLoadingAiCompare(true)

    fetch("/api/tender/agent?action=compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenders: tenders.map((t) => ({
          title: t.name,
          fields: t.fields,
        })),
      }),
    })
      .then((r) => r.json())
      .then((data: AiCompareResult) => {
        if (!cancelled) setAiCompareResult(data)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoadingAiCompare(false)
      })

    return () => {
      cancelled = true
    }
  }, [viewMode, tenders])

  function resetState() {
    abortRef.current?.abort()
    setAnalyzing(false)
    setStreamingStatus("idle")
    setTraceEvents([])
    setThinkingText("")
    setError(null)
    setConfidence(null)
  }

  function applyExtractionResult(result: ExtractionResult, fileName: string) {
    if (result.fields && result.fields.length > 0) {
      const newTender: TenderItem = {
        id: `tender-${Date.now()}`,
        name: result.tenderTitle || fileName.replace(/\.(pdf|docx?|txt)$/i, ""),
        fields: result.fields,
        type: result.tenderType || null,
      }
      setTenders((prev) => {
        const next = [...prev, newTender]
        if (next.length >= 2) setViewMode("compare")
        return next
      })
      if (result.confidence !== undefined) setConfidence(result.confidence)
      setStreamingStatus("done")
      return true
    }
    setError("AI 未能識別結構化欄位，可手動新增或重試")
    setStreamingStatus("error")
    return false
  }

  async function consumeExtractionStream(response: Response, fileName: string) {
    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: string; detail?: string }
      throw new Error(errData.detail || errData.error || `Server error: ${response.status}`)
    }
    if (!response.body) throw new Error("Response body is not available")

    const appendTraceEvent = (trace: TraceEvent) => {
      setTraceEvents((prev) => [
        ...prev,
        {
          ...trace,
          id: `${trace.id}-${fileName}-${prev.length}`,
        },
      ])
    }

    const bodyReader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let result: ExtractionResult | null = null
    let streamError: string | null = null

    while (true) {
      const { value, done } = await bodyReader.read()
      if (value) buffer += decoder.decode(value, { stream: !done })
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const record = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 2)
        if (record) {
          const parsed = parseSseRecord(record)
          switch (parsed.event) {
            case "trace":
              if (parsed.data?.trace) appendTraceEvent(parsed.data.trace as TraceEvent)
              break
            case "thinking":
              if (parsed.data?.text) setThinkingText(parsed.data.text)
              break
            case "result":
              if (parsed.data?.result) result = parsed.data.result as ExtractionResult
              break
            case "error": {
              const code = parsed.data?.code as string | undefined
              streamError =
                code === "TEXT_EXTRACTION_FAILED"
                  ? (parsed.data?.detail as string) || "無法從文件中讀取文字，請嘗試文字版 PDF 或 DOCX"
                  : (parsed.data?.detail as string) || (parsed.data?.error as string) || "Unknown error"
              setError(streamError)
              setStreamingStatus("error")
              break
            }
          }
        }
        boundary = buffer.indexOf("\n\n")
      }
      if (done) break
    }

    if (streamError) return false
    if (result) return applyExtractionResult(result, fileName)
    setError("分析未完成，請重試")
    setStreamingStatus("error")
    return false
  }

  async function runExtraction(documentText: string, fileName: string, options?: { skipReset?: boolean }) {
    if (!options?.skipReset) resetState()
    setAnalyzing(true)
    setStreamingStatus("connecting")
    const controller = new AbortController()
    abortRef.current = controller
    try {
      setStreamingStatus("thinking")
      const response = await fetch("/api/tender/agent?action=extract&stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText,
          fileName,
          templateId: selectedTemplate || undefined,
          model,
        }),
        signal: controller.signal,
      })
      await consumeExtractionStream(response, fileName)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      setError(err instanceof Error ? err.message : "Unknown error")
      setStreamingStatus("error")
    } finally {
      setAnalyzing(false)
    }
  }

  async function extractFromFile(file: File) {
    resetState()
    setAnalyzing(true)
    setStreamingStatus("connecting")
    const controller = new AbortController()
    abortRef.current = controller
    try {
      setStreamingStatus("thinking")
      const formData = new FormData()
      formData.append("file", file)
      if (selectedTemplate) formData.append("templateId", selectedTemplate)
      formData.append("model", model)

      const response = await fetch("/api/tender/agent?action=extract&stream=1", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })
      await consumeExtractionStream(response, file.name)
    } catch (err) {
      if ((err as Error).name === "AbortError") return
      setError(err instanceof Error ? err.message : "Unknown error")
      setStreamingStatus("error")
    } finally {
      setAnalyzing(false)
    }
  }

  async function loadEmailAttachmentAndAnalyze(
    attachmentId: string,
    options?: { skipReset?: boolean }
  ) {
    if (!emailSource) return
    const att = emailSource.attachments.find((a) => a.id === attachmentId)
    if (!att) return

    if (!options?.skipReset) {
      setLoadingEmailExtract(true)
      setError(null)
    }
    try {
      const res = await fetch(
        `/api/email/attachments?action=extract&id=${encodeURIComponent(attachmentId)}`
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(errData.detail || errData.error || "Failed to extract attachment text")
      }
      const data = (await res.json()) as { text?: string; fileName?: string }
      if (!data.text?.trim()) {
        throw new Error("No text could be extracted from the attachment")
      }
      await runExtraction(data.text, data.fileName || att.fileName, options)
    } catch (err) {
      console.error("Email attachment analyze error:", err)
      setError(err instanceof Error ? err.message : "Failed to analyze email attachment")
      setStreamingStatus("error")
      setAnalyzing(false)
      throw err
    } finally {
      if (!options?.skipReset) {
        setLoadingEmailExtract(false)
      }
    }
  }

  async function handleAnalyzeEmail() {
    if (!emailSource) return
    const selected = getSelectedAnalyzableAttachments(
      emailSource.attachments,
      selectedAttachmentIds
    )

    if (selected.length > 0) {
      resetState()
      setLoadingEmailExtract(true)
      setError(null)
      try {
        for (let i = 0; i < selected.length; i++) {
          await loadEmailAttachmentAndAnalyze(selected[i].id, { skipReset: i > 0 })
        }
      } catch {
        // Error already surfaced in loadEmailAttachmentAndAnalyze
      } finally {
        setLoadingEmailExtract(false)
        setAnalyzing(false)
      }
      return
    }

    if (emailSource.body.trim()) {
      await runExtraction(emailSource.body, `${emailSource.subject || "email"}.txt`)
    } else {
      setError("Select at least one attachment to analyze")
      setStreamingStatus("error")
    }
  }

  const selectedAnalyzableAttachments = emailSource
    ? getSelectedAnalyzableAttachments(emailSource.attachments, selectedAttachmentIds)
    : []

  const emailAnalyzableAttachments = emailSource
    ? emailSource.attachments.filter((att) => isAnalyzableEmailAttachment(att))
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
    setSelectedAttachmentIds(
      new Set(emailAnalyzableAttachments.map((att) => att.id))
    )
  }

  function clearAttachmentSelection() {
    setSelectedAttachmentIds(new Set())
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    resetState()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    setPreviewFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleAnalyzeFile() {
    if (!previewFile) return
    await extractFromFile(previewFile)
  }

  function addField(ti: number) {
    setTenders(tenders.map((t, i) => i === ti ? { ...t, fields: [...t.fields, { field: "", value: "" }] } : t))
  }
  function updateField(ti: number, fi: number, update: Partial<TenderField>) {
    setTenders(tenders.map((t, i) => i === ti ? { ...t, fields: t.fields.map((f, j) => j === fi ? { ...f, ...update } : f) } : t))
  }
  function deleteField(ti: number, fi: number) {
    setTenders(tenders.map((t, i) => i === ti ? { ...t, fields: t.fields.filter((_, j) => j !== fi) } : t))
  }
  function removeTender(ti: number) { setTenders(tenders.filter((_, i) => i !== ti)) }

  function exportTenders() {
    const rows = tenders.flatMap((t) => t.fields.map((f) => ({ field: `${t.name} - ${f.field}`, value: f.value })))
    fetch("/api/report/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, format: "xlsx" }) })
      .then((r) => r.blob())
      .then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `tender-export-${Date.now()}.xlsx`; a.click(); URL.revokeObjectURL(url) })
      .catch(console.error)
  }

  function exportComparison() {
    if (!comparisonResult) return
    const flatRows = comparisonResult.comparisonFields.flatMap((cf) =>
      cf.values.map((v) => ({ field: `${cf.field} [${v.tenderTitle}]`, value: v.value }))
    )
    fetch("/api/report/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: flatRows, format: "xlsx" }) })
      .then((r) => r.blob())
      .then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `tender-comparison-${Date.now()}.xlsx`; a.click(); URL.revokeObjectURL(url) })
      .catch(console.error)
  }

  const diffCount = comparisonResult?.comparisonFields.filter((f) => !f.match).length ?? 0
  const matchCount = comparisonResult
    ? comparisonResult.comparisonFields.length - diffCount
    : 0

  function filterForDisplay(fields: ComparisonField[]) {
    return showDiffsOnly ? fields.filter((f) => !f.match) : fields
  }

  const keyFields = filterForDisplay(comparisonResult?.comparisonFields.filter((f) => f.isKey) ?? [])
  const otherFields = filterForDisplay(comparisonResult?.comparisonFields.filter((f) => !f.isKey) ?? [])

  function renderComparisonTable(fields: ComparisonField[], label?: string) {
    if (!comparisonResult || fields.length === 0) return null
    return (
      <div>
        {label && (
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">{label}</h3>
        )}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium w-48">Field</th>
                {comparisonResult.tenders.map((tender) => (
                  <th key={tender.id} className="px-4 py-3 text-left font-medium min-w-[160px]">
                    {tender.title}
                  </th>
                ))}
                <th className="px-4 py-3 text-center font-medium w-20">Match</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((cf, idx) => (
                <tr
                  key={cf.field}
                  className={cn(
                    "border-b",
                    idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                    !cf.match && "bg-amber-50/30 dark:bg-amber-950/10"
                  )}
                >
                  <td className="px-4 py-2.5 font-medium text-muted-foreground">{cf.field}</td>
                  {cf.values.map((v) => (
                    <td key={`${cf.field}-${v.tenderId}`} className="px-4 py-2.5">
                      {cf.match ? (
                        <span>{v.value}</span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">{v.value}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-center">
                    {cf.match ? (
                      <Check className="inline h-4 w-4 text-green-500" />
                    ) : (
                      <X className="inline h-4 w-4 text-amber-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">
            {viewMode === "compare" ? "Tender Comparison" : "Tender & Bidding Agent"}
          </h1>
          {emailSource && viewMode === "edit" && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              From Email Agent
            </span>
          )}
          {viewMode === "edit" && confidence !== null && (
            <span className="text-xs text-muted-foreground">
              Confidence: {(confidence * 100).toFixed(0)}%
            </span>
          )}
          {viewMode === "compare" && tenders.length >= 2 && (
            <span className="text-xs text-muted-foreground">
              Comparing {tenders.length} documents
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "compare" ? (
            <>
              <button
                onClick={() => {
                  setViewMode("edit")
                  fileInputRef.current?.click()
                }}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                <Plus className="h-4 w-4" />
                Add Another Tender
              </button>
              <button
                onClick={() => setViewMode("edit")}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Edit
              </button>
              <button
                onClick={exportComparison}
                disabled={!comparisonResult}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Export Comparison
              </button>
            </>
          ) : (
            <>
              <ModelSelector value={model} onChange={setModel} />
              {tenders.length >= 2 && (
                <button
                  onClick={() => setViewMode("compare")}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  <GitCompare className="h-4 w-4" />
                  Compare ({tenders.length})
                </button>
              )}
              <button
                disabled={tenders.length === 0}
                onClick={exportTenders}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Export All
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Upload Panel */}
        <div className="w-80 border-r p-6 overflow-y-auto">
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
                  <p className="text-sm font-medium line-clamp-2">{emailSource.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {emailSource.senderName} &lt;{emailSource.senderEmail}&gt;
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Email forwarded — click below to analyze with Tender Agent.
                  </p>
                  <button
                    onClick={handleAnalyzeEmail}
                    disabled={
                      !canAnalyzeEmail ||
                      analyzing ||
                      loadingEmailExtract
                    }
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {loadingEmailExtract || analyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {loadingEmailExtract || analyzing
                      ? "Analyzing..."
                      : selectedAnalyzableAttachments.length > 1
                        ? `Analyze ${selectedAnalyzableAttachments.length} with Tender`
                        : "Analyze with Tender"}
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
                        const analyzable = isAnalyzableEmailAttachment(att)
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

          <div className={cn(analyzing && "opacity-50 pointer-events-none")}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            {previewUrl ? (
              <div className="rounded-lg border-2 border-dashed p-6 text-center">
                <div className="flex h-24 flex-col items-center justify-center rounded-lg bg-muted">
                  <FileText className="h-8 w-8 text-muted-foreground/50" />
                  <span className="mt-2 text-sm text-muted-foreground">{previewFile?.name}</span>
                </div>
                <div className="mt-4 flex flex-col items-center gap-2">
                  <button
                    onClick={handleAnalyzeFile}
                    disabled={analyzing}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {analyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {analyzing ? "Analyzing..." : "Analyze File"}
                  </button>
                  <button
                    onClick={() => {
                      if (previewUrl) URL.revokeObjectURL(previewUrl)
                      setPreviewUrl(null)
                      setPreviewFile(null)
                      resetState()
                      fileInputRef.current?.click()
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Change file
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/50"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Upload Tender Document</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, DOCX, or TXT — upload multiple to compare
                </p>
              </div>
            )}
          </div>

          {streamingStatus !== "idle" && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                {streamingStatus === "connecting" && (
                  <><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /><span className="text-sm text-muted-foreground">Connecting...</span></>
                )}
                {streamingStatus === "thinking" && (
                  <><Brain className="h-4 w-4 text-blue-500 animate-pulse" /><span className="text-sm text-blue-600">AI is analyzing...</span></>
                )}
                {streamingStatus === "done" && (
                  <><BarChart3 className="h-4 w-4 text-green-500" /><span className="text-sm text-green-600">Analysis complete</span></>
                )}
                {streamingStatus === "error" && (
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
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Process</p>
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
                <option key={t.id} value={t.id}>{t.title} ({t.scenario || "general"})</option>
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

          {tenders.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">Analyzed Tenders ({tenders.length})</h3>
              <div className="space-y-1">
                {tenders.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-accent/50 group">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{t.name}</span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      {t.fields.length} fields
                    </span>
                    {t.type && <span className="text-xs text-muted-foreground capitalize">{t.type.replace(/_/g, " ")}</span>}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeTender(i) }}
                      className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              {tenders.length >= 2 && viewMode === "edit" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Use <strong>Compare ({tenders.length})</strong> in the header to view key fields side-by-side.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: Edit or Compare */}
        <div className="flex-1 p-6 overflow-y-auto">
          {viewMode === "compare" && comparisonResult ? (
            <div className="space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <GitCompare className="h-4 w-4" />
                  <span>
                    <strong className="text-foreground">{diffCount}</strong> differing /{" "}
                    <strong className="text-foreground">{matchCount}</strong> matching across{" "}
                    {tenders.length} tenders
                  </span>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showDiffsOnly}
                    onChange={(e) => setShowDiffsOnly(e.target.checked)}
                    className="rounded border"
                  />
                  Show differences only
                </label>
              </div>

              {showDiffsOnly && keyFields.length === 0 && otherFields.length === 0 && (
                <div className="rounded-lg border bg-green-50/50 p-4 text-center text-sm text-green-700 dark:bg-green-950/20 dark:text-green-400">
                  All compared fields match across tenders.
                </div>
              )}

              {renderComparisonTable(keyFields, "Key Information")}
              {renderComparisonTable(otherFields, keyFields.length > 0 ? "Other Fields" : undefined)}

              <div className="rounded-lg border bg-muted/20 p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Brain className="h-4 w-4" />
                  AI Comparison Summary
                </h3>
                {loadingAiCompare ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating comparison insights...
                  </div>
                ) : aiCompareResult ? (
                  <div className="space-y-4 text-sm">
                    {aiCompareResult.keyDifferences && aiCompareResult.keyDifferences.length > 0 && (
                      <div>
                        <p className="mb-2 font-medium">Key Differences</p>
                        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                          {aiCompareResult.keyDifferences.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {aiCompareResult.recommendation && (
                      <div className="rounded-md border bg-background p-3">
                        <p className="font-medium">
                          Recommendation:{" "}
                          <span className="text-primary capitalize">
                            {aiCompareResult.recommendation.preferred || "—"}
                          </span>
                        </p>
                        {aiCompareResult.recommendation.reason && (
                          <p className="mt-1 text-muted-foreground">
                            {aiCompareResult.recommendation.reason}
                          </p>
                        )}
                      </div>
                    )}
                    {(aiCompareResult.risksA?.length || aiCompareResult.risksB?.length) ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {aiCompareResult.risksA && aiCompareResult.risksA.length > 0 && (
                          <div>
                            <p className="mb-1 font-medium">{tenders[0]?.name} — Risks</p>
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                              {aiCompareResult.risksA.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {aiCompareResult.risksB && aiCompareResult.risksB.length > 0 && tenders[1] && (
                          <div>
                            <p className="mb-1 font-medium">{tenders[1].name} — Risks</p>
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                              {aiCompareResult.risksB.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : null}
                    {!aiCompareResult.keyDifferences?.length &&
                      !aiCompareResult.recommendation &&
                      !aiCompareResult.risksA?.length &&
                      !aiCompareResult.risksB?.length && (
                        <p className="text-muted-foreground">No AI insights available for this comparison.</p>
                      )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">AI insights unavailable.</p>
                )}
              </div>
            </div>
          ) : viewMode === "compare" ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <GitCompare className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Not enough tenders to compare</h3>
              <p className="mt-1 text-sm text-muted-foreground">Upload at least 2 documents to compare.</p>
            </div>
          ) : tenders.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Tender &amp; Bidding Agent</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Upload tender documents to analyze key information. Upload 2 or more to compare side-by-side on this page.
              </p>
              {emailSource ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Click Analyze with Tender to extract fields from the email attachment.
                </p>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Upload a PDF, DOCX, or TXT file to get started</p>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {tenders.map((tender, ti) => (
                <div key={tender.id}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="font-semibold">{tender.name}</h2>
                      {tender.type && (
                        <span className="text-xs text-muted-foreground capitalize">{tender.type.replace(/_/g, " ")}</span>
                      )}
                    </div>
                    <button
                      onClick={() => addField(ti)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <Plus className="h-3 w-3" />
                      Add Field
                    </button>
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
                      No fields extracted —{" "}
                      <button onClick={() => fileInputRef.current?.click()} className="text-primary hover:underline">
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
  )
}
