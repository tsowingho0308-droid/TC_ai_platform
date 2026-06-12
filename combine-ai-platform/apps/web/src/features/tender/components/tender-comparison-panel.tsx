"use client"

import { Brain, GitCompare, Loader2, AlertTriangle, Sparkles, Pencil, BookOpen } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

export interface ComparisonField {
  field: string
  values: Array<{ tenderId: string; tenderTitle: string; value: string }>
  match: boolean
  isKey: boolean
}

export interface ComparisonResult {
  comparisonFields: ComparisonField[]
  tenders: Array<{ id: string; title: string }>
}

export interface AiCompareResult {
  keyDifferences?: string[]
  risksA?: string[]
  risksB?: string[]
  recommendation?: { preferred?: string; reason?: string } | null
}

interface TenderComparisonPanelProps {
  comparisonResult: ComparisonResult
  tenderNames: string[]
  showDiffsOnly: boolean
  onShowDiffsOnlyChange: (value: boolean) => void
  diffCount: number
  matchCount: number
  aiCompareResult: AiCompareResult | null
  loadingAiCompare: boolean
  onEditFields?: () => void
  onSaveToKb?: () => void
}

function filterForDisplay(fields: ComparisonField[], showDiffsOnly: boolean) {
  return showDiffsOnly ? fields.filter((f) => !f.match) : fields
}

function formatPreferred(preferred: string | undefined, tenderNames: string[]): string {
  if (!preferred?.trim()) return "—"
  const normalized = preferred.trim()
  const lower = normalized.toLowerCase()
  if (lower === "a") return tenderNames[0] || normalized
  if (lower === "b") return tenderNames[1] || normalized
  if (lower === "neither") return "Neither"
  return normalized
}

function FieldStatusPills({ field }: { field: ComparisonField }) {
  if (!field.isKey) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
        Key
      </span>
    </div>
  )
}

function MatchStatusPill({ match }: { match: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        match
          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
      )}
    >
      {match ? "Match" : "Diff"}
    </span>
  )
}

function ComparisonTableSection({
  comparisonResult,
  keyFields,
  otherFields,
}: {
  comparisonResult: ComparisonResult
  keyFields: ComparisonField[]
  otherFields: ComparisonField[]
}) {
  const colCount = comparisonResult.tenders.length + 2

  function renderSectionHeader(label: string) {
    return (
      <tr className="border-b bg-muted/40">
        <td
          colSpan={colCount}
          className="sticky left-0 z-10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </td>
      </tr>
    )
  }

  function renderFieldRow(cf: ComparisonField) {
    return (
      <tr
        key={cf.field}
        className={cn(
          "border-b transition-colors hover:bg-accent/30",
          !cf.match && "bg-amber-50/20 dark:bg-amber-950/10"
        )}
      >
        <td className="sticky left-0 z-10 min-w-[200px] max-w-[240px] border-r bg-card px-4 py-3 align-top">
          <p className="text-sm font-medium text-foreground">{cf.field}</p>
          <FieldStatusPills field={cf} />
        </td>
        {cf.values.map((v) => (
          <td
            key={`${cf.field}-${v.tenderId}`}
            className={cn(
              "min-w-[180px] max-w-[280px] border-l border-border px-4 py-3 align-top text-sm",
              !cf.match && "bg-amber-50/40 dark:bg-amber-950/20"
            )}
          >
            <p className="line-clamp-3 break-words" title={v.value}>
              {v.value}
            </p>
          </td>
        ))}
        <td className="w-24 border-l border-border px-4 py-3 text-center align-top">
          <MatchStatusPill match={cf.match} />
        </td>
      </tr>
    )
  }

  if (keyFields.length === 0 && otherFields.length === 0) return null

  return (
    <div className="relative overflow-x-auto">
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-card to-transparent" />
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="sticky left-0 top-0 z-30 min-w-[200px] border-r bg-muted/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Field
            </th>
            {comparisonResult.tenders.map((tender) => (
              <th
                key={tender.id}
                className="sticky top-0 z-20 min-w-[180px] border-l border-border bg-muted/50 px-4 py-3 text-left align-top"
              >
                <p className="line-clamp-2 text-sm font-semibold text-foreground" title={tender.title}>
                  {tender.title}
                </p>
              </th>
            ))}
            <th className="sticky top-0 z-20 w-24 border-l border-border bg-muted/50 px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Match
            </th>
          </tr>
        </thead>
        <tbody>
          {keyFields.length > 0 && renderSectionHeader("Key Information")}
          {keyFields.map(renderFieldRow)}
          {otherFields.length > 0 && renderSectionHeader("Other Fields")}
          {otherFields.map(renderFieldRow)}
        </tbody>
      </table>
    </div>
  )
}

