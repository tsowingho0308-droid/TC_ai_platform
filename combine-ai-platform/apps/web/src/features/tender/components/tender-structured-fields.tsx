"use client"

import { Pencil, Plus, Trash2 } from "lucide-react"
import {
  TENDER_FIELD_SECTIONS,
  groupFieldsBySection,
} from "@/features/tender/lib/tender-field-sections"

export interface TenderFieldRow {
  field: string
  value: string
}

export interface TenderForEdit {
  id: string
  name: string
  fileName?: string
  fields: TenderFieldRow[]
  type: string | null
}

interface TenderStructuredFieldsProps {
  tender: TenderForEdit
  tenderIndex: number
  onAddField: (tenderIndex: number, defaultFieldLabel?: string) => void
  onUpdateField: (tenderIndex: number, fieldIndex: number, update: Partial<TenderFieldRow>) => void
  onDeleteField: (tenderIndex: number, fieldIndex: number) => void
}

export function TenderStructuredFields({
  tender,
  tenderIndex,
  onAddField,
  onUpdateField,
  onDeleteField,
}: TenderStructuredFieldsProps) {
  const grouped = groupFieldsBySection(tender.fields)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">{tender.name}</h2>
        {tender.fileName && (
          <p className="text-xs text-muted-foreground">{tender.fileName}</p>
        )}
        {tender.type && (
          <span className="text-xs text-muted-foreground capitalize">
            {tender.type.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {tender.fields.length === 0 ? (
        <p className="rounded-xl border bg-card py-6 text-center text-sm text-muted-foreground">
          No fields extracted — add a field below or upload a new document.
        </p>
      ) : (
        TENDER_FIELD_SECTIONS.map((section) => {
          const rows = grouped.get(section.id) ?? []
          if (section.id === "other" && rows.length === 0) return null

          return (
            <section
              key={section.id}
              className="rounded-xl border bg-card p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{section.label}</h3>
                <button
                  type="button"
                  onClick={() => onAddField(tenderIndex, section.defaultFieldLabel || undefined)}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                  Add field
                </button>
              </div>

              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No fields in this section.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.index} className="group flex items-start gap-2">
                      <span
                        className="mt-2.5 shrink-0 text-muted-foreground"
                        title="Editable field"
                        aria-hidden
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </span>
                      <input
                        type="text"
                        value={row.field}
                        onChange={(e) =>
                          onUpdateField(tenderIndex, row.index, { field: e.target.value })
                        }
                        placeholder="Field"
                        className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm font-medium"
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) =>
                          onUpdateField(tenderIndex, row.index, { value: e.target.value })
                        }
                        placeholder="Value"
                        className="flex-[3] rounded-md border bg-transparent px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => onDeleteField(tenderIndex, row.index)}
                        className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        aria-label="Delete field"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}

      {tender.fields.length === 0 && (
        <button
          type="button"
          onClick={() => onAddField(tenderIndex)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          Add field
        </button>
      )}
    </div>
  )
}
