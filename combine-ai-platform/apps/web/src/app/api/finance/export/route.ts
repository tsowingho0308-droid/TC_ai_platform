import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import {
  getPolicyExportBlockers,
  validateSubmitterInfo,
  type ExpenseExportSubmitterInfo,
  type PolicyResult,
} from "@/features/finance/policy-export"
import { normalizeExtractedRows } from "@/features/finance/extracted-rows"
import * as XLSX from "xlsx-js-style"

export const dynamic = "force-dynamic"

type Row = { field: string; value: string }
type ParsedRow = { source: string; field: string; value: string }

const SUMMARY_FIELD_ORDER = [
  "vendor name",
  "invoice number",
  "receipt number",
  "date",
  "time",
  "currency",
  "subtotal",
  "tax rate",
  "tax amount",
  "total amount",
  "payment method",
  "tax id",
]

const KEY_DETAIL_FIELDS = [
  "vendor name",
  "receipt number",
  "invoice number",
  "date",
  "time",
  "total amount",
  "currency",
  "tax amount",
  "tax rate",
  "subtotal",
  "payment method",
]

function normalizeFieldLabel(field: string): string {
  return field
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function fieldMatches(field: string, key: string): boolean {
  return field.toLowerCase().includes(key)
}

function findSummaryRow(rows: ParsedRow[], key: string): ParsedRow | undefined {
  return rows.find((row) => fieldMatches(row.field, key))
}

function rowsToCsv(sheetData: string[][]): string {
  return sheetData
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n")
}

function parseRow(row: Row): ParsedRow {
  const separator = " · "
  const index = row.field.indexOf(separator)
  if (index >= 0) {
    return {
      source: row.field.slice(0, index).trim(),
      field: row.field.slice(index + separator.length).trim(),
      value: row.value,
    }
  }
  return { source: "Document", field: row.field.trim(), value: row.value }
}

function sortSummaryFields(a: string, b: string) {
  const aIndex = SUMMARY_FIELD_ORDER.findIndex((key) => a.toLowerCase().includes(key))
  const bIndex = SUMMARY_FIELD_ORDER.findIndex((key) => b.toLowerCase().includes(key))
  const normalizedA = aIndex === -1 ? 999 : aIndex
  const normalizedB = bIndex === -1 ? 999 : bIndex
  if (normalizedA !== normalizedB) return normalizedA - normalizedB
  return a.localeCompare(b)
}

function buildLineItemsTable(parsedRows: ParsedRow[]) {
  const items = new Map<
    number,
    { source: string; description: string; quantity: string; unitPrice: string; amount: string }
  >()

  for (const row of parsedRows) {
    const match = row.field.match(/^Item (\d+) - (Description|Quantity|Unit Price|Amount)$/i)
    if (!match) continue

    const itemNumber = Number(match[1])
    const attribute = match[2].toLowerCase()
    const current = items.get(itemNumber) || {
      source: row.source,
      description: "",
      quantity: "",
      unitPrice: "",
      amount: "",
    }

    if (attribute === "description") current.description = row.value
    if (attribute === "quantity") current.quantity = row.value
    if (attribute === "unit price") current.unitPrice = row.value
    if (attribute === "amount") current.amount = row.value

    items.set(itemNumber, current)
  }

  const header = ["Item #", "Description", "Quantity", "Unit Price", "Amount"]
  const hasMultipleSources = new Set([...items.values()].map((item) => item.source)).size > 1
  if (hasMultipleSources) header.push("Source")

  const table: string[][] = [header]
  for (const [itemNumber, item] of [...items.entries()].sort((a, b) => a[0] - b[0])) {
    const row = [
      String(itemNumber),
      item.description,
      item.quantity,
      item.unitPrice,
      item.amount,
    ]
    if (hasMultipleSources) row.push(item.source)
    table.push(row)
  }

  return table
}

function buildSubmitterSection(info: ExpenseExportSubmitterInfo): string[][] {
  const section: string[][] = [
    ["Submitter Information"],
    ["Field", "Value"],
    ["Full Name", info.fullName],
    ["Email", info.email],
    ["Person In Charge", info.personInChargeName],
    ["Person In Charge Email", info.personInChargeEmail],
  ]

  if (info.additionalNotes?.trim()) {
    section.push(["Additional Notes", info.additionalNotes.trim()])
  }

  return section
}

const SECTION_HEADER_STYLE = {
  font: { bold: true, sz: 12, color: { rgb: "1F2937" } },
  fill: { patternType: "solid", fgColor: { rgb: "DBEAFE" } },
}

const NAME_LABEL_STYLE = {
  font: { bold: true, color: { rgb: "1F2937" } },
}

const HIGHLIGHT_NAME_STYLE = {
  font: { bold: true, color: { rgb: "92400E" } },
  fill: { patternType: "solid", fgColor: { rgb: "FEF3C7" } },
}

function applyCellStyle(
  worksheet: XLSX.WorkSheet,
  row: number,
  col: number,
  style: Record<string, unknown>
) {
  const address = XLSX.utils.encode_cell({ r: row, c: col })
  const cell = worksheet[address]
  if (!cell) return
  cell.s = style
}

function applyExpenseReportStyles(worksheet: XLSX.WorkSheet, data: string[][]) {
  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const label = String(data[rowIndex][0] ?? "")

    if (label === "Submitter Information" || label === "Expense Review Report") {
      applyCellStyle(worksheet, rowIndex, 0, SECTION_HEADER_STYLE)
      continue
    }

    if (label === "Full Name" || label === "Person In Charge") {
      applyCellStyle(worksheet, rowIndex, 0, NAME_LABEL_STYLE)
      applyCellStyle(worksheet, rowIndex, 1, HIGHLIGHT_NAME_STYLE)
    }
  }
}

