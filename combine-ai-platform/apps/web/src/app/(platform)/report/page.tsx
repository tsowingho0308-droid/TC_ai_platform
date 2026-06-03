"use client"

import { useState, useRef } from "react"
import { Upload, FileSpreadsheet, Download, Plus, Trash2, Loader2 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface TableRow {
  field: string
  value: string
}

export default function ReportPage() {
  const [rows, setRows] = useState<TableRow[]>([])
  const [extracting, setExtracting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addRow() {
    setRows([...rows, { field: "", value: "" }])
  }

  function updateRow(index: number, update: Partial<TableRow>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...update } : r)))
  }

  function deleteRow(index: number) {
    setRows(rows.filter((_, i) => i !== index))
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Preview
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)

    // Simulate AI extraction
    setExtracting(true)
    setTimeout(() => {
      setRows([
        { field: "Document Title", value: file.name },
        { field: "Date", value: new Date().toLocaleDateString() },
        { field: "Type", value: file.type || "Unknown" },
        { field: "Size", value: `${(file.size / 1024).toFixed(1)} KB` },
        { field: "Status", value: "Extracted" },
      ])
      setExtracting(false)
    }, 1500)
  }

  return (
    <div className="flex h-full">
      {/* Main Workspace */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-6 py-3">
          <h1 className="text-lg font-semibold">Report Agent</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => rows.length > 0 && exportToExcel(rows)}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        </header>

        {/* Content - two columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Upload & Chat */}
          <div className="w-1/2 border-r p-6">
            <div
              className={cn(
                "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                "hover:border-primary/50 hover:bg-accent/50",
                previewUrl ? "border-solid" : ""
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
              {previewUrl ? (
                <div className="space-y-4">
                  <img src={previewUrl} alt="Preview" className="mx-auto max-h-48 rounded-lg" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm text-primary hover:underline"
                  >
                    Change file
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer space-y-3"
                >
                  <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">Upload document</p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPEG, PDF, or DOCX (max 10MB)
                  </p>
                </div>
              )}
            </div>

            {extracting && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI is analyzing the document...
              </div>
            )}

            {/* Note input */}
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium">Notes / Instructions</label>
              <textarea
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm resize-none"
                rows={3}
                placeholder="Add any specific instructions for the AI (e.g., 'Extract dates in dd/mm/yyyy format')..."
              />
            </div>
          </div>

          {/* Right: Table Editor */}
          <div className="w-1/2 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">
                Extracted Data
                {rows.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({rows.length} rows)
                  </span>
                )}
              </h2>
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                <Plus className="h-3 w-3" />
                Add Row
              </button>
            </div>

            {rows.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed text-center">
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Upload a document to extract data
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <input
                      type="text"
                      value={row.field}
                      onChange={(e) => updateRow(i, { field: e.target.value })}
                      placeholder="Field"
                      className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
                    />
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => updateRow(i, { value: e.target.value })}
                      placeholder="Value"
                      className="flex-[2] rounded-md border bg-transparent px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => deleteRow(i)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

async function exportToExcel(rows: TableRow[]) {
  try {
    const res = await fetch("/api/report/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    })
    if (!res.ok) throw new Error("Export failed")
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "report.xlsx"
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error("Export error:", err)
  }
}
