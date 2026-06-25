"use client"

import { useState, useRef, useEffect, useMemo, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  FileText, Download, Plus, Trash2, Loader2,
  GitCompare, Brain, BarChart3, Search, Pencil, BookOpen, ArrowLeft,
  Mail, Sparkles,
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
import { TenderComparisonPanel } from "@/features/tender/components/tender-comparison-panel"
import { TenderStructuredFields } from "@/features/tender/components/tender-structured-fields"
import { TenderKbImportDialog } from "@/features/tender/components/tender-kb-import-dialog"
import {
  buildComparisonKbText,
  defaultComparisonKbTitle,
} from "@/features/tender/lib/tender-comparison-kb-text"
import { useAuth } from "@/features/auth/auth-context"
import {
  getApiErrorMessage,
  handleUnauthorizedResponse,
} from "@/features/auth/handle-api-unauthorized"
import {
  cacheTenderSessionWorkspace,
  clearTenderWorkspace,
  getCachedTenderSessionWorkspace,
  getTenderWorkspace,
  TENDER_NEW_ANALYZE_EVENT,
  updateCachedTenderSessionWorkspace,
  type TenderWorkspaceSnapshot,
} from "@/features/tender/lib/tender-workspace-store"
import { useTenderWorkspaceSync } from "@/features/tender/hooks/use-tender-workspace-sync"
import {
  deriveTenderSessionTitle,
  deriveTenderSessionType,
  packTenderFieldInputs,
  packTenderProcessingMarker,
  unpackTenderSessionWorkspace,
  getTenderBatchAnalysis,
  setTenderBatchAnalysis,
  clearTenderBatchAnalysis,
  isTenderBatchInProgress,
  normalizeTenderViewMode,
  type TenderBatchAnalysisState,
  type TenderSessionWorkspace,
} from "@/features/tender/lib/tender-session-workspace"
import {
  registerPendingTenderAnalysis,
  removePendingTenderAnalysis,
  TENDER_ANALYSIS_COMPLETE,
  TENDER_ANALYSIS_STARTED,
  type TenderAnalysisCompleteDetail,
} from "@/features/tender/tender-analysis-tracker"
import { fetchTenderSessionById } from "@/features/tender/lib/tender-session-loader"
import { readAgentSseStream } from "@/features/shared/lib/agent-sse"
import { AgentUploadPanel } from "@/features/shared/components/agent-upload-panel"
import {
  AgentUploadQueue,
  buildUploadFileId,
} from "@/features/shared/components/agent-upload-queue"

// ── Types ──────────────────────────────────────────────────────

interface TenderField { field: string; value: string }

interface TenderItem {
  id: string
  name: string
  fileName?: string
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
  mockWarning?: string | null
}

interface ExtractionResult {
  fields?: TenderField[]
  tenderTitle?: string
  tenderType?: string
  confidence?: number
  model?: string
}

interface TenderAnalysisResult {
  tender: TenderItem
  confidence?: number
  mockWarning?: string | null
}

interface TenderBatchError {
  fileName: string
  error: string
}

interface PendingUploadFile {
  id: string
  file: File
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
          tenderTitle: t.fileName || t.name,
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
    tenders: tenders.map((t) => ({ id: t.id, title: t.fileName || t.name })),
  }
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
  const { refreshSession } = useAuth()
  const searchParams = useSearchParams()
  const fromEmailId = searchParams.get("fromEmail")
  const emailSubjectParam = searchParams.get("emailSubject")
  const attachmentIdParam = searchParams.get("attachmentId")
  const attachmentIdsParam = searchParams.get("attachmentIds")
  const restoredWorkspace = getTenderWorkspace()
  const initialTenders = restoredWorkspace?.tenders ?? []

  const [viewMode, setViewMode] = useState<"edit" | "compare">(
    normalizeTenderViewMode(restoredWorkspace?.viewMode ?? "edit", initialTenders.length)
  )
  const [tenders, setTenders] = useState<TenderItem[]>(initialTenders)
  const [analyzing, setAnalyzing] = useState(
    restoredWorkspace?.streamingStatus === "thinking" ||
      restoredWorkspace?.streamingStatus === "connecting"
  )
  const [model, setModel] = useState(restoredWorkspace?.model ?? DEFAULT_MODELS.tender)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(
    restoredWorkspace?.selectedTemplate ?? null
  )
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    restoredWorkspace?.activeSessionId ?? null
  )
  const [templates, setTemplates] = useState<Template[]>([])
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [thinkingText, setThinkingText] = useState("")
  const [error, setError] = useState<string | null>(restoredWorkspace?.error ?? null)
  const [streamingStatus, setStreamingStatus] = useState<
    "idle" | "connecting" | "thinking" | "done" | "error"
  >(restoredWorkspace?.streamingStatus ?? "idle")
  const [confidence, setConfidence] = useState<number | null>(
    restoredWorkspace?.confidence ?? null
  )
  const [pendingFiles, setPendingFiles] = useState<PendingUploadFile[]>(
    restoredWorkspace?.pendingFiles ?? []
  )
  const [selectedUploadFileIds, setSelectedUploadFileIds] = useState<Set<string>>(
    () => new Set(restoredWorkspace?.selectedUploadFileIds ?? [])
  )
  const [showDiffsOnly, setShowDiffsOnly] = useState(
    restoredWorkspace?.showDiffsOnly ?? true
  )
  const [aiCompareResult, setAiCompareResult] = useState<AiCompareResult | null>(
    restoredWorkspace?.aiCompareResult ?? null
  )
  const [loadingAiCompare, setLoadingAiCompare] = useState(false)
  const [mockWarning, setMockWarning] = useState<string | null>(
    restoredWorkspace?.mockWarning ?? null
  )
  const [kbImportOpen, setKbImportOpen] = useState(false)
  const [statusBanner, setStatusBanner] = useState<{ tone: "success" | "error"; message: string } | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessionAbortControllersRef = useRef<Map<string, AbortController>>(new Map())
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tendersRef = useRef(tenders)
  const activeSessionIdRef = useRef(activeSessionId)
  const viewModeRef = useRef(viewMode)
  const analyzingRef = useRef(analyzing)
  const ensureSessionInFlightRef = useRef<Promise<string | null> | null>(null)
  tendersRef.current = tenders
  activeSessionIdRef.current = activeSessionId
  viewModeRef.current = viewMode
  analyzingRef.current = analyzing
  const [emailSource, setEmailSource] = useState<EmailSource | null>(
    restoredWorkspace?.emailSource ?? null
  )
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(
    () => new Set(restoredWorkspace?.selectedAttachmentIds ?? [])
  )
  const [loadingEmailExtract, setLoadingEmailExtract] = useState(false)

  const comparisonResult = useMemo(() => buildComparison(tenders), [tenders])
  const comparisonKbText = useMemo(() => {
    if (!comparisonResult) return ""
    return buildComparisonKbText({
      comparisonResult,
      tenderNames: tenders.map((t) => t.fileName || t.name),
      diffCount: comparisonResult.comparisonFields.filter((f) => !f.match).length,
      matchCount: comparisonResult.comparisonFields.filter((f) => f.match).length,
      showDiffsOnly,
      aiCompareResult,
    })
  }, [comparisonResult, tenders, showDiffsOnly, aiCompareResult])
  const hasEditableFields = tenders.some((t) => t.fields.length > 0)

  const ensureSessionId = useCallback(
    async (titleHint?: string): Promise<string | null> => {
      if (activeSessionIdRef.current) return activeSessionIdRef.current
      if (ensureSessionInFlightRef.current) return ensureSessionInFlightRef.current

      ensureSessionInFlightRef.current = (async () => {
        const id = `tender-${Date.now()}`
        const title = titleHint || `Tender Analysis ${new Date().toLocaleDateString()}`
        try {
          const res = await fetch("/api/tender/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              title,
              templateId: selectedTemplate || undefined,
            }),
          })
          if (await handleUnauthorizedResponse(res, refreshSession)) return null
          if (res.ok) {
            activeSessionIdRef.current = id
            setActiveSessionId(id)
            window.dispatchEvent(new Event("tender:sessions-updated"))
            return id
          }
        } catch (err) {
          console.error("Failed to create tender session:", err)
        }
        return null
      })()

      const createdId = await ensureSessionInFlightRef.current
      ensureSessionInFlightRef.current = null
      return createdId
    },
    [selectedTemplate, refreshSession]
  )

  const persistSessionSnapshot = useCallback(
    async (
      tendersSnapshot: TenderItem[],
      options?: {
        sessionId?: string | null
        viewMode?: "edit" | "compare"
        status?: "processing" | "completed" | "failed"
        allowEmpty?: boolean
      }
    ) => {
      const sessionId = options?.sessionId ?? activeSessionIdRef.current
      if (!sessionId) return
      if (tendersSnapshot.length === 0 && !options?.allowEmpty) return

      const snapshotViewMode = normalizeTenderViewMode(
        options?.viewMode ?? viewModeRef.current,
        tendersSnapshot.length
      )

      const batch = sessionId ? getTenderBatchAnalysis(sessionId) : null
      const batchIncomplete = batch
        ? batch.completedFiles + (batch.failedFiles ?? 0) < batch.totalFiles
        : false
      const resolvedStatus =
        options?.status ??
        (batchIncomplete || analyzing ? "processing" : "completed")

      const workspace: TenderSessionWorkspace = {
        version: 1,
        tenders: tendersSnapshot,
        viewMode: snapshotViewMode,
        showDiffsOnly,
        selectedTemplate,
        model,
        aiCompareResult,
        analysisState:
          resolvedStatus === "processing"
            ? "processing"
            : resolvedStatus === "failed"
              ? "failed"
              : "completed",
        analysisProgress: batch
          ? {
              totalFiles: batch.totalFiles,
              completedFiles: batch.completedFiles,
              failedFiles: batch.failedFiles ?? 0,
              fileNames: batch.fileNames,
              errors: batch.errors ?? [],
            }
          : resolvedStatus === "processing"
            ? undefined
            : undefined,
      }

      try {
        const res = await fetch("/api/tender/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: sessionId,
            title: deriveTenderSessionTitle(tendersSnapshot),
            templateId: selectedTemplate || undefined,
            tenderType: deriveTenderSessionType(tendersSnapshot),
            fieldInputs: packTenderFieldInputs(workspace),
            status: resolvedStatus,
          }),
        })
        if (await handleUnauthorizedResponse(res, refreshSession)) return
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
          console.error("Failed to save tender session:", errData.error || errData.detail || res.status)
          return
        }
        window.dispatchEvent(new Event("tender:sessions-updated"))
      } catch (err) {
        console.error("Failed to save tender session:", err)
      }
    },
    [showDiffsOnly, selectedTemplate, model, aiCompareResult, analyzing, refreshSession]
  )

  const persistProcessingMarker = useCallback(
    async (sessionId: string, fileNames: string[]) => {
      if (!sessionId || fileNames.length === 0) return
      const title =
        fileNames.length === 1
          ? fileNames[0]
          : `Batch (${fileNames.length} files)`
      try {
        const res = await fetch("/api/tender/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: sessionId,
            title,
            fieldInputs: packTenderProcessingMarker({
              fileNames,
              model,
              selectedTemplate,
              showDiffsOnly,
            }),
            status: "processing",
          }),
        })
        if (await handleUnauthorizedResponse(res, refreshSession)) return
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
          console.error("Failed to save processing marker:", errData.error || errData.detail || res.status)
          return
        }
        window.dispatchEvent(new Event("tender:sessions-updated"))
      } catch (err) {
        console.error("Failed to save processing marker:", err)
      }
    },
    [model, selectedTemplate, showDiffsOnly, refreshSession]
  )

  const persistSessionWorkspace = useCallback(async () => {
    await persistSessionSnapshot(tendersRef.current)
  }, [persistSessionSnapshot])

  useEffect(() => {
    if (!activeSessionId) return
    const batchInProgress = isTenderBatchInProgress(activeSessionId)
    if (tenders.length === 0 && !batchInProgress && !analyzing) return
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    sessionSaveTimerRef.current = setTimeout(() => {
      void persistSessionWorkspace()
    }, 800)
    return () => {
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    }
  }, [activeSessionId, tenders, viewMode, showDiffsOnly, aiCompareResult, analyzing, persistSessionWorkspace])

  useEffect(() => {
    fetch("/api/tender/templates")
      .then((r) => r.json())
      .then((data) => { if (data.templates) setTemplates(data.templates) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!fromEmailId) return

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
    if (tenders.length < 2 && viewMode === "compare") {
      setViewMode("edit")
    }
  }, [tenders.length, viewMode])

  useEffect(() => {
    function onAnalysisComplete(event: Event) {
      const detail = (event as CustomEvent<TenderAnalysisCompleteDetail>).detail
      if (!detail?.sessionId || detail.sessionId !== activeSessionIdRef.current) return

      const cached = getCachedTenderSessionWorkspace(detail.sessionId)
      if (cached && cached.tenders.length > 0) {
        const hydratedViewMode = normalizeTenderViewMode(
          cached.viewMode,
          cached.tenders.length
        )
        setTenders(cached.tenders)
        setViewMode(hydratedViewMode)
        viewModeRef.current = hydratedViewMode
        setShowDiffsOnly(cached.showDiffsOnly)
        setModel(cached.model)
        setSelectedTemplate(cached.selectedTemplate)
        setAiCompareResult(cached.aiCompareResult)
        setStreamingStatus(cached.streamingStatus)
        setAnalyzing(cached.streamingStatus === "thinking" || cached.streamingStatus === "connecting")
        setError(cached.error)
        return
      }

      void fetchTenderSessionById(detail.sessionId).then((session) => {
        if (!session) return
        const workspace = unpackTenderSessionWorkspace(session.fieldInputs, {
          title: session.title,
        })
        if (!workspace || workspace.tenders.length === 0) return
        const hydratedViewMode = normalizeTenderViewMode(
          workspace.viewMode,
          workspace.tenders.length
        )
        setTenders(workspace.tenders)
        setViewMode(hydratedViewMode)
        viewModeRef.current = hydratedViewMode
        setShowDiffsOnly(workspace.showDiffsOnly)
        setModel(workspace.model || DEFAULT_MODELS.tender)
        setSelectedTemplate(workspace.selectedTemplate)
        setAiCompareResult(workspace.aiCompareResult ?? null)
        setStreamingStatus("done")
        setAnalyzing(false)
      })
    }

    window.addEventListener(TENDER_ANALYSIS_COMPLETE, onAnalysisComplete)
    return () => window.removeEventListener(TENDER_ANALYSIS_COMPLETE, onAnalysisComplete)
  }, [])

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
          title: t.fileName || t.name,
          fields: t.fields,
        })),
      }),
    })
      .then(async (r) => {
        if (await handleUnauthorizedResponse(r, refreshSession)) return null
        return r.json()
      })
      .then((data: AiCompareResult | null) => {
        if (!data || cancelled) return
        setAiCompareResult(data)
        if (data.mockWarning) {
          setMockWarning(
            data.mockWarning === "AI unavailable, using demo data"
              ? "未連接大模型，目前為演示資料。請確認 combine-ai-platform/.env 中的 DASHSCOPE_API_KEY 並重啟 dev server。"
              : data.mockWarning
          )
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoadingAiCompare(false)
      })

    return () => {
      cancelled = true
    }
  }, [viewMode, tenders, refreshSession])

  function isActiveSession(sessionId?: string | null): boolean {
    const resolved = sessionId ?? activeSessionIdRef.current
    return resolved === activeSessionIdRef.current
  }

  function clearStreamingUi() {
    setTraceEvents([])
    setThinkingText("")
    setError(null)
    setConfidence(null)
    setMockWarning(null)
  }

  function resetState() {
    clearStreamingUi()
    setAnalyzing(false)
    setStreamingStatus("idle")
  }

  function abortAllSessionExtractions() {
    for (const controller of sessionAbortControllersRef.current.values()) {
      controller.abort()
    }
    sessionAbortControllersRef.current.clear()
  }

  function resetForNewBatch() {
    abortAllSessionExtractions()
    resetState()
    tendersRef.current = []
    viewModeRef.current = "edit"
    setTenders([])
    setViewMode("edit")
    setAiCompareResult(null)
  }

  function buildTenderAnalysisResult(
    result: ExtractionResult,
    fileName: string
  ): TenderAnalysisResult {
    if (!result.fields || result.fields.length === 0) {
      throw new Error("AI 未能識別結構化欄位，可手動新增或重試")
    }

    return {
      tender: {
        id: `tender-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: result.tenderTitle || fileName.replace(/\.(pdf|docx?|txt)$/i, ""),
        fileName,
        fields: result.fields,
        type: result.tenderType || null,
      },
      confidence: result.confidence,
      mockWarning: result.model === "mock-template" ? "未連接大模型，目前為演示資料" : null,
    }
  }

  function applyExtractionResult(
    result: ExtractionResult,
    fileName: string,
    sessionId?: string | null
  ) {
    const resolvedSessionId = sessionId ?? activeSessionIdRef.current
    const active = isActiveSession(resolvedSessionId)

    try {
      const analysis = buildTenderAnalysisResult(result, fileName)
      const cached = resolvedSessionId
        ? getCachedTenderSessionWorkspace(resolvedSessionId)
        : null
      const baseTenders = active ? tendersRef.current : (cached?.tenders ?? [])
      const next = [...baseTenders, analysis.tender]
      const nextViewMode = normalizeTenderViewMode(
        next.length >= 2 ? "compare" : (cached?.viewMode ?? viewModeRef.current),
        next.length
      )

      if (resolvedSessionId) {
        removePendingTenderAnalysis(resolvedSessionId)
        clearTenderBatchAnalysis(resolvedSessionId)
        sessionAbortControllersRef.current.delete(resolvedSessionId)
        updateCachedTenderSessionWorkspace(resolvedSessionId, {
          tenders: next,
          viewMode: nextViewMode,
          streamingStatus: "done",
          error: null,
        })
        void persistSessionSnapshot(next, {
          sessionId: resolvedSessionId,
          viewMode: nextViewMode,
          status: "completed",
        })
      }

      if (active) {
        tendersRef.current = next
        viewModeRef.current = nextViewMode
        if (resolvedSessionId && !activeSessionIdRef.current) {
          activeSessionIdRef.current = resolvedSessionId
          setActiveSessionId(resolvedSessionId)
        }
        setTenders(next)
        setViewMode(nextViewMode)
        if (analysis.confidence !== undefined) setConfidence(analysis.confidence)
        if (analysis.mockWarning) setMockWarning(analysis.mockWarning)
        setStreamingStatus("done")
        setAnalyzing(false)
      }
      return true
    } catch (err) {
      if (resolvedSessionId) {
        removePendingTenderAnalysis(resolvedSessionId)
        clearTenderBatchAnalysis(resolvedSessionId)
        sessionAbortControllersRef.current.delete(resolvedSessionId)
      }
      if (active) {
        setError(err instanceof Error ? err.message : "AI 未能識別結構化欄位，可手動新增或重試")
        setStreamingStatus("error")
        setAnalyzing(false)
      }
      return false
    }
  }

  async function consumeExtractionStream(
    response: Response,
    fileName: string,
    sessionId?: string | null
  ): Promise<ExtractionResult> {
    if (!response.ok) {
      if (await handleUnauthorizedResponse(response, refreshSession)) {
        throw new Error("Unauthorized")
      }
      const errData = await response.json().catch(() => ({})) as { error?: string; detail?: string }
      throw new Error(getApiErrorMessage(response, errData))
    }
    if (!response.body) throw new Error("Response body is not available")

    const appendTraceEvent = (trace: TraceEvent) => {
      if (!isActiveSession(sessionId)) return
      setTraceEvents((prev) => [
        ...prev,
        {
          ...trace,
          id: `${trace.id}-${fileName}-${prev.length}`,
        },
      ])
    }

    let result: ExtractionResult | null = null
    let streamError: string | null = null

    await readAgentSseStream(response, (event, data) => {
      const active = isActiveSession(sessionId)
      switch (event) {
        case "trace":
          if (data?.trace) appendTraceEvent(data.trace as TraceEvent)
          break
        case "thinking":
          if (data?.text && active) setThinkingText(data.text as string)
          break
        case "result": {
          if (data?.result) {
            result = data.result as ExtractionResult
            if (active && result.model === "mock-template") {
              setMockWarning("未連接大模型，目前為演示資料")
            }
          }
          if (data?.warning && active) {
            setMockWarning("未連接大模型，目前為演示資料")
          }
          break
        }
        case "error": {
          const code = data?.code as string | undefined
          streamError =
            code === "TEXT_EXTRACTION_FAILED"
              ? (data?.detail as string) || "無法從文件中讀取文字，請嘗試文字版 PDF 或 DOCX"
              : (data?.detail as string) || (data?.error as string) || "Unknown error"
          if (active) {
            setError(streamError)
            setStreamingStatus("error")
          }
          break
        }
      }
    })

    if (streamError) throw new Error(streamError)
    if (result) return result
    throw new Error("分析未完成，請重試")
  }

  async function analyzeOneTenderText(
    documentText: string,
    fileName: string,
    options?: { sessionId?: string | null; skipReset?: boolean }
  ): Promise<ExtractionResult> {
    const resolvedSessionId = options?.sessionId ?? activeSessionIdRef.current
    if (!options?.skipReset && isActiveSession(resolvedSessionId)) resetState()
    if (isActiveSession(resolvedSessionId)) {
      setAnalyzing(true)
      setStreamingStatus("connecting")
    }
    const controller = new AbortController()
    if (resolvedSessionId) {
      sessionAbortControllersRef.current.set(resolvedSessionId, controller)
    }
    try {
      if (isActiveSession(resolvedSessionId)) setStreamingStatus("thinking")
      const response = await fetch("/api/tender/agent?action=extract&stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentText,
          fileName,
          templateId: selectedTemplate || undefined,
          model,
          sessionId: resolvedSessionId || undefined,
        }),
        signal: controller.signal,
      })
      return await consumeExtractionStream(response, fileName, resolvedSessionId)
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err
      throw err
    }
  }

  async function analyzeOneTenderFile(
    file: File,
    options?: { skipReset?: boolean; sessionId?: string | null }
  ): Promise<ExtractionResult> {
    const resolvedSessionId = options?.sessionId ?? activeSessionIdRef.current
    if (!options?.skipReset && isActiveSession(resolvedSessionId)) resetState()
    if (isActiveSession(resolvedSessionId)) {
      setAnalyzing(true)
      setStreamingStatus("connecting")
    }
    const controller = new AbortController()
    if (resolvedSessionId) {
      sessionAbortControllersRef.current.set(resolvedSessionId, controller)
    }
    try {
      if (isActiveSession(resolvedSessionId)) setStreamingStatus("thinking")
      const formData = new FormData()
      formData.append("file", file)
      if (selectedTemplate) formData.append("templateId", selectedTemplate)
      formData.append("model", model)
      if (resolvedSessionId) formData.append("sessionId", resolvedSessionId)

      const response = await fetch("/api/tender/agent?action=extract&stream=1", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })
      return await consumeExtractionStream(response, file.name, resolvedSessionId)
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err
      throw err
    }
  }

  async function runExtraction(
    documentText: string,
    fileName: string,
    options?: { skipReset?: boolean; sessionId?: string | null }
  ) {
    const resolvedSessionId = options?.sessionId ?? activeSessionIdRef.current
    try {
      const result = await analyzeOneTenderText(documentText, fileName, options)
      return applyExtractionResult(result, fileName, resolvedSessionId)
    } catch (err) {
      if (isActiveSession(resolvedSessionId)) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setStreamingStatus("error")
        setAnalyzing(false)
      }
      if (resolvedSessionId) {
        removePendingTenderAnalysis(resolvedSessionId)
        clearTenderBatchAnalysis(resolvedSessionId)
        sessionAbortControllersRef.current.delete(resolvedSessionId)
      }
      return false
    }
  }

  async function extractFromFile(
    file: File,
    options?: { skipReset?: boolean; sessionId?: string | null }
  ) {
    const resolvedSessionId = options?.sessionId ?? activeSessionIdRef.current
    try {
      const result = await analyzeOneTenderFile(file, options)
      return applyExtractionResult(result, file.name, resolvedSessionId)
    } catch (err) {
      if (isActiveSession(resolvedSessionId)) {
        setError(err instanceof Error ? err.message : "Unknown error")
        setStreamingStatus("error")
        setAnalyzing(false)
      }
      if (resolvedSessionId) {
        removePendingTenderAnalysis(resolvedSessionId)
        clearTenderBatchAnalysis(resolvedSessionId)
        sessionAbortControllersRef.current.delete(resolvedSessionId)
      }
      return false
    }
  }

  async function extractEmailAttachmentText(attachmentId: string) {
    if (!emailSource) return
    const att = emailSource.attachments.find((a) => a.id === attachmentId)
    if (!att) return

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
    return {
      text: data.text,
      fileName: data.fileName || att.fileName,
    }
  }

  function buildBatchState(
    totalFiles: number,
    completedFiles: number,
    fileNames: string[],
    errors: TenderBatchError[]
  ): TenderBatchAnalysisState {
    return {
      totalFiles,
      completedFiles,
      failedFiles: errors.length,
      fileNames,
      errors,
    }
  }

  async function persistBatchProgress(
    sessionId: string,
    batchTenders: TenderItem[],
    fileNames: string[],
    errors: TenderBatchError[],
    status: "processing" | "completed" | "failed"
  ) {
    const batchState = buildBatchState(
      fileNames.length,
      batchTenders.length,
      fileNames,
      errors
    )
    setTenderBatchAnalysis(sessionId, batchState)

    const nextViewMode =
      status === "completed"
        ? normalizeTenderViewMode("compare", batchTenders.length)
        : "edit"
    updateCachedTenderSessionWorkspace(sessionId, {
      tenders: batchTenders,
      viewMode: nextViewMode,
      streamingStatus: status === "processing" ? "thinking" : status === "failed" ? "error" : "done",
      error: errors.length > 0 ? `${errors.length} document(s) failed to analyze.` : null,
    })

    if (isActiveSession(sessionId)) {
      tendersRef.current = batchTenders
      viewModeRef.current = nextViewMode
      setTenders(batchTenders)
      setViewMode(nextViewMode)
      setStreamingStatus(status === "processing" ? "thinking" : status === "failed" ? "error" : "done")
    }

    await persistSessionSnapshot(batchTenders, {
      sessionId,
      viewMode: nextViewMode,
      status,
      allowEmpty: true,
    })
  }

  function applyBatchFinalUiState(
    sessionId: string,
    batchTenders: TenderItem[],
    errors: TenderBatchError[]
  ) {
    if (!isActiveSession(sessionId)) return

    const nextViewMode = normalizeTenderViewMode("compare", batchTenders.length)
    tendersRef.current = batchTenders
    viewModeRef.current = nextViewMode
    setTenders(batchTenders)
    setViewMode(nextViewMode)
    setAnalyzing(false)

    if (batchTenders.length >= 2) {
      setStreamingStatus("done")
      setStatusBanner(
        errors.length > 0
          ? {
              tone: "error",
              message: `${batchTenders.length} document(s) analyzed, ${errors.length} failed.`,
            }
          : null
      )
    } else if (batchTenders.length === 1) {
      setStreamingStatus("done")
      setStatusBanner({
        tone: errors.length > 0 ? "error" : "success",
        message:
          errors.length > 0
            ? `Only 1 document analyzed successfully; ${errors.length} failed, so comparison is unavailable.`
            : "1 document analyzed successfully.",
      })
    } else {
      setError("No documents could be analyzed. Please upload text-based PDFs or DOCX files.")
      setStreamingStatus("error")
    }
  }

  async function runTenderBatch(params: {
    sessionId: string
    fileNames: string[]
    analyzeOne: (index: number) => Promise<{ fileName: string; result: ExtractionResult }>
  }) {
    const { sessionId, fileNames, analyzeOne } = params
    const batchTenders: TenderItem[] = []
    const errors: TenderBatchError[] = []

    setTenderBatchAnalysis(sessionId, buildBatchState(fileNames.length, 0, fileNames, errors))
    setAnalyzing(true)
    setStreamingStatus("thinking")
    registerPendingTenderAnalysis({
      sessionId,
      fileName: fileNames[0] || "Tender Analysis",
      startedAt: new Date().toISOString(),
    })
    window.dispatchEvent(new Event(TENDER_ANALYSIS_STARTED))
    await persistProcessingMarker(sessionId, fileNames)

    for (let i = 0; i < fileNames.length; i++) {
      const currentFileName = fileNames[i]
      if (isActiveSession(sessionId)) {
        setThinkingText(`Analyzing ${i + 1}/${fileNames.length}: ${currentFileName}`)
        setStreamingStatus("thinking")
      }

      try {
        const { fileName, result } = await analyzeOne(i)
        const analysis = buildTenderAnalysisResult(result, fileName)
        batchTenders.push(analysis.tender)
        if (analysis.confidence !== undefined && isActiveSession(sessionId)) {
          setConfidence(analysis.confidence)
        }
        if (analysis.mockWarning && isActiveSession(sessionId)) {
          setMockWarning(analysis.mockWarning)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        errors.push({ fileName: currentFileName, error: message })
        if (isActiveSession(sessionId)) {
          setStatusBanner({
            tone: "error",
            message: `${currentFileName}: ${message}`,
          })
        }
      }

      await persistBatchProgress(sessionId, batchTenders, fileNames, errors, "processing")
    }

    const finalStatus = batchTenders.length > 0 ? "completed" : "failed"
    await persistBatchProgress(sessionId, batchTenders, fileNames, errors, finalStatus)
    removePendingTenderAnalysis(sessionId)
    clearTenderBatchAnalysis(sessionId)
    sessionAbortControllersRef.current.delete(sessionId)

    applyBatchFinalUiState(sessionId, batchTenders, errors)
  }

  async function handleAnalyzeEmail() {
    if (!emailSource) return
    const selected = getSelectedAnalyzableAttachments(
      emailSource.attachments,
      selectedAttachmentIds
    )

    if (selected.length > 0) {
      resetForNewBatch()
      setLoadingEmailExtract(true)
      setError(null)
      let sessionId: string | null = null
      try {
        sessionId = await ensureSessionId(
          selected.length === 1
            ? selected[0].fileName
            : emailSource.subject || `Email (${selected.length} files)`
        )
        if (!sessionId) {
          setError("Failed to create tender session")
          setStreamingStatus("error")
          return
        }
        const fileNames = selected.map((a) => a.fileName)
        await runTenderBatch({
          sessionId,
          fileNames,
          analyzeOne: async (index) => {
            const attachment = selected[index]
            const extracted = await extractEmailAttachmentText(attachment.id)
            if (!extracted) throw new Error("Attachment not found")
            const result = await analyzeOneTenderText(extracted.text, extracted.fileName, {
              sessionId,
              skipReset: true,
            })
            return { fileName: extracted.fileName, result }
          },
        })
      } catch {
        // Error already surfaced by the batch runner.
      } finally {
        setLoadingEmailExtract(false)
        if (!sessionId || !isTenderBatchInProgress(sessionId)) {
          setAnalyzing(false)
        }
      }
      return
    }

    if (emailSource.body.trim()) {
      const sessionId = await ensureSessionId(emailSource.subject)
      if (sessionId) {
        const fileName = `${emailSource.subject || "email"}.txt`
        await runTenderBatch({
          sessionId,
          fileNames: [fileName],
          analyzeOne: async () => ({
            fileName,
            result: await analyzeOneTenderText(emailSource.body, fileName, {
              sessionId,
              skipReset: true,
            }),
          }),
        })
      }
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

  function clearUploadedFiles() {
    setPendingFiles([])
    setSelectedUploadFileIds(new Set())
    resetForNewBatch()
  }

  const buildCurrentSnapshot = useCallback((): TenderWorkspaceSnapshot => ({
    viewMode: viewModeRef.current,
    tenders: tendersRef.current,
    model,
    selectedTemplate,
    activeSessionId: activeSessionIdRef.current,
    error,
    streamingStatus: analyzingRef.current ? "thinking" : streamingStatus,
    confidence,
    pendingFiles,
    selectedUploadFileIds: Array.from(selectedUploadFileIds),
    showDiffsOnly,
    aiCompareResult,
    mockWarning,
    emailSource,
    selectedAttachmentIds: Array.from(selectedAttachmentIds),
  }), [
    model,
    selectedTemplate,
    error,
    streamingStatus,
    confidence,
    pendingFiles,
    selectedUploadFileIds,
    showDiffsOnly,
    aiCompareResult,
    mockWarning,
    emailSource,
    selectedAttachmentIds,
  ])

  const resetForNewAnalyze = useCallback(async () => {
    abortAllSessionExtractions()
    const previousSessionId = activeSessionIdRef.current
    if (previousSessionId) {
      const snapshot = buildCurrentSnapshot()
      cacheTenderSessionWorkspace(previousSessionId, snapshot)

      if (tendersRef.current.length > 0) {
        await persistSessionSnapshot(tendersRef.current, {
          sessionId: previousSessionId,
          status:
            analyzingRef.current || isTenderBatchInProgress(previousSessionId)
              ? "processing"
              : "completed",
        })
      } else if (
        analyzingRef.current ||
        isTenderBatchInProgress(previousSessionId)
      ) {
        const fileNames = pendingFiles
          .filter((f) => selectedUploadFileIds.has(f.id))
          .map((f) => f.file.name)
        if (fileNames.length > 0) {
          registerPendingTenderAnalysis({
            sessionId: previousSessionId,
            fileName: fileNames[0],
            startedAt: new Date().toISOString(),
          })
          window.dispatchEvent(new Event(TENDER_ANALYSIS_STARTED))
        }
      }
    }

    clearTenderWorkspace()
    activeSessionIdRef.current = null
    ensureSessionInFlightRef.current = null
    tendersRef.current = []
    viewModeRef.current = "edit"
    setViewMode("edit")
    setTenders([])
    setAnalyzing(false)
    setActiveSessionId(null)
    setModel(DEFAULT_MODELS.tender)
    setSelectedTemplate(null)
    setTraceEvents([])
    setThinkingText("")
    setError(null)
    setStreamingStatus("idle")
    setConfidence(null)
    setPendingFiles([])
    setSelectedUploadFileIds(new Set())
    setShowDiffsOnly(true)
    setAiCompareResult(null)
    setMockWarning(null)
    setEmailSource(null)
    setSelectedAttachmentIds(new Set())
    setStatusBanner(null)
  }, [persistSessionSnapshot, buildCurrentSnapshot, pendingFiles, selectedUploadFileIds])

  useEffect(() => {
    const handler = () => {
      void resetForNewAnalyze()
    }
    window.addEventListener(TENDER_NEW_ANALYZE_EVENT, handler)
    return () => window.removeEventListener(TENDER_NEW_ANALYZE_EVENT, handler)
  }, [resetForNewAnalyze])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const nextEntries = files.map((file) => ({
      id: buildUploadFileId(file),
      file,
    }))

    const uniqueAdded = nextEntries.filter(
      (entry, idx, arr) => arr.findIndex((a) => a.id === entry.id) === idx
    )

    if (uniqueAdded.length === 0) return

    resetForNewBatch()
    setPendingFiles((prev) => {
      const existingIds = new Set(prev.map((p) => p.id))
      const merged = [...prev]
      for (const entry of uniqueAdded) {
        if (!existingIds.has(entry.id)) merged.push(entry)
      }
      return merged
    })
    setSelectedUploadFileIds((prev) => {
      const next = new Set(prev)
      for (const entry of uniqueAdded) next.add(entry.id)
      return next
    })
    await ensureSessionId(
      uniqueAdded.length === 1
        ? uniqueAdded[0].file.name
        : `Batch (${uniqueAdded.length} files)`
    )
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleAnalyzeSelectedUploadFiles() {
    const selectedFiles = pendingFiles.filter((f) => selectedUploadFileIds.has(f.id))
    if (selectedFiles.length === 0) {
      setError("Select at least one uploaded document to analyze")
      setStreamingStatus("error")
      return
    }

    resetForNewBatch()
    setError(null)
    const sessionId = await ensureSessionId(
      selectedFiles.length === 1
        ? selectedFiles[0].file.name
        : `Batch (${selectedFiles.length} files)`
    )
    if (!sessionId) {
      setError("Failed to create tender session")
      setStreamingStatus("error")
      return
    }

    const fileNames = selectedFiles.map((f) => f.file.name)
    await runTenderBatch({
      sessionId,
      fileNames,
      analyzeOne: async (index) => ({
        fileName: selectedFiles[index].file.name,
        result: await analyzeOneTenderFile(selectedFiles[index].file, {
          skipReset: true,
          sessionId,
        }),
      }),
    })
  }

  async function handleAnalyzeSingleUploadFile() {
    if (pendingFiles.length !== 1) return
    const file = pendingFiles[0].file
    resetForNewBatch()
    setError(null)
    const sessionId = await ensureSessionId(file.name)
    if (!sessionId) {
      setError("Failed to create tender session")
      setStreamingStatus("error")
      return
    }
    await runTenderBatch({
      sessionId,
      fileNames: [file.name],
      analyzeOne: async () => ({
        fileName: file.name,
        result: await analyzeOneTenderFile(file, {
          skipReset: true,
          sessionId,
        }),
      }),
    })
  }

  function addField(ti: number, defaultFieldLabel?: string) {
    setTenders(tenders.map((t, i) => i === ti ? { ...t, fields: [...t.fields, { field: defaultFieldLabel ?? "", value: "" }] } : t))
  }
  function updateField(ti: number, fi: number, update: Partial<TenderField>) {
    setTenders(tenders.map((t, i) => i === ti ? { ...t, fields: t.fields.map((f, j) => j === fi ? { ...f, ...update } : f) } : t))
  }
  function deleteField(ti: number, fi: number) {
    setTenders(tenders.map((t, i) => i === ti ? { ...t, fields: t.fields.filter((_, j) => j !== fi) } : t))
  }
  function removeTender(ti: number) { setTenders(tenders.filter((_, i) => i !== ti)) }

  const diffCount = comparisonResult?.comparisonFields.filter((f) => !f.match).length ?? 0
  const matchCount = comparisonResult
    ? comparisonResult.comparisonFields.length - diffCount
    : 0

  function exportTenders() {
    const rows = tenders.flatMap((t) => t.fields.map((f) => ({ field: `${t.name} - ${f.field}`, value: f.value })))
    fetch("/api/report/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, format: "xlsx" }) })
      .then((r) => r.blob())
      .then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `tender-export-${Date.now()}.xlsx`; a.click(); URL.revokeObjectURL(url) })
      .catch(console.error)
  }

  function exportComparison() {
    if (!comparisonResult) return
    fetch("/api/tender/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comparisonResult,
        showDiffsOnly,
        diffCount,
        matchCount,
      }),
    })
      .then(async (r) => {
        if (await handleUnauthorizedResponse(r, refreshSession)) return null
        if (!r.ok) throw new Error("Export failed")
        return r.blob()
      })
      .then((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `tender-comparison-${Date.now()}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(console.error)
  }

  async function exportEditedPdfs() {
    const tendersWithFields = tenders.filter((t) => t.fields.length > 0)
    if (tendersWithFields.length === 0) return

    setExportingPdf(true)
    setStatusBanner(null)
    try {
      for (let i = 0; i < tendersWithFields.length; i++) {
        const tender = tendersWithFields[i]
        const res = await fetch("/api/tender/export-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tender.name,
            fileName: tender.fileName,
            fields: tender.fields,
          }),
        })
        if (await handleUnauthorizedResponse(res, refreshSession)) return
        if (!res.ok) throw new Error("PDF export failed")

        const blob = await res.blob()
        const disposition = res.headers.get("Content-Disposition")
        const filenameMatch = disposition?.match(/filename="([^"]+)"/)
        const downloadName = filenameMatch?.[1] || `tender-edited-${Date.now()}.pdf`

        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = downloadName
        a.click()
        URL.revokeObjectURL(url)

        if (i < tendersWithFields.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
    } catch (err) {
      setStatusBanner({
        tone: "error",
        message: err instanceof Error ? err.message : "PDF export failed",
      })
    } finally {
      setExportingPdf(false)
    }
  }

  useTenderWorkspaceSync({
    viewMode,
    tenders,
    model,
    selectedTemplate,
    activeSessionId,
    error,
    streamingStatus,
    confidence,
    pendingFiles,
    selectedUploadFileIds: Array.from(selectedUploadFileIds),
    showDiffsOnly,
    aiCompareResult,
    mockWarning,
    emailSource,
    selectedAttachmentIds: Array.from(selectedAttachmentIds),
  })

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
          {activeSessionId && (
            <Link
              href={`/tender/${activeSessionId}`}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              View session
            </Link>
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
                <Pencil className="h-4 w-4" />
                Edit Fields
              </button>
              <button
                onClick={() => setKbImportOpen(true)}
                disabled={!comparisonResult}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                <BookOpen className="h-4 w-4" />
                Save to Knowledge Base
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
                disabled={exportingPdf || !hasEditableFields}
                onClick={exportEditedPdfs}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {exportingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Export PDF
              </button>
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

      {mockWarning && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {mockWarning === "AI unavailable, using demo data"
            ? "未連接大模型，目前為演示資料。請確認 combine-ai-platform/.env 中的 DASHSCOPE_API_KEY 並重啟 dev server。"
            : mockWarning}
        </div>
      )}

      {statusBanner && (
        <div
          className={cn(
            "border-b px-6 py-2 text-sm",
            statusBanner.tone === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          )}
        >
          {statusBanner.message}
        </div>
      )}

      <TenderKbImportDialog
        open={kbImportOpen}
        onClose={() => setKbImportOpen(false)}
        defaultTitle={defaultComparisonKbTitle()}
        text={comparisonKbText}
        onSuccess={(message) => setStatusBanner({ tone: "success", message })}
        onError={(message) => setStatusBanner({ tone: "error", message })}
      />

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

          {!fromEmailId && (
          <AgentUploadPanel
            accept=".pdf,.docx,.doc,.txt"
            disabled={analyzing}
            fileInputRef={fileInputRef}
            onFileChange={handleFileUpload}
            hasFiles={pendingFiles.length > 0}
            emptyDescription="PDF, DOCX, DOC, or TXT — pick one or more to analyze"
            onAddMore={() => fileInputRef.current?.click()}
            onClearAll={clearUploadedFiles}
            summarySlot={
              pendingFiles.length > 0 ? (
                <div className="flex h-32 flex-col items-center justify-center rounded-lg bg-muted">
                  <FileText className="h-10 w-10 text-muted-foreground/50" />
                  <span className="mt-2 text-sm text-muted-foreground">
                    {pendingFiles[0].file.name}
                  </span>
                  {pendingFiles.length > 1 ? (
                    <span className="mt-1 text-xs text-muted-foreground/70">
                      +{pendingFiles.length - 1} more in queue
                    </span>
                  ) : null}
                </div>
              ) : null
            }
          >
            <AgentUploadQueue
              pendingFiles={pendingFiles}
              selectedFileIds={selectedUploadFileIds}
              extracting={analyzing}
              onToggleFile={toggleUploadFileSelection}
              onSelectAll={selectAllUploadFiles}
              onClearSelection={clearUploadFileSelection}
              onRemoveSelected={removeSelectedUploadFiles}
              onRemoveFile={removeUploadFile}
              onAnalyzeSelected={handleAnalyzeSelectedUploadFiles}
              onAnalyzeSingle={handleAnalyzeSingleUploadFile}
              className="mt-0 text-left"
            />
          </AgentUploadPanel>
          )}

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
          {viewMode === "compare" && tenders.length >= 2 && comparisonResult ? (
            <TenderComparisonPanel
              comparisonResult={comparisonResult}
              tenderNames={tenders.map((t) => t.fileName || t.name)}
              showDiffsOnly={showDiffsOnly}
              onShowDiffsOnlyChange={setShowDiffsOnly}
              diffCount={diffCount}
              matchCount={matchCount}
              aiCompareResult={aiCompareResult}
              loadingAiCompare={loadingAiCompare}
              onEditFields={() => setViewMode("edit")}
              onSaveToKb={() => setKbImportOpen(true)}
            />
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
                <TenderStructuredFields
                  key={tender.id}
                  tender={tender}
                  tenderIndex={ti}
                  onAddField={addField}
                  onUpdateField={updateField}
                  onDeleteField={deleteField}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