function buildExpenseSheets(
  rows: Row[],
  options: {
    sessionTitle?: string
    policyResults?: Array<{ rule: string; passed: boolean; detail: string }> | null
    submitterInfo?: ExpenseExportSubmitterInfo | null
  }
) {
  const parsedRows = rows.map(parseRow)
  const sources = [...new Set(parsedRows.map((row) => row.source))]
  const hasMultipleSources = sources.length > 1
  const documentLabel =
    sources.length === 1 && sources[0] !== "Document" ? sources[0] : `${sources.length || 1} document(s)`

  const summaryRows: ParsedRow[] = []
  for (const row of parsedRows) {
    if (/^Item \d+ - /i.test(row.field)) continue
    summaryRows.push(row)
  }

  summaryRows.sort((a, b) => sortSummaryFields(a.field, b.field))

  const lineItemsTable = buildLineItemsTable(parsedRows)
  const report: string[][] = []

  if (options.submitterInfo) {
    report.push(...buildSubmitterSection(options.submitterInfo))
    report.push([])
  }

  report.push(
    ["Expense Review Report"],
    [],
    ["Session", options.sessionTitle || "Expense Review"],
    ["Document", documentLabel],
    ["Exported", new Date().toLocaleString("en-HK")],
    [],
    ["Key Details"],
    ["Field", "Value"]
  )

  const usedKeys = new Set<string>()
  for (const key of KEY_DETAIL_FIELDS) {
    const row = findSummaryRow(summaryRows, key)
    if (!row || !row.value.trim()) continue
    usedKeys.add(row.field.toLowerCase())
    const line = [normalizeFieldLabel(row.field), row.value]
    if (hasMultipleSources) line.push(row.source)
    report.push(line)
  }

  if (lineItemsTable.length > 1) {
    report.push([])
    report.push(["Line Items"])
    report.push(...lineItemsTable)
  }

  const additionalRows = summaryRows.filter((row) => !usedKeys.has(row.field.toLowerCase()))
  if (additionalRows.length > 0) {
    report.push([])
    report.push(["Additional Details"])
    report.push(["Field", "Value"])
    if (hasMultipleSources) report[report.length - 1].push("Source")

    for (const row of additionalRows) {
      const line = [normalizeFieldLabel(row.field), row.value]
      if (hasMultipleSources) line.push(row.source)
      report.push(line)
    }
  }

  if (options.policyResults && options.policyResults.length > 0) {
    const passedCount = options.policyResults.filter((policy) => policy.passed).length
    report.push([])
    report.push(["Policy Check", `${passedCount}/${options.policyResults.length} passed`])
    report.push(["Rule", "Status", "Detail"])
    for (const policy of options.policyResults) {
      report.push([
        policy.rule || "",
        policy.passed ? "Passed" : "Failed",
        policy.detail || "",
      ])
    }
  }

  return { Report: report }
}

function buildThreeWaySheets(matchResult: Record<string, unknown>) {
  const summary = (matchResult.summary || {}) as Record<string, unknown>
  const items = (matchResult.matchedItems || []) as Array<Record<string, unknown>>
  const flags = (matchResult.flags || []) as string[]

  const sheets: Record<string, string[][]> = {
    Overview: [
      ["3-Way Match Report"],
      [""],
      ["Exported At", new Date().toLocaleString("en-HK")],
      ["Total Matches", String(summary.totalMatchCount ?? 0)],
      ["Discrepancies", String(summary.discrepancyCount ?? 0)],
      ["Variance", String(summary.variance ?? 0)],
    ],
    Summary: [
      ["Metric", "Value"],
      ["Total Matches", String(summary.totalMatchCount ?? 0)],
      ["Discrepancies", String(summary.discrepancyCount ?? 0)],
      ["Total PO Amount", String(summary.totalPOAmount ?? 0)],
      ["Total Invoice Amount", String(summary.totalInvAmount ?? 0)],
      ["Variance", String(summary.variance ?? 0)],
    ],
    "Line Items": [
      ["PO Item", "GRN Qty", "Invoice Qty", "PO Price", "Invoice Price", "Status"],
      ...items.map((item) => [
        String(item.poItem ?? ""),
        String(item.grnQty ?? 0),
        String(item.invQty ?? 0),
        String(item.poPrice ?? 0),
        String(item.invPrice ?? 0),
        String(item.status ?? ""),
      ]),
    ],
  }

  if (flags.length > 0) {
    sheets.Flags = [["Critical Issue"], ...flags.map((flag) => [flag])]
  }

  return sheets
}

