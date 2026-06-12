"use client"

import { cn } from "@combine-ai/shared-ui"
import { Receipt } from "lucide-react"
import {
  groupExtractedRows,
  parseExtractedRowField,
  type ExtractedRow,
} from "@/features/finance/extracted-rows"

const GROUP_STYLES = [
  "border-blue-200 bg-blue-50/60",
  "border-emerald-200 bg-emerald-50/60",
  "border-amber-200 bg-amber-50/60",
  "border-violet-200 bg-violet-50/60",
]

interface GroupedExtractedFieldsProps {
  rows: ExtractedRow[]
  compact?: boolean
}

export function GroupedExtractedFields({ rows, compact = false }: GroupedExtractedFieldsProps) {
  const groups = groupExtractedRows(rows)

  if (groups.length <= 1 && !groups[0]?.receiptLabel) {
    return (
      <div className="space-y-2">
        {rows.map((row, index) => {
          const displayField = parseExtractedRowField(row.field).displayField
          return (
          <div
            key={`${row.field}-${index}`}
            className="flex items-start gap-3 rounded-md border bg-card px-3 py-2"
          >
            <span className="min-w-[120px] text-sm font-medium text-muted-foreground">
              {displayField}
            </span>
            <span className="flex-1 text-sm">{row.value}</span>
          </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", compact ? "space-y-3" : "space-y-4")}>
      {groups.map((group, groupIndex) => (
        <section
          key={group.id}
          className={cn(
            "overflow-hidden rounded-xl border",
            GROUP_STYLES[groupIndex % GROUP_STYLES.length]
          )}
        >
          <div className="flex items-center justify-between border-b border-inherit bg-white/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-white p-1.5 shadow-sm">
                <Receipt className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{group.title}</h3>
              </div>
            </div>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-sm">
              {group.rows.length} fields
            </span>
          </div>

          <div className="space-y-0 divide-y divide-black/5 bg-white/80">
            {group.rows.map((row) => (
              <div
                key={`${group.id}-${row.originalIndex}`}
                className="grid grid-cols-[minmax(140px,34%)_1fr] gap-3 px-4 py-2.5"
              >
                <span className="text-sm font-medium text-muted-foreground">
                  {row.displayField}
                </span>
                <span className="text-sm">{row.value}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function getExtractedSummary(rows: ExtractedRow[]) {
  const groups = groupExtractedRows(rows)
  const receiptGroups = groups.filter((group) => group.receiptLabel)

  if (receiptGroups.length > 1) {
    return `${receiptGroups.length} receipts · ${rows.length} fields`
  }

  if (receiptGroups.length === 1) {
    return `${receiptGroups[0].title} · ${rows.length} fields`
  }

  return `${rows.length} fields`
}
