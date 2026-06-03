"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Upload, Loader2, Download, CheckCircle, XCircle,
  AlertTriangle, ArrowRight, ArrowLeft, FileText
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { toast } from "sonner"

interface MatchItem {
  poItem: string
  grnQty: number
  invQty: number
  poPrice: number
  invPrice: number
  status: string
}

interface MatchResult {
  matchedItems: MatchItem[]
  summary: {
    totalMatchCount: number
    discrepancyCount: number
    totalPOAmount: number
    totalInvAmount: number
    variance: number
  }
  flags: string[]
}

interface DocUpload {
  file: File | null
  base64: string | null
  fileName: string
  uploaded: boolean
}

export default function ThreeWayMatchPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [poDoc, setPoDoc] = useState<DocUpload>({ file: null, base64: null, fileName: "", uploaded: false })
  const [grnDoc, setGrnDoc] = useState<DocUpload>({ file: null, base64: null, fileName: "", uploaded: false })
  const [invDoc, setInvDoc] = useState<DocUpload>({ file: null, base64: null, fileName: "", uploaded: false })
  const [matching, setMatching] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [extractedData, setExtractedData] = useState<Record<string, unknown>>({})

  const allUploaded = poDoc.uploaded && grnDoc.uploaded && invDoc.uploaded

  const handleFileChange = useCallback(
    (
      e: React.ChangeEvent<HTMLInputElement>,
      setDoc: React.Dispatch<React.SetStateAction<DocUpload>>
    ) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        setDoc({
          file,
          base64: reader.result as string,
          fileName: file.name,
          uploaded: true,
        })
      }
      reader.readAsDataURL(file)
    },
    []
  )

  const extractDocument = useCallback(
    async (base64: string, fileName: string): Promise<Record<string, unknown>> => {
      const res = await fetch("/api/finance/agent?action=extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, fileBase64: base64, fileName }),
      })
      if (!res.ok) throw new Error("Extraction failed")
      const data = await res.json()
      return { rows: data.rows || [], documentType: data.documentType }
    },
    [id]
  )

  const handleStartMatching = useCallback(async () => {
    if (!allUploaded || !poDoc.base64 || !grnDoc.base64 || !invDoc.base64) return

    setMatching(true)
    try {
      toast.info("Extracting data from documents...")

      const [poData, grnData, invData] = await Promise.all([
        extractDocument(poDoc.base64, poDoc.fileName),
        extractDocument(grnDoc.base64, grnDoc.fileName),
        extractDocument(invDoc.base64, invDoc.fileName),
      ])

      setExtractedData({ poData, grnData, invData })

      toast.info("Running 3-way comparison...")
      const matchRes = await fetch("/api/finance/agent?action=three-way-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          poData,
          grnData,
          invData,
        }),
      })

      if (!matchRes.ok) throw new Error("Match analysis failed")
      const result = (await matchRes.json()) as MatchResult
      setMatchResult(result)
      toast.success(
        `Match complete: ${result.summary?.totalMatchCount || 0} matched, ${result.summary?.discrepancyCount || 0} discrepancies`
      )
    } catch (err) {
      toast.error(`Match failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setMatching(false)
    }
  }, [allUploaded, poDoc, grnDoc, invDoc, extractDocument, id])

  const handleExport = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, format: "csv" }),
      })
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `three-way-match-${id.slice(0, 8)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Report exported")
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
  }, [id])

  const statusColor = (status: string) => {
    switch (status) {
      case "match": return "text-green-700 bg-green-50 border-green-200"
      case "qty_mismatch": return "text-amber-700 bg-amber-50 border-amber-200"
      case "price_mismatch": return "text-orange-700 bg-orange-50 border-orange-200"
      case "missing_grn": return "text-red-700 bg-red-50 border-red-200"
      case "missing_po": return "text-red-700 bg-red-50 border-red-200"
      default: return "text-gray-700 bg-gray-50 border-gray-200"
    }
  }

  const statusLabel = (status: string) => {
    switch (status) {
      case "match": return "OK"
      case "qty_mismatch": return "Qty Diff"
      case "price_mismatch": return "Price Diff"
      case "missing_grn": return "No GRN"
      case "missing_po": return "No PO"
      default: return status
    }
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
            <h1 className="text-lg font-semibold">3-Way Matching</h1>
            <p className="text-xs text-muted-foreground">PO · GRN · Invoice comparison</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {matchResult && (
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-4 w-4" />
              Export Report
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!matchResult ? (
          /* Upload Phase */
          <div className="mx-auto max-w-4xl p-6">
            <div className="text-center mb-8">
              <h2 className="text-xl font-bold">Upload Three Documents</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Purchase Order (PO), Goods Receipt Note (GRN), and Supplier Invoice
              </p>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* PO Upload */}
              <div className="space-y-3">
                <h3 className="text-center text-sm font-semibold">Purchase Order (PO)</h3>
                <label
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
                    poDoc.uploaded
                      ? "border-green-300 bg-green-50"
                      : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/50"
                  )}
                >
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, setPoDoc)}
                    className="hidden"
                  />
                  <Upload className={cn("h-8 w-8", poDoc.uploaded ? "text-green-500" : "text-muted-foreground")} />
                  <p className="mt-2 text-sm font-medium">
                    {poDoc.uploaded ? poDoc.fileName : "Upload PO"}
                  </p>
                  {poDoc.uploaded && <CheckCircle className="mt-1 h-4 w-4 text-green-500" />}
                </label>
              </div>

              {/* GRN Upload */}
              <div className="space-y-3">
                <h3 className="text-center text-sm font-semibold">Goods Receipt (GRN)</h3>
                <label
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
                    grnDoc.uploaded
                      ? "border-green-300 bg-green-50"
                      : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/50"
                  )}
                >
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, setGrnDoc)}
                    className="hidden"
                  />
                  <Upload className={cn("h-8 w-8", grnDoc.uploaded ? "text-green-500" : "text-muted-foreground")} />
                  <p className="mt-2 text-sm font-medium">
                    {grnDoc.uploaded ? grnDoc.fileName : "Upload GRN"}
                  </p>
                  {grnDoc.uploaded && <CheckCircle className="mt-1 h-4 w-4 text-green-500" />}
                </label>
              </div>

              {/* Invoice Upload */}
              <div className="space-y-3">
                <h3 className="text-center text-sm font-semibold">Supplier Invoice</h3>
                <label
                  className={cn(
                    "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
                    invDoc.uploaded
                      ? "border-green-300 bg-green-50"
                      : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/50"
                  )}
                >
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, setInvDoc)}
                    className="hidden"
                  />
                  <Upload className={cn("h-8 w-8", invDoc.uploaded ? "text-green-500" : "text-muted-foreground")} />
                  <p className="mt-2 text-sm font-medium">
                    {invDoc.uploaded ? invDoc.fileName : "Upload Invoice"}
                  </p>
                  {invDoc.uploaded && <CheckCircle className="mt-1 h-4 w-4 text-green-500" />}
                </label>
              </div>
            </div>

            <div className="mt-8 text-center">
              <button
                onClick={handleStartMatching}
                disabled={!allUploaded || matching}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {matching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing & Matching...
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    Start 3-Way Match
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Results Phase */
          <div className="p-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-5 gap-4">
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Matched Items</p>
                <p className="mt-1 text-2xl font-bold text-green-600">
                  {matchResult.summary?.totalMatchCount || 0}
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Discrepancies</p>
                <p className="mt-1 text-2xl font-bold text-red-600">
                  {matchResult.summary?.discrepancyCount || 0}
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">PO Total</p>
                <p className="mt-1 text-xl font-bold">
                  ${(matchResult.summary?.totalPOAmount || 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Invoice Total</p>
                <p className="mt-1 text-xl font-bold">
                  ${(matchResult.summary?.totalInvAmount || 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-xs text-muted-foreground uppercase">Variance</p>
                <p
                  className={cn(
                    "mt-1 text-xl font-bold",
                    (matchResult.summary?.variance || 0) === 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  ${(matchResult.summary?.variance || 0).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Flags */}
            {matchResult.flags && matchResult.flags.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <h3 className="font-semibold text-red-800">Critical Issues</h3>
                </div>
                <ul className="space-y-1">
                  {matchResult.flags.map((flag: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                      <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Line Items Table */}
            <div>
              <h3 className="mb-3 text-sm font-semibold">Line Item Comparison</h3>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">
                        Item
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">
                        GRN Qty
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">
                        Inv Qty
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">
                        PO Price
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase">
                        Inv Price
                      </th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(matchResult.matchedItems || []).map((item: MatchItem, i: number) => (
                      <tr key={i} className="border-t hover:bg-accent/30">
                        <td className="px-4 py-2.5 text-sm font-medium">{item.poItem}</td>
                        <td className="px-4 py-2.5 text-sm text-right">{item.grnQty}</td>
                        <td className="px-4 py-2.5 text-sm text-right">{item.invQty}</td>
                        <td className="px-4 py-2.5 text-sm text-right">${(item.poPrice || 0).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-sm text-right">${(item.invPrice || 0).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                              statusColor(item.status)
                            )}
                          >
                            {statusLabel(item.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Retry */}
            <div className="text-center">
              <button
                onClick={() => {
                  setMatchResult(null)
                  setPoDoc({ file: null, base64: null, fileName: "", uploaded: false })
                  setGrnDoc({ file: null, base64: null, fileName: "", uploaded: false })
                  setInvDoc({ file: null, base64: null, fileName: "", uploaded: false })
                }}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                <FileText className="h-4 w-4" />
                Start New Match
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