function buildWorkbook(
  sheets: Record<string, string[][]>,
  options?: { styleExpenseReport?: boolean }
) {
  const workbook = XLSX.utils.book_new()
  for (const [name, data] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.aoa_to_sheet(data)
    worksheet["!cols"] = data.reduce<Array<{ wch: number }>>((widths, row) => {
      row.forEach((cell, index) => {
        const length = String(cell ?? "").length + 2
        widths[index] = { wch: Math.max(widths[index]?.wch || 12, Math.min(length, 52)) }
      })
      return widths
    }, [])

    if (options?.styleExpenseReport && name === "Report") {
      applyExpenseReportStyles(worksheet, data)
    }

    const keyDetailsHeaderIndex = data.findIndex(
      (row, index) =>
        row[0] === "Key Details" &&
        data[index + 1]?.[0] === "Field" &&
        data[index + 1]?.[1] === "Value"
    )
    if (keyDetailsHeaderIndex >= 0) {
      worksheet["!freeze"] = {
        xSplit: 0,
        ySplit: keyDetailsHeaderIndex + 2,
        topLeftCell: `A${keyDetailsHeaderIndex + 3}`,
        activePane: "bottomLeft",
        state: "frozen",
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31))
  }
  return workbook
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      sessionId: string
      format?: "xlsx" | "csv"
      includePolicyCheck?: boolean
      requirePolicyPass?: boolean
      submitterInfo?: ExpenseExportSubmitterInfo
    }
    const { sessionId, includePolicyCheck, requirePolicyPass, submitterInfo } = body
    const exportFormat = body.format || "xlsx"

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const financeSession = await prisma.financeSession.findFirst({
      where: { id: sessionId, workspaceId: session.workspaceId },
    })

    if (!financeSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const baseName =
      financeSession.sessionType === "THREE_WAY_MATCH"
        ? `three-way-match-${sessionId.slice(0, 8)}`
        : `expense-review-${sessionId.slice(0, 8)}`

    if (financeSession.sessionType === "EXPENSE_REVIEW") {
      const policyResults =
        (financeSession.policyResults as Array<{ rule: string; passed: boolean; detail: string }> | null) || []

      if (requirePolicyPass !== false) {
        const blockers = getPolicyExportBlockers(policyResults)
        if (blockers.length > 0) {
          return NextResponse.json(
            { error: "Policy check required before export", blockers },
            { status: 403 }
          )
        }

        if (!submitterInfo) {
          return NextResponse.json(
            {
              error: "Submitter information required before export",
              blockers: ["Please complete the export form before downloading."],
            },
            { status: 400 }
          )
        }
      }

      if (submitterInfo) {
        const validationErrors = validateSubmitterInfo(submitterInfo)
        if (validationErrors.length > 0) {
          return NextResponse.json(
            { error: validationErrors[0], blockers: validationErrors },
            { status: 400 }
          )
        }
      }
    }

    const sheets =
      financeSession.sessionType === "THREE_WAY_MATCH"
        ? buildThreeWaySheets((financeSession.extractedRows || {}) as Record<string, unknown>)
        : buildExpenseSheets(normalizeExtractedRows(financeSession.extractedRows), {
            sessionTitle: financeSession.title,
            policyResults: includePolicyCheck
              ? (financeSession.policyResults as Array<{ rule: string; passed: boolean; detail: string }> | null)
              : null,
            submitterInfo: submitterInfo || null,
          })

    if (exportFormat === "csv") {
      const csvParts = Object.entries(sheets).map(([name, data]) => {
        return `=== ${name} ===\n${rowsToCsv(data)}`
      })
      const buffer = Buffer.from("\ufeff" + csvParts.join("\n\n"), "utf-8")

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.csv"`,
          "Content-Length": String(buffer.length),
        },
      })
    }

    const workbook = buildWorkbook(sheets, {
      styleExpenseReport: financeSession.sessionType === "EXPENSE_REVIEW",
    })
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
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