export function TenderComparisonPanel({
  comparisonResult,
  tenderNames,
  showDiffsOnly,
  onShowDiffsOnlyChange,
  diffCount,
  matchCount,
  aiCompareResult,
  loadingAiCompare,
  onEditFields,
  onSaveToKb,
}: TenderComparisonPanelProps) {
  const keyFieldCount = comparisonResult.comparisonFields.filter((f) => f.isKey).length
  const keyFields = filterForDisplay(
    comparisonResult.comparisonFields.filter((f) => f.isKey),
    showDiffsOnly
  )
  const otherFields = filterForDisplay(
    comparisonResult.comparisonFields.filter((f) => !f.isKey),
    showDiffsOnly
  )
  const hasVisibleRows = keyFields.length > 0 || otherFields.length > 0

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tenders compared
          </p>
          <p className="mt-1 text-2xl font-bold">{comparisonResult.tenders.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Differences
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{diffCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Matches
          </p>
          <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{matchCount}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Key fields
          </p>
          <p className="mt-1 text-2xl font-bold">{keyFieldCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Compare by field across tenders</span>
          <div className="hidden h-4 w-px bg-border sm:block" />
          <div className="flex flex-wrap gap-1.5">
            {comparisonResult.tenders.map((tender) => (
              <span
                key={tender.id}
                className="inline-flex max-w-[200px] items-center truncate rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={tender.title}
              >
                {tender.title}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onEditFields && (
            <button
              type="button"
              onClick={onEditFields}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Fields
            </button>
          )}
          {onSaveToKb && (
            <button
              type="button"
              onClick={onSaveToKb}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Save to KB
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={showDiffsOnly}
            onClick={() => onShowDiffsOnlyChange(!showDiffsOnly)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              showDiffsOnly
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-accent"
            )}
          >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              showDiffsOnly ? "bg-primary" : "bg-muted-foreground/40"
            )}
          />
          Differences only
        </button>
        </div>
      </div>

      {showDiffsOnly && !hasVisibleRows && (
        <div className="rounded-xl border border-green-200 bg-green-50/60 p-4 text-center text-sm text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-400">
          All compared fields match across tenders.
        </div>
      )}

      {hasVisibleRows && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <ComparisonTableSection
            comparisonResult={comparisonResult}
            keyFields={keyFields}
            otherFields={otherFields}
          />
        </div>
      )}

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Brain className="h-4 w-4 text-primary" />
          AI Comparison Summary
        </h3>
        {loadingAiCompare ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating comparison insights...
          </div>
        ) : aiCompareResult ? (
          <div className="space-y-4">
            {aiCompareResult.recommendation && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Recommendation
                </div>
                <p className="font-medium break-words">
                  {formatPreferred(aiCompareResult.recommendation.preferred, tenderNames)}
                </p>
                {aiCompareResult.recommendation.reason && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {aiCompareResult.recommendation.reason}
                  </p>
                )}
              </div>
            )}

            {aiCompareResult.keyDifferences && aiCompareResult.keyDifferences.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Key Differences
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {aiCompareResult.keyDifferences.map((d, i) => (
                    <div
                      key={i}
                      className="flex gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(aiCompareResult.risksA?.length || aiCompareResult.risksB?.length) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {aiCompareResult.risksA && aiCompareResult.risksA.length > 0 && (
                  <div className="rounded-xl border bg-muted/10 p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      {tenderNames[0] || "—"} — Risks
                    </p>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {aiCompareResult.risksA.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-amber-500">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiCompareResult.risksB && aiCompareResult.risksB.length > 0 && tenderNames[1] && (
                  <div className="rounded-xl border bg-muted/10 p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      {tenderNames[1]} — Risks
                    </p>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {aiCompareResult.risksB.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-amber-500">•</span>
                          <span>{r}</span>
                        </li>
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
                <p className="text-sm text-muted-foreground">No AI insights available for this comparison.</p>
              )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">AI insights unavailable.</p>
        )}
      </div>
    </div>
  )
}
