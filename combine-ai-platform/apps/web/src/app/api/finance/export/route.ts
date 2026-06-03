import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

/**
 * Generate an XLSX report for expense review or 3-way match sessions.
 * Uses a simple CSV-based approach for XLSX generation (no external dependency needed).
 * For production, replace with exceljs or xlsx package for proper .xlsx format.
 */
function generateCsvReport(rows: Array<{ field: string; value: string }>, headers: string[]): string {
  const lines: string[] = []
  lines.push(headers.join(","))
  for (const row of rows) {
    const escapedField = `"${(row.field || "").replace(/"/g, '""')}"`
    const escapedValue = `"${(row.value || "").replace(/"/g, '""')}"`
    lines.push(`${escapedField},${escapedValue}`)
  }
  return lines.join("\n")
}

function generatePolicyReport(
  policyResults: Array<{ rule: string; passed: boolean; detail: string }>
): string {
  const lines: string[] = []
  lines.push("Rule,Status,Detail")
  for (const p of policyResults) {
    const escapedRule = `"${(p.rule || "").replace(/"/g, '""')}"`
    const escapedDetail = `"${(p.detail || "").replace(/"/g, '""')}"`
    lines.push(`${escapedRule},${p.passed ? "Passed" : "Failed"},${escapedDetail}`)
  }
  return lines.join("\n")
}

function generateThreeWayReport(matchResult: Record<string, unknown>): string {
  const lines: string[] = []

  // Summary section
  const summary = (matchResult.summary || {}) as Record<string, unknown>
  lines.push("=== 3-Way Match Summary ===")
  lines.push(`Total Matches,${summary.totalMatchCount || 0}`)
  lines.push(`Discrepancies,${summary.discrepancyCount || 0}`)
  lines.push(`Total PO Amount,${summary.totalPOAmount || 0}`)
  lines.push(`Total Invoice Amount,${summary.totalInvAmount || 0}`)
  lines.push(`Variance,${summary.variance || 0}`)
  lines.push("")

  // Matched items
  const items = (matchResult.matchedItems || []) as Array<Record<string, unknown>>
  if (items.length > 0) {
    lines.push("=== Line Items ===")
    lines.push("PO Item,GRN Qty,Invoice Qty,PO Price,Invoice Price,Status")
    for (const item of items) {
      lines.push(
        `"${item.poItem || ""}",${item.grnQty || 0},${item.invQty || 0},${item.poPrice || 0},${item.invPrice || 0},"${item.status || ""}"`
      )
    }
    lines.push("")
  }

  // Flags
  const flags = (matchResult.flags || []) as string[]
  if (flags.length > 0) {
    lines.push("=== Critical Flags ===")
    flags.forEach((f: string) => lines.push(`"${f}"`))
  }

  return lines.join("\n")
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      sessionId: string
      format?: string
      includePolicyCheck?: boolean
    }
    const { sessionId, includePolicyCheck } = body

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const financeSession = await prisma.financeSession.findFirst({
      where: { id: sessionId, workspaceId: session.workspaceId },
    })

    if (!financeSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    let csvContent = ""

    if (financeSession.sessionType === "THREE_WAY_MATCH") {
      // 3-way match report
      const matchData = (financeSession.extractedRows || {}) as Record<string, unknown>
      csvContent = generateThreeWayReport(matchData)
    } else {
      // Expense review report
      const rows = (financeSession.extractedRows || []) as Array<{ field: string; value: string }>
      csvContent = generateCsvReport(rows, ["Field", "Value"])

      // Append policy check if requested
      if (includePolicyCheck && financeSession.policyResults) {
        const policyResults = financeSession.policyResults as Array<{
          rule: string; passed: boolean; detail: string
        }>
        csvContent += "\n\n" + generatePolicyReport(policyResults)
      }
    }

    // Add BOM for Excel CJK support
    const BOM = "﻿"
    const buffer = Buffer.from(BOM + csvContent, "utf-8")

    const fileName =
      financeSession.sessionType === "THREE_WAY_MATCH"
        ? `three-way-match-${sessionId.slice(0, 8)}.csv`
        : `expense-review-${sessionId.slice(0, 8)}.csv`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
      },
    })
  } catch (error) {
    console.error("Finance export error:", error)
    return NextResponse.json(
      {
        error: "Export failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
