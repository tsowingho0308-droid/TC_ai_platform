"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Upload, Loader2, Download, CheckCircle, XCircle,
  AlertTriangle, Shield, RefreshCw, Trash2, Plus, Pencil,
  Receipt, ArrowLeft
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { toast } from "sonner"
import { getPolicyExportBlockers } from "@/features/finance/policy-export"
import {
  groupExtractedRows,
  normalizeExtractedRows,
  getFinanceDocumentDisplayName,
  type ExtractedRow,
} from "@/features/finance/extracted-rows"
import { getExtractedSummary } from "@/features/finance/components/grouped-extracted-fields"
import { setActiveFinanceSessionId } from "@/features/finance/finance-analysis-tracker"
import { useFinanceAnalysisSync } from "@/features/finance/hooks/use-finance-analysis-sync"
import { runFinanceBackgroundExtract } from "@/features/finance/run-finance-extract"
import { FINANCE_NO_RECEIPT_MESSAGE } from "@/features/finance/extraction-messages"

interface PolicyResult {
  rule: string
  passed: boolean
  detail: string
}

interface FinanceSession {
  id: string
  title: string
  sessionType: string
  status: string
  extractedRows: ExtractedRow[] | null
  policyResults: PolicyResult[] | null
  draftNote: string | null
  documents: Array<{ id: string; docType: string; fileName: string; extractedData?: unknown }>
  turns: Array<{ id: string; role: string; content: string; assistantReply: string | null }>
}

