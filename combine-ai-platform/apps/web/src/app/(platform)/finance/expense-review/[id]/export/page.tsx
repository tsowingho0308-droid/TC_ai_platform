"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Database, Download, ExternalLink, Loader2 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { toast } from "sonner"
import {
  getPolicyExportBlockers,
  validateSubmitterInfo,
  type ExpenseExportSubmitterInfo,
  type PolicyResult,
} from "@/features/finance/policy-export"
import {
  listKnowledgeBases,
  uploadDocument,
  type KnowledgeBase,
} from "@/features/context/api/context-client"

interface FinanceSession {
  id: string
  title: string
  policyResults: PolicyResult[] | null
}

export default function ExpenseReviewExportPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [sessionTitle, setSessionTitle] = useState("Expense Review")
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loadingKnowledgeBases, setLoadingKnowledgeBases] = useState(true)
  const [saveToContext, setSaveToContext] = useState(false)
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("")
  const [contextTitle, setContextTitle] = useState("")
  const [form, setForm] = useState<ExpenseExportSubmitterInfo>({
    fullName: "",
    email: "",
    personInChargeName: "",
    personInChargeEmail: "",
    additionalNotes: "",
  })

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch(`/api/finance/sessions?id=${id}`)
        if (!res.ok) throw new Error("Session not found")
        const data = await res.json()
        const session = data.session as FinanceSession
        const title = session.title || "Expense Review"
        setSessionTitle(title)
        setContextTitle(`${title} — Expense Report`)

        const blockers = getPolicyExportBlockers(session.policyResults)
        if (blockers.length > 0) {
          toast.error(blockers.join(" "))
          router.replace(`/finance/expense-review/${id}`)
          return
        }
      } catch {
        toast.error("Failed to load session")
        router.replace("/finance")
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [id, router])

  useEffect(() => {
    listKnowledgeBases()
      .then((data) => {
        setKnowledgeBases(data.knowledgeBases)
        if (data.knowledgeBases.length > 0) {
          setKnowledgeBaseId(data.knowledgeBases[0].id)
        }
      })
      .catch(() => {
        toast.error("Failed to load knowledge bases")
      })
      .finally(() => {
        setLoadingKnowledgeBases(false)
      })
  }, [])

  const updateField = useCallback(
    (field: keyof ExpenseExportSubmitterInfo, value: string) => {
      setForm((current) => ({ ...current, [field]: value }))
    },
    []
  )

  const handleExport = useCallback(async () => {
    const validationErrors = validateSubmitterInfo(form)
    if (validationErrors.length > 0) {
      toast.error(validationErrors[0])
      return
    }

    if (saveToContext) {
      if (knowledgeBases.length === 0) {
        toast.error("No knowledge base found. Create one in Context Management first.")
        return
      }
      if (!knowledgeBaseId) {
        toast.error("Please select a knowledge base for Context storage.")
        return
      }
      if (!contextTitle.trim()) {
        toast.error("Please enter a title for the Context document.")
        return
      }
    }

    setExporting(true)
    try {
      const res = await fetch("/api/finance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          format: "xlsx",
          includePolicyCheck: true,
          requirePolicyPass: true,
          submitterInfo: {
            fullName: form.fullName.trim(),
            email: form.email.trim(),
            personInChargeName: form.personInChargeName.trim(),
            personInChargeEmail: form.personInChargeEmail.trim(),
            additionalNotes: form.additionalNotes?.trim() || "",
          },
        }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string
          blockers?: string[]
        } | null
        const message =
          data?.blockers?.join(" ") || data?.error || "Export failed"
        throw new Error(message)
      }

      const blob = await res.blob()
      const fileName = `expense-review-${id.slice(0, 8)}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)

      if (saveToContext) {
        const file = new File([blob], fileName, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
        await uploadDocument(file, knowledgeBaseId, contextTitle.trim(), {
          targetAudience: "ALL_EMPLOYEES",
          businessProcesses: ["Finance", "Expense Review"],
          documentType: "STANDARD",
        })
        toast.success("Report exported and saved to Context Management")
      } else {
        toast.success("Report exported")
      }

      router.push(`/finance/expense-review/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }, [
    contextTitle,
    form,
    id,
    knowledgeBaseId,
    knowledgeBases.length,
    router,
    saveToContext,
  ])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/finance/expense-review/${id}`)}
            className="rounded-md p-1 hover:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Export Expense Report</h1>
            <p className="text-xs text-muted-foreground">{sessionTitle}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold">Submitter Information</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete the details below. They will be included in the exported Excel report.
            </p>

            <div className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Full Name *</span>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(e) => updateField("fullName", e.target.value)}
                    placeholder="Your full name"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Email *</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Person in Charge Name *</span>
                  <input
                    type="text"
                    value={form.personInChargeName}
                    onChange={(e) => updateField("personInChargeName", e.target.value)}
                    placeholder="Manager or approver name"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Person in Charge Email *</span>
                  <input
                    type="email"
                    value={form.personInChargeEmail}
                    onChange={(e) => updateField("personInChargeEmail", e.target.value)}
                    placeholder="manager@company.com"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Additional Notes</span>
                <textarea
                  value={form.additionalNotes}
                  onChange={(e) => updateField("additionalNotes", e.target.value)}
                  placeholder="Department, cost center, purpose of expense, or other important details"
                  rows={4}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-8 rounded-lg border bg-muted/20 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={saveToContext}
                  onChange={(e) => setSaveToContext(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border"
                />
                <div className="space-y-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Database className="h-4 w-4 text-primary" />
                    Save to Context Management
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Store this expense report in the company knowledge base so other agents can
                    search and reference it later.
                  </p>
                </div>
              </label>

              {saveToContext && (
                <div className="mt-4 space-y-4 border-t pt-4">
                  {loadingKnowledgeBases ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading knowledge bases...
                    </div>
                  ) : knowledgeBases.length === 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      No knowledge base found.{" "}
                      <Link href="/context" className="font-medium underline">
                        Create one in Context Management
                      </Link>{" "}
                      before saving.
                    </div>
                  ) : (
                    <>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium">Knowledge Base *</span>
                        <select
                          value={knowledgeBaseId}
                          onChange={(e) => setKnowledgeBaseId(e.target.value)}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {knowledgeBases.map((kb) => (
                            <option key={kb.id} value={kb.id}>
                              {kb.name} ({kb.department})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium">Context Document Title *</span>
                        <input
                          type="text"
                          value={contextTitle}
                          onChange={(e) => setContextTitle(e.target.value)}
                          placeholder="Title shown in Context Management"
                          className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                      </label>
                    </>
                  )}

                  <Link
                    href="/context"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open Context Management
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => router.push(`/finance/expense-review/${id}`)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || (saveToContext && knowledgeBases.length === 0)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                )}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exporting
                  ? saveToContext
                    ? "Exporting & saving..."
                    : "Exporting..."
                  : saveToContext
                    ? "Export XLSX & Save to Context"
                    : "Export XLSX"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
