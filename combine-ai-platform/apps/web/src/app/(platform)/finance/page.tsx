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
import { normalizeExtractedRows } from "@/features/finance/extracted-rows"

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
  const [extracting, setExtracting] = useState(false)
  const [loadingEmailExtract, setLoadingEmailExtract] = useState(false)
  const [checkingPolicy, setCheckingPolicy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [rows, setRows] = useState<TableRow[]>([])
  const [policyResults, setPolicyResults] = useState<PolicyResult[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailSource, setEmailSource] = useState<EmailSource | null>(null)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  async function ensureFinanceSession(title: string) {
    if (sessionId) return sessionId
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
    const extractRes = await fetch("/api/finance/agent?action=extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: params.activeSessionId,
        fileBase64: params.fileBase64,
        fileName: params.fileName,
        appendRows: params.appendRows,
        sourceLabel: params.sourceLabel,
        model,
      }),
    })
    if (!extractRes.ok) {
      const errData = await extractRes.json().catch(() => ({})) as { error?: string; detail?: string }
      throw new Error(errData.detail || errData.error || "Extraction failed")
    }
    const data = await extractRes.json()
    setRows(normalizeExtractedRows(data.sessionRows || data.rows))
    setPolicyResults([])
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setExtracting(true)
    setError(null)

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result as string
        const activeSessionId = await ensureFinanceSession(file.name)
        await extractFromBase64({
          activeSessionId,
          fileBase64: base64,
          fileName: file.name,
          appendRows: false,
          sourceLabel: file.name,
        })
      } catch (err) {
        console.error("Extraction error:", err)
        setError(err instanceof Error ? err.message : "Extraction failed")
      } finally {
        setExtracting(false)
      }
    }
    reader.readAsDataURL(file)
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
              "hover:border-primary/50 hover:bg-accent/50 cursor-pointer",
              previewUrl ? "border-solid" : ""
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileUpload}
              className="hidden"
            />
            {previewUrl ? (
              <div className="space-y-4">
                <img src={previewUrl} alt="Receipt preview" className="mx-auto max-h-48 rounded-lg object-contain" />
                <p className="text-sm text-muted-foreground">Click to change file</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-medium">Upload Receipt or Invoice</p>
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, or PDF — AI will extract all fields automatically
                </p>
              </div>
            )}
          </div>

          {(extracting || loadingEmailExtract) && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI is analyzing the document...
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="w-1/2 p-6">
          {rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Receipt className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Expense Review</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Upload a receipt or invoice, or forward from Email Agent to automatically extract vendor details,
                amounts, tax info, and line items.
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
                <h2 className="text-sm font-semibold">Extracted Data ({rows.length} fields)</h2>
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
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                  <span className="min-w-[120px] text-sm font-medium">{row.field}</span>
                  <span className="flex-1 text-sm">{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
