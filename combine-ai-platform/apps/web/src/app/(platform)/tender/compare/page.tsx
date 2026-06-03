"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { ArrowLeft, Download, GitCompare, Send, Loader2, Brain, Check, X, AlertTriangle } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface TenderSession {
  id: string
  title: string
  tenderType: string | null
  fieldInputs: Record<string, string>
  status: string
  updatedAt: string
}

interface ComparisonField {
  field: string
  values: Array<{
    tenderId: string
    tenderTitle: string
    value: string
  }>
  match: boolean
}

interface ComparisonResult {
  comparisonFields: ComparisonField[]
  tenders: Array<{ id: string; title: string; fieldInputs: Record<string, string> }>
  keyDifferences: string[]
  risksA: string[]
  risksB: string[]
  recommendation: { preferred?: string; reason?: string } | null
}

export default function ComparePage() {
  const [sessions, setSessions] = useState<TenderSession[]>([])
  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null)

  // Fetch sessions
  useEffect(() => {
    fetch("/api/tender/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sessions) setSessions(data.sessions)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Run AI comparison
  const runComparison = useCallback(async () => {
    if (sessions.length < 2) return

    setComparing(true)
    try {
      const res = await fetch("/api/tender/agent/run?action=compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: sessions.map((s) => s.id),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        throw new Error(err.detail || err.error || "Comparison failed")
      }

      const result = (await res.json()) as ComparisonResult
      setComparisonResult(result)
    } catch (err) {
      console.error("Comparison error:", err)
      // Fall back to client-side comparison if API fails
      buildClientComparison(sessions)
    } finally {
      setComparing(false)
    }
  }, [sessions])

  // Build simple client-side comparison as fallback
  function buildClientComparison(sessionsToCompare: TenderSession[]) {
    const allFields = Array.from(
      new Set(sessionsToCompare.flatMap((s) => Object.keys(s.fieldInputs || {})))
    ).filter(Boolean)

    const comparisonFields: ComparisonField[] = allFields.map((field) => {
      const values = sessionsToCompare.map((t) => ({
        tenderId: t.id,
        tenderTitle: t.title,
        value: t.fieldInputs?.[field] || "—",
      }))

      const allMatch = values.length >= 2 && values.every((v) => v.value === values[0].value)

      return { field, values, match: allMatch }
    })

    setComparisonResult({
      comparisonFields,
      tenders: sessionsToCompare.map((s) => ({
        id: s.id,
        title: s.title,
        fieldInputs: (s.fieldInputs as Record<string, string>) || {},
      })),
      keyDifferences: [],
      risksA: [],
      risksB: [],
      recommendation: null,
    })
  }

  // Auto-run comparison when sessions load
  useEffect(() => {
    if (sessions.length >= 2) {
      buildClientComparison(sessions)
    }
  }, [sessions])

  async function exportComparison() {
    if (!comparisonResult) return

    const rows = comparisonResult.comparisonFields.map((cf) => {
      const row: Record<string, string> = { Field: cf.field }
      cf.values.forEach((v) => {
        row[v.tenderTitle] = v.value
      })
      return row
    })

    // Flatten to Field/Value pairs
    const flatRows: Array<{ field: string; value: string }> = rows.flatMap((row) => {
      const fieldBase = row.Field
      const entries: Array<{ field: string; value: string }> = []
      for (const [key, val] of Object.entries(row)) {
        if (key !== "Field") {
          entries.push({ field: `${fieldBase} [${key}]`, value: val || "—" })
        }
      }
      return entries
    })

    try {
      const res = await fetch("/api/report/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: flatRows, format: "xlsx" }),
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `tender-comparison-${Date.now()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/tender" className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Tender Comparison</h1>
          <GitCompare className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          {sessions.length >= 2 && (
            <button
              onClick={runComparison}
              disabled={comparing}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              <Brain className="h-4 w-4" />
              {comparing ? "Analyzing..." : "AI Compare"}
            </button>
          )}
          <button
            onClick={exportComparison}
            disabled={!comparisonResult}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export Excel
          </button>
          <Link
            href={`/email/compose?fromTender=comparison`}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            <Send className="h-4 w-4" />
            Send via Email
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : sessions.length < 2 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <GitCompare className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">Not enough tenders to compare</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload at least 2 tender documents to enable comparison.
            </p>
            <Link href="/tender" className="mt-4 text-sm text-primary hover:underline">
              Return to Tender Agent
            </Link>
          </div>
        ) : comparisonResult ? (
          <div className="space-y-6">
            {/* Recommendation Banner */}
            {comparisonResult.recommendation && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <div className="flex items-start gap-3">
                  <Brain className="mt-0.5 h-5 w-5 text-blue-500" />
                  <div>
                    <p className="font-semibold text-sm">AI Recommendation</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {comparisonResult.recommendation.preferred
                        ? `Preferred: Tender "${comparisonResult.recommendation.preferred}" — ${comparisonResult.recommendation.reason || ""}`
                        : comparisonResult.recommendation.reason || "No clear preference"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Key Differences */}
            {comparisonResult.keyDifferences.length > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
                  <div>
                    <p className="font-semibold text-sm">Key Differences Found</p>
                    <ul className="mt-2 space-y-1">
                      {comparisonResult.keyDifferences.map((diff, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                          {diff}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Risks */}
            <div className="grid grid-cols-2 gap-4">
              {comparisonResult.risksA.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                  <p className="font-semibold text-sm text-red-600">
                    Risks: {comparisonResult.tenders[0]?.title || "Tender A"}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {comparisonResult.risksA.map((risk, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <X className="mt-0.5 h-3.5 w-3.5 text-red-400 shrink-0" />
                        {risk}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {comparisonResult.risksB.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                  <p className="font-semibold text-sm text-red-600">
                    Risks: {comparisonResult.tenders[1]?.title || "Tender B"}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {comparisonResult.risksB.map((risk, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <X className="mt-0.5 h-3.5 w-3.5 text-red-400 shrink-0" />
                        {risk}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Comparison Table */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium w-48">Field</th>
                    {comparisonResult.tenders.map((tender) => (
                      <th key={tender.id} className="px-4 py-3 text-left font-medium">
                        {tender.title}
                        <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                          ({sessions.find((s) => s.id === tender.id)?.tenderType?.replace("_", " ") || "general"})
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-medium w-20">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonResult.comparisonFields.map((cf, idx) => (
                    <tr
                      key={cf.field}
                      className={cn(
                        "border-b",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                        !cf.match && "bg-amber-50/30"
                      )}
                    >
                      <td className="px-4 py-2.5 font-medium text-muted-foreground">
                        {cf.field}
                      </td>
                      {cf.values.map((v) => (
                        <td key={`${cf.field}-${v.tenderId}`} className="px-4 py-2.5">
                          {cf.match ? (
                            <span>{v.value}</span>
                          ) : (
                            <span className="text-amber-700">{v.value || "—"}</span>
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
        ) : null}
      </div>
    </div>
  )
}
