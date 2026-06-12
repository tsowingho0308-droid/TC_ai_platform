"use client"

import { useState, useRef, useEffect, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Upload,
  Receipt,
  Loader2,
  Download,
  Mail,
  ArrowLeft,
  Shield,
  GitCompare,
  AlertTriangle,
  CheckCircle,
  FolderSync,
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
import { getPolicyExportBlockers } from "@/features/finance/policy-export"
import {
  groupExtractedRows,
  normalizeExtractedRows,
} from "@/features/finance/extracted-rows"
import {
  GroupedExtractedFields,
  getExtractedSummary,
} from "@/features/finance/components/grouped-extracted-fields"
import { getActiveFinanceSessionId } from "@/features/finance/finance-analysis-tracker"
import { useFinanceAnalysisSync } from "@/features/finance/hooks/use-finance-analysis-sync"
import { runFinanceBackgroundExtract } from "@/features/finance/run-finance-extract"
import { FINANCE_NO_RECEIPT_MESSAGE, isFinanceNoReceiptError } from "@/features/finance/extraction-messages"
import {
  FinanceUploadQueue,
  buildFinanceUploadId,
  fileToDataUrl,
  type PendingFinanceUpload,
} from "@/features/finance/components/finance-upload-queue"

interface TableRow {
  field: string
  value: string
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

interface PolicyResult {
  rule: string
  passed: boolean
  detail: string
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function FinancePage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
      <FinancePageContent />
    </Suspense>
  )
}

function FinancePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromEmailId = searchParams.get("fromEmail")
  const emailSubjectParam = searchParams.get("emailSubject")
  const attachmentIdParam = searchParams.get("attachmentId")
  const attachmentIdsParam = searchParams.get("attachmentIds")

  const [model, setModel] = useState(DEFAULT_MODELS.finance)
  const [loadingEmailExtract, setLoadingEmailExtract] = useState(false)
  const [loadingExtract, setLoadingExtract] = useState(false)
  const [checkingPolicy, setCheckingPolicy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingFinanceUpload[]>([])
  const [selectedUploadFileIds, setSelectedUploadFileIds] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<TableRow[]>([])
  const [policyResults, setPolicyResults] = useState<PolicyResult[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailSource, setEmailSource] = useState<EmailSource | null>(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { isAnalyzing } = useFinanceAnalysisSync({
    sessionId,
    onSessionId: setSessionId,
    onRows: setRows,
    onPolicyReset: () => setPolicyResults([]),
    onError: setError,
  })

  useEffect(() => {
    const activeSessionId = getActiveFinanceSessionId()
    if (activeSessionId && !sessionId) {
      setSessionId(activeSessionId)
    }
  }, [sessionId])

  const extracting = isAnalyzing(sessionId) || loadingExtract

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

  async function ensureFinanceSession(title: string, options?: { forceNew?: boolean }) {
    if (sessionId && !options?.forceNew) {
      const checkRes = await fetch(`/api/finance/sessions?id=${encodeURIComponent(sessionId)}`)
      if (checkRes.ok) return sessionId
      setSessionId(null)
      setRows([])
      setPolicyResults([])
    }

    const sessionRes = await fetch("/api/finance/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, sessionType: "EXPENSE_REVIEW" }),
    })
    if (!sessionRes.ok) throw new Error("Failed to create finance session")
    const { session } = await sessionRes.json()
    setSessionId(session.id)
    window.dispatchEvent(new Event("finance:sessions-updated"))
    return session.id as string
  }

  async function extractFromBase64(params: {
    activeSessionId: string
    fileBase64: string
    fileName: string
    appendRows: boolean
    sourceLabel?: string
  }) {
    const result = await runFinanceBackgroundExtract({
      sessionId: params.activeSessionId,
      fileBase64: params.fileBase64,
      fileName: params.fileName,
      appendRows: params.appendRows,
      sourceLabel: params.sourceLabel,
      model,
    })
    setRows(result.rows)
    setPolicyResults([])
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const nextEntries = files.map((file) => ({
      id: buildFinanceUploadId(file),
      file,
    }))

    setPendingFiles((prev) => {
      const existingIds = new Set(prev.map((entry) => entry.id))
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
    setError(null)

    if (fileInputRef.current) fileInputRef.current.value = ""
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
    setSelectedUploadFileIds(new Set(pendingFiles.map((entry) => entry.id)))
  }

  function clearUploadFileSelection() {
    setSelectedUploadFileIds(new Set())
  }

  function removeUploadFile(fileId: string) {
    setPendingFiles((prev) => prev.filter((entry) => entry.id !== fileId))
    setSelectedUploadFileIds((prev) => {
      const next = new Set(prev)
      next.delete(fileId)
      return next
    })
  }

  function removeSelectedUploadFiles() {
    setPendingFiles((prev) => prev.filter((entry) => !selectedUploadFileIds.has(entry.id)))
    setSelectedUploadFileIds(new Set())
  }

  function previewUploadFile(fileId: string) {
    const entry = pendingFiles.find((item) => item.id === fileId)
    if (!entry) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(entry.file))
    setPreviewFile(entry.file)
  }

  async function analyzeSelectedUploadFiles(selected: PendingFinanceUpload[]) {
    if (selected.length === 0) {
      setError("Select at least one file to analyze")
      return
    }

    setLoadingExtract(true)
    setError(null)

    try {
      const hasExistingRows = rows.length > 0
      let activeSessionId = sessionId

      if (!hasExistingRows) {
        activeSessionId = await ensureFinanceSession(
          selected.length === 1 ? selected[0].file.name : `Expense review (${selected.length} files)`,
          { forceNew: true }
        )
        setSessionId(activeSessionId)
        setRows([])
        setPolicyResults([])
      } else {
        activeSessionId = await ensureFinanceSession(selected[0].file.name)
      }

      if (!activeSessionId) throw new Error("Failed to prepare finance session")

      for (let i = 0; i < selected.length; i++) {
        const entry = selected[i]
        const appendRows = hasExistingRows || i > 0

        if (i === 0) {
          previewUploadFile(entry.id)
        }

        const fileBase64 = await fileToDataUrl(entry.file)
        await extractFromBase64({
          activeSessionId,
          fileBase64,
          fileName: entry.file.name,
          appendRows,
          sourceLabel: undefined,
        })
      }

      setPendingFiles((prev) => prev.filter((entry) => !selected.some((item) => item.id === entry.id)))
      setSelectedUploadFileIds(new Set())
    } catch (err) {
      if (!isFinanceNoReceiptError(err)) {
        console.error("Extraction error:", err)
      }
      setError(err instanceof Error ? err.message : "Extraction failed")
    } finally {
      setLoadingExtract(false)
    }
  }

  async function handleAnalyzeSelectedUploads() {
    const selected = pendingFiles.filter((entry) => selectedUploadFileIds.has(entry.id))
    await analyzeSelectedUploadFiles(selected)
  }

  async function handleAnalyzeSingleUpload() {
    if (pendingFiles.length !== 1) return
    await analyzeSelectedUploadFiles(pendingFiles)
  }

  async function loadEmailAttachmentAndExtract(attachmentId: string, options?: { skipPreviewReset?: boolean }) {
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
    const fileBase64 = await blobToDataUrl(blob)

    if (!options?.skipPreviewReset) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(new Blob([blob], { type: mimeType })))
    }

    const activeSessionId = await ensureFinanceSession(emailSource.subject || "Email expense review")
    setSessionId(activeSessionId)
    await extractFromBase64({
      activeSessionId,
      fileBase64,
      fileName: att.fileName,
      appendRows: Boolean(options?.skipPreviewReset),
      sourceLabel: att.fileName,
    })
  }

  async function handleAnalyzeEmail() {
    if (!emailSource) return
    const selected = getSelectedAnalyzableAttachments(
      emailSource.attachments,
      selectedAttachmentIds,
      { includeImages: true }
    )

    if (selected.length === 0) {
      setError("Select at least one receipt, invoice, or PDF attachment to analyze")
      return
    }

    setLoadingEmailExtract(true)
    setError(null)
    setRows([])
    try {
      for (let i = 0; i < selected.length; i++) {
        await loadEmailAttachmentAndExtract(selected[i].id, { skipPreviewReset: i > 0 })
        if (i < selected.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    } catch (err) {
      console.error("Email attachment extract error:", err)
      setError(err instanceof Error ? err.message : "Failed to analyze email attachment")
    } finally {
      setLoadingEmailExtract(false)
    }
  }

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
      new Set(
        emailSource.attachments
          .filter((att) => isAnalyzableEmailAttachment(att, { includeImages: true }))
          .map((att) => att.id)
      )
    )
  }

  function clearAttachmentSelection() {
    setSelectedAttachmentIds(new Set())
  }

  async function handleCheckPolicy() {
    if (!sessionId || rows.length === 0) return
    setCheckingPolicy(true)
    setError(null)
    try {
      const res = await fetch("/api/finance/agent?action=check-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) throw new Error("Policy check failed")
      const data = await res.json()
      setPolicyResults(data.policyResults || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Policy check failed")
    } finally {
      setCheckingPolicy(false)
    }
  }

  function handleExport() {
    if (!sessionId) return

    const blockers = getPolicyExportBlockers(policyResults)
    if (blockers.length > 0) {
      setError(blockers.join(" "))
      return
    }

    router.push(`/finance/expense-review/${sessionId}/export`)
  }

  async function createThreeWayMatchSession() {
    try {
      const sessionRes = await fetch("/api/finance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `3-Way Match ${new Date().toLocaleDateString()}`,
          sessionType: "THREE_WAY_MATCH",
        }),
      })
      if (!sessionRes.ok) throw new Error("Failed to create 3-way match session")
      const { session } = await sessionRes.json()
      window.dispatchEvent(new Event("finance:sessions-updated"))
      router.push(`/finance/three-way-match/${session.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create 3-way match session")
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

  const canAnalyzeEmail = Boolean(emailSource && selectedAnalyzableAttachments.length > 0)
  const failedPolicyCount = policyResults.filter((p) => !p.passed).length
  const passedPolicyCount = policyResults.length - failedPolicyCount

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Finance Agent</h1>
          <p className="text-xs text-muted-foreground">
            Receipt OCR, policy compliance, 3-way match &amp; exception reporting
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector value={model} onChange={setModel} />
          <Link
            href="/finance"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Expense Review
          </Link>
          <button
            type="button"
            onClick={createThreeWayMatchSession}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <GitCompare className="h-4 w-4" />
            3-Way Match
          </button>
          {sessionId && (
            <Link
              href={`/finance/expense-review/${sessionId}`}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Open Full Review
            </Link>
          )}
          <Link
            href="/finance/policies"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Expense Policies
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 overflow-y-auto border-r p-6">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">Expense Review</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Extract vendor, tax, total, currency and line-item fields from receipts or invoices.
              </p>
            </div>
            <button
              type="button"
              onClick={createThreeWayMatchSession}
              className="rounded-lg border bg-card p-3 text-left hover:bg-accent"
            >
              <div className="mb-2 flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">3-Way Match</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Compare PO, GRN and supplier invoice to find quantity and price discrepancies.
              </p>
            </button>
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <FolderSync className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">Auto Filing</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Finance/Pending_Invoices watcher is represented here as the intake workflow.
              </p>
            </div>
          </div>

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
                    Email forwarded — select attachments and click Analyze to extract expense data.
                  </p>
                  <button
                    onClick={handleAnalyzeEmail}
                    disabled={!canAnalyzeEmail || extracting || loadingEmailExtract}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {loadingEmailExtract || extracting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Receipt className="h-4 w-4" />
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
                          </div>
                        )
                      })}
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
              "hover:border-primary/50 hover:bg-accent/50 cursor-pointer"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="space-y-3">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                {pendingFiles.length > 0 ? "Add More Files" : "Upload Receipt or Invoice"}
              </p>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, PDF, DOC, or DOCX — upload one or more files, select them, then click Analyze
              </p>
            </div>
          </div>

          {previewUrl && previewFile?.type.startsWith("image/") && (
            <div className="mt-4 rounded-lg border bg-card p-3">
              <img src={previewUrl} alt="Document preview" className="mx-auto max-h-48 rounded-lg object-contain" />
            </div>
          )}

          {previewFile && !previewFile.type.startsWith("image/") && (
            <div className="mt-4 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Document ready for analysis
            </div>
          )}

          <FinanceUploadQueue
            pendingFiles={pendingFiles}
            selectedFileIds={selectedUploadFileIds}
            analyzing={extracting}
            onToggleFile={toggleUploadFileSelection}
            onSelectAll={selectAllUploadFiles}
            onClearSelection={clearUploadFileSelection}
            onRemoveSelected={removeSelectedUploadFiles}
            onRemoveFile={removeUploadFile}
            onPreviewFile={previewUploadFile}
            onAnalyzeSelected={handleAnalyzeSelectedUploads}
            onAnalyzeSingle={handleAnalyzeSingleUpload}
          />

          {(extracting || loadingEmailExtract) && (
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI is analyzing the document...
              </div>
              <p className="text-xs">
                Scanned PDFs with multiple receipts may take up to 1 minute. You can switch to another agent — analysis continues in the background.
              </p>
            </div>
          )}

          {error && (
            error === FINANCE_NO_RECEIPT_MESSAGE ? (
              <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="font-medium">No receipt detected</p>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{error}</p>
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )
          )}
        </div>

        <div className="w-1/2 overflow-y-auto p-6">
          {rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Receipt className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Expense Review</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Upload receipts or invoices, select the files you want, then click Analyze. You can also forward
                attachments from Email Agent.
              </p>
              <div className="mt-6 grid w-full max-w-lg gap-3 text-left sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium">Policy Compliance</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Checks extracted data against configured company policies.
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium">Exception Report</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Exports extracted fields and failed policy checks as CSV for audit.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Extracted Data ({getExtractedSummary(rows)})</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCheckPolicy}
                    disabled={checkingPolicy || !sessionId}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Shield className="h-3 w-3" />
                    {checkingPolicy ? "Checking..." : "Check Policy"}
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={!sessionId}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Download className="h-3 w-3" />
                    Export XLSX
                  </button>
                  {sessionId && (
                    <Link
                      href={`/finance/expense-review/${sessionId}`}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      <Download className="h-3 w-3" />
                      Full Review
                    </Link>
                  )}
                </div>
              </div>
              {policyResults.length > 0 && (
                <div className="mb-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {failedPolicyCount > 0 ? (
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      ) : (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      )}
                      <p className="text-sm font-semibold">Policy Check Results</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                        {passedPolicyCount} passed
                      </span>
                      {failedPolicyCount > 0 && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                          {failedPolicyCount} failed
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {policyResults.map((policy, index) => (
                      <div
                        key={`${policy.rule}-${index}`}
                        className={cn(
                          "rounded-md border px-3 py-2 text-xs",
                          policy.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                        )}
                      >
                        <div className="font-medium">{policy.rule}</div>
                        <div className="mt-1 text-muted-foreground">{policy.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <GroupedExtractedFields rows={rows} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
