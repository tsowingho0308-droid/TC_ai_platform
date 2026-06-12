"use client"

import { Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

export interface ExtractionRow {
  field: string
  value: string
  page?: number
}

interface ReportExtractionTableProps {
  rows: ExtractionRow[]
  onUpdateRow: (index: number, update: Partial<ExtractionRow>) => void
  onAddRow: () => void
  onDeleteRow: (index: number) => void
  onRowClick?: (index: number, row: ExtractionRow) => void
  selectedRowIndex?: number | null
  compact?: boolean
  hideHeader?: boolean
  className?: string
}

export function ReportExtractionTable({
  rows,
  onUpdateRow,
  onAddRow,
  onDeleteRow,
  onRowClick,
  selectedRowIndex,
  compact = false,
  hideHeader = false,
  className,
}: ReportExtractionTableProps) {
  if (rows.length === 0) {
    return (
      <p className={cn("py-6 text-center text-xs text-muted-foreground", className)}>
        No fields extracted yet.
      </p>
    )
  }

  return (
    <div className={cn(compact ? "" : "space-y-3", className)}>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Extracted Fields</h2>
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            <Plus className="h-3 w-3" />
            Add row
          </button>
        </div>
      )}

      <div className={cn(!compact && "rounded-lg border")}>
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_2fr_auto] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium">
          <span>Field</span>
          <span>Value</span>
          <span className="sr-only">Actions</span>
        </div>
        <div className="divide-y">
            {rows.map((row, index) => (
              <div
                key={index}
                className={cn(
                  "group grid grid-cols-[1fr_2fr_auto] items-start gap-2 px-3 py-2",
                  onRowClick && "cursor-pointer hover:bg-accent/30",
                  selectedRowIndex === index && "bg-primary/5 ring-1 ring-inset ring-primary/30"
                )}
                onClick={() => onRowClick?.(index, row)}
              >
                <div className="flex items-start gap-1.5">
                  <Pencil className="mt-2.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    type="text"
                    value={row.field}
                    onChange={(e) => onUpdateRow(index, { field: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Field"
                    className={cn(
                      "w-full rounded-md border bg-transparent px-2 font-medium",
                      compact ? "py-1 text-xs" : "py-1.5 text-sm"
                    )}
                  />
                </div>
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => onUpdateRow(index, { value: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Value"
                  className={cn(
                    "w-full rounded-md border bg-transparent px-2",
                    compact ? "py-1 text-xs" : "py-1.5 text-sm"
                  )}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteRow(index)
                  }}
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