export default function ExpenseReviewPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [session, setSession] = useState<FinanceSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkingPolicy, setCheckingPolicy] = useState(false)
  const [rows, setRows] = useState<ExtractedRow[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [newFieldName, setNewFieldName] = useState("")
  const [newFieldValue, setNewFieldValue] = useState("")
  const [showAddRow, setShowAddRow] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/finance/sessions?id=${id}`)
      if (!res.ok) throw new Error("Session not found")
      const data = await res.json()
      const financeSession = data.session as FinanceSession

      if (financeSession.sessionType === "THREE_WAY_MATCH") {
        router.replace(`/finance/three-way-match/${id}`)
        return
      }

      setSession(financeSession)
      setRows(normalizeExtractedRows(financeSession.extractedRows))
    } catch {
      toast.error("Failed to load session")
      router.push("/finance")
    } finally {
      setLoading(false)
    }
  }, [id, router])

  const saveRows = useCallback(async (updatedRows: ExtractedRow[]) => {
    try {
      await fetch(`/api/finance/sessions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, extractedRows: updatedRows }),
      })
    } catch {
      toast.error("Failed to save changes")
    }
  }, [id])

  const { isAnalyzing } = useFinanceAnalysisSync({
    sessionId: id,
    onRows: (updatedRows) => {
      setRows(updatedRows)
      void saveRows(updatedRows)
      void fetchSession()
    },
    onError: (message) => {
      if (!message) return
      if (message === FINANCE_NO_RECEIPT_MESSAGE) {
        toast.warning(message)
      } else {
        toast.error(message)
      }
    },
  })

  useEffect(() => {
    setActiveFinanceSessionId(id)
  }, [id])

  useEffect(() => {
    void fetchSession()
  }, [fetchSession])

  const extracting = isAnalyzing(id) || session?.status === "analyzing"

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const shouldAppend =
      rows.length > 0 || (session?.documents?.length ?? 0) > 0

    const reader = new FileReader()
    reader.onload = () => {
      void (async () => {
        try {
          const base64 = reader.result as string
          const result = await runFinanceBackgroundExtract({
            sessionId: id,
            fileBase64: base64,
            fileName: file.name,
            appendRows: shouldAppend,
            sourceLabel: undefined,
          })
          setRows(result.rows)
          await saveRows(result.rows)
          const newFieldCount = result.raw.rows?.length || 0
          toast.success(
            shouldAppend
              ? `Added ${newFieldCount} fields from ${file.name} (receipts continue from previous uploads)`
              : `Extracted ${newFieldCount} fields`
          )
          await fetchSession()
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error"
          if (message === FINANCE_NO_RECEIPT_MESSAGE) {
            toast.warning(message)
          } else {
            toast.error(`Extraction failed: ${message}`)
          }
        }
      })()
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [id, rows.length, saveRows, fetchSession, session?.documents?.length])

  const handleCheckPolicy = useCallback(async () => {
    setCheckingPolicy(true)
    try {
      const res = await fetch("/api/finance/agent?action=check-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      })
      if (!res.ok) throw new Error("Policy check failed")
      const data = await res.json()
      toast.success(`Checked ${data.policyResults?.length || 0} policies`)
      fetchSession()
    } catch (err) {
      toast.error(`Policy check failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setCheckingPolicy(false)
    }
  }, [id, fetchSession])

  const handleUpdateRow = useCallback((index: number, field: string, value: string) => {
    const updated = rows.map((r, i) => i === index ? { field, value } : r)
    setRows(updated)
  }, [rows])

  const handleDeleteRow = useCallback((index: number) => {
    const updated = rows.filter((_, i) => i !== index)
    setRows(updated)
    saveRows(updated)
    toast.success("Row removed")
  }, [rows, saveRows])

  const handleAddRow = useCallback(() => {
    if (!newFieldName.trim() || !newFieldValue.trim()) return
    const updated = [...rows, { field: newFieldName.trim(), value: newFieldValue.trim() }]
    setRows(updated)
    saveRows(updated)
    setNewFieldName("")
    setNewFieldValue("")
    setShowAddRow(false)
    toast.success("Row added")
  }, [rows, newFieldName, newFieldValue, saveRows])

  const handleBlurRowEdit = useCallback(() => {
    setEditingIndex(null)
    saveRows(rows)
  }, [rows, saveRows])

  const policyResults = (session?.policyResults as PolicyResult[]) || []
  const passedCount = policyResults.filter((p: PolicyResult) => p.passed).length
  const failedCount = policyResults.filter((p: PolicyResult) => !p.passed).length

  const handleExport = useCallback(() => {
    const blockers = getPolicyExportBlockers(policyResults)
    if (blockers.length > 0) {
      toast.error(blockers.join(" "))
      return
    }

    router.push(`/finance/expense-review/${id}/export`)
  }, [id, policyResults, router])

  const rowGroups = groupExtractedRows(rows)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/finance")} className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{session?.title || "Expense Review"}</h1>
            <p className="text-xs text-muted-foreground">Receipt OCR · Policy Check · Export</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCheckPolicy}
            disabled={checkingPolicy || rows.length === 0}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            <Shield className="h-4 w-4" />
            {checkingPolicy ? "Checking..." : "Check Policy"}
          </button>
          <button
            onClick={handleExport}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export XLSX
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Upload & Preview */}
        <div className="flex w-1/3 min-h-0 flex-col border-r">
          <div className="flex-shrink-0 border-b p-4">
            <h2 className="text-sm font-semibold mb-3">Upload Document</h2>
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
                accept="image/*,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileUpload}
                className="hidden"
                disabled={extracting}
              />
              {extracting ? (
                <div className="space-y-2">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm font-medium">Analyzing document...</p>
                  <p className="text-xs text-muted-foreground">
                    AI is extracting fields. You can switch pages — analysis continues in the background.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {session?.documents?.length ? "Upload Another Document" : "Upload Receipt or Invoice"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session?.documents?.length
                      ? "New receipts are added to the list above (Receipt 1, 2, 3… continues numbering)."
                      : "PNG, JPEG, PDF, DOC, or DOCX - AI extracts automatically"}
                  </p>
                </div>
              )}
            </div>

            {session?.documents && session.documents.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Uploaded Files</p>
                {session.documents.map((doc, docIndex) => (
                  <div key={doc.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate" title={doc.fileName}>
                      {getFinanceDocumentDisplayName(doc)}
                    </span>
                    <span className="text-xs text-muted-foreground">{doc.docType}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Policy Results Summary */}
          {policyResults.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mb-3 flex flex-shrink-0 items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Shield className="h-4 w-4" />
                  Policy Check Results
                </h2>
                <span className="text-xs text-muted-foreground">
                  {policyResults.length} policies
                </span>
              </div>
              <div className="mb-3 flex flex-shrink-0 gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  <CheckCircle className="h-3 w-3" /> {passedCount} passed
                </span>
                {failedCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    <XCircle className="h-3 w-3" /> {failedCount} failed
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {policyResults.map((p: PolicyResult, i: number) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border p-3",
                      p.passed ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {p.passed ? (
                        <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                      )}
                      <span className="text-sm font-medium">{p.rule}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Extracted Data Table */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Extracted Fields</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {getExtractedSummary(rows)}
              </span>
            </div>
            <button
              onClick={() => setShowAddRow(true)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
            >
              <Plus className="h-3 w-3" />
              Add Row
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center p-6">
                <Receipt className="h-12 w-12 text-muted-foreground/30" />
                <h3 className="mt-4 text-lg font-semibold">No Data Extracted</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a receipt or invoice to automatically extract vendor details, amounts, tax info, and line items.
                </p>
              </div>
            ) : (
              <div className="space-y-6 p-4">
                {rowGroups.map((group) => (
                  <section key={group.id} className="overflow-hidden rounded-xl border bg-card">
                    <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold">{group.title}</h3>
                        {group.subtitle && (
                          <p className="text-xs text-muted-foreground">{group.subtitle}</p>
                        )}
                      </div>
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                        {group.rows.length} fields
                      </span>
                    </div>
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/20">
                          <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase w-[38%]">
                            Field
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">
                            Value
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-muted-foreground uppercase w-20">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const i = row.originalIndex
                          return (
                            <tr key={i} className="border-b hover:bg-accent/30 transition-colors">
                              <td className="px-4 py-2.5">
                                {editingIndex === i ? (
                                  <input
                                    type="text"
                                    value={row.field}
                                    onChange={(e) => handleUpdateRow(i, e.target.value, row.value)}
                                    onBlur={handleBlurRowEdit}
                                    autoFocus
                                    className="w-full rounded border px-2 py-1 text-sm"
                                  />
                                ) : (
                                  <span className="text-sm font-medium">{row.displayField}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                {editingIndex === i ? (
                                  <input
                                    type="text"
                                    value={row.value}
                                    onChange={(e) => handleUpdateRow(i, row.field, e.target.value)}
                                    onBlur={handleBlurRowEdit}
                                    className="w-full rounded border px-2 py-1 text-sm"
                                  />
                                ) : (
                                  <span className="text-sm">{row.value}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => setEditingIndex(i)}
                                    className="rounded p-1 hover:bg-muted"
                                    title="Edit row"
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRow(i)}
                                    className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                                    title="Delete row"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </section>
                ))}
              </div>
            )}
          </div>

          {/* Add Row Form */}
          {showAddRow && (
            <div className="border-t p-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="Field name"
                  className="rounded-md border px-3 py-1.5 text-sm flex-1"
                />
                <input
                  type="text"
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  placeholder="Value"
                  className="rounded-md border px-3 py-1.5 text-sm flex-[2]"
                />
                <button
                  onClick={handleAddRow}
                  disabled={!newFieldName.trim() || !newFieldValue.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddRow(false); setNewFieldName(""); setNewFieldValue("") }}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Draft Note */}
          {session?.draftNote && (
            <div className="border-t p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{session.draftNote}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
