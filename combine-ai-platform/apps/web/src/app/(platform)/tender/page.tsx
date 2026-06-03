"use client"

import { useState, useRef } from "react"
import { Upload, FileText, Download, Plus, Trash2, Loader2, GitCompare } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface TenderField {
  field: string
  value: string
}

export default function TenderPage() {
  const [tenders, setTenders] = useState<Array<{ name: string; fields: TenderField[] }>>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setAnalyzing(true)
    // Simulate AI analysis of tender document
    setTimeout(() => {
      const newTender = {
        name: file.name.replace(/\.(pdf|docx?)$/i, ""),
        fields: [
          { field: "Tender Name", value: file.name },
          { field: "Client Organization", value: "Sample Organization Ltd." },
          { field: "Services Included", value: "IT Infrastructure, Cloud Migration, 24/7 Support" },
          { field: "Services Excluded", value: "Hardware Procurement, On-site Training" },
          { field: "Funding / Budget", value: "HK$ 5,000,000" },
          { field: "Submission Deadline", value: "2026-06-30" },
          { field: "Contract Duration", value: "24 months" },
          { field: "Key Requirements", value: "ISO 27001 certified, 5+ years experience" },
        ],
      }
      setTenders([...tenders, newTender])
      setAnalyzing(false)
    }, 2000)
  }

  function addField(tenderIndex: number) {
    setTenders(
      tenders.map((t, i) =>
        i === tenderIndex ? { ...t, fields: [...t.fields, { field: "", value: "" }] } : t
      )
    )
  }

  function updateField(tenderIndex: number, fieldIndex: number, update: Partial<TenderField>) {
    setTenders(
      tenders.map((t, i) =>
        i === tenderIndex
          ? { ...t, fields: t.fields.map((f, j) => (j === fieldIndex ? { ...f, ...update } : f)) }
          : t
      )
    )
  }

  function deleteField(tenderIndex: number, fieldIndex: number) {
    setTenders(
      tenders.map((t, i) =>
        i === tenderIndex ? { ...t, fields: t.fields.filter((_, j) => j !== fieldIndex) } : t
      )
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <h1 className="text-lg font-semibold">Tender & Bidding Agent</h1>
          <div className="flex items-center gap-2">
            {tenders.length >= 2 && (
              <button className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                <GitCompare className="h-4 w-4" />
                Compare ({tenders.length})
              </button>
            )}
            <button
              disabled={tenders.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Comparison
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: Upload Panel */}
          <div className="w-80 border-r p-6">
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
                accept=".pdf,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Upload Tender Document</p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF or DOCX tender/bidding documents
              </p>
            </div>

            {analyzing && (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI is analyzing the tender document...
              </div>
            )}

            {/* Template Selector */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">Tender Type</h3>
              <select
                value={selectedTemplate || ""}
                onChange={(e) => setSelectedTemplate(e.target.value || null)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                <option value="">Auto-detect</option>
                <option value="it-tender">IT Services Tender</option>
                <option value="construction">Construction Tender</option>
                <option value="consulting">Consulting Services Tender</option>
                <option value="procurement">Procurement Tender</option>
              </select>
            </div>

            {/* Uploaded Tenders List */}
            {tenders.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold">
                  Analyzed Tenders ({tenders.length})
                </h3>
                <div className="space-y-1">
                  {tenders.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-accent/50"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{t.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Tender Details / Comparison View */}
          <div className="flex-1 p-6 overflow-y-auto">
            {tenders.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <FileText className="h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-semibold">Tender & Bidding Agent</h3>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Upload tender documents to analyze key information, compare multiple tenders side-by-side, and export comparison tables.
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  Upload a PDF or DOCX file to get started
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                {tenders.map((tender, ti) => (
                  <div key={ti}>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold">{tender.name}</h2>
                      <button
                        onClick={() => addField(ti)}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      >
                        <Plus className="h-3 w-3" />
                        Add Field
                      </button>
                    </div>
                    <div className="space-y-2">
                      {tender.fields.map((field, fi) => (
                        <div key={fi} className="flex items-start gap-2">
                          <input
                            type="text"
                            value={field.field}
                            onChange={(e) => updateField(ti, fi, { field: e.target.value })}
                            placeholder="Field"
                            className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm"
                          />
                          <input
                            type="text"
                            value={field.value}
                            onChange={(e) => updateField(ti, fi, { value: e.target.value })}
                            placeholder="Value"
                            className="flex-[3] rounded-md border bg-transparent px-3 py-2 text-sm"
                          />
                          <button
                            onClick={() => deleteField(ti, fi)}
                            className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
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
