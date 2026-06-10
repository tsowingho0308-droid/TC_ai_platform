"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { Upload, Receipt, Loader2, Download } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { ModelSelector } from "@/features/shared/model-selector"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"

export default function FinancePage() {
  const [model, setModel] = useState(DEFAULT_MODELS.finance)
  const [extracting, setExtracting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [rows, setRows] = useState<Array<{ field: string; value: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setExtracting(true)

    // Read file as base64
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result as string
        // Create a session first
        const sessionRes = await fetch("/api/finance/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: file.name, sessionType: "EXPENSE_REVIEW" }),
        })
        if (!sessionRes.ok) throw new Error("Failed to create session")

        const { session } = await sessionRes.json()

        // Call AI extraction
        const extractRes = await fetch("/api/finance/agent?action=extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.id,
            fileBase64: base64,
            fileName: file.name,
            model,
          }),
        })

        if (extractRes.ok) {
          const data = await extractRes.json()
          setRows(data.rows || [])
        }
      } catch (err) {
        console.error("Extraction error:", err)
      } finally {
        setExtracting(false)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Finance Agent</h1>
          <p className="text-xs text-muted-foreground">Receipt OCR, expense policy check &amp; data extraction</p>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector value={model} onChange={setModel} />
          <Link
            href="/finance/policies"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Expense Policies
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Upload */}
        <div className="w-1/2 border-r p-6">
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
                <img src={previewUrl} alt="Receipt preview" className="mx-auto max-h-48 rounded-lg" />
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

          {extracting && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI is analyzing the document...
            </div>
          )}

          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold">How it works</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</span>
                <div>
                  <p className="text-sm font-medium">Upload receipt/invoice</p>
                  <p className="text-xs text-muted-foreground">Snap a photo or upload a PDF</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</span>
                <div>
                  <p className="text-sm font-medium">AI extracts all data</p>
                  <p className="text-xs text-muted-foreground">Vendor, amounts, tax, line items, dates</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</span>
                <div>
                  <p className="text-sm font-medium">Policy compliance check</p>
                  <p className="text-xs text-muted-foreground">Auto-checks against company expense policies</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Results */}
        <div className="w-1/2 p-6">
          {rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Receipt className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Expense Review</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Upload a receipt or invoice to automatically extract vendor details, amounts, tax info, and line items. The AI will check compliance against your expense policies.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Extracted Data ({rows.length} fields)</h2>
                <button className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <Download className="h-3 w-3" />
                  Export
                </button>
              </div>
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                  <span className="text-sm font-medium min-w-[120px]">{row.field}</span>
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
