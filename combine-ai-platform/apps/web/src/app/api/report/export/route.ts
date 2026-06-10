import { NextResponse } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import * as XLSX from "xlsx"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as {
      rows?: Array<{ field: string; value: string }>
      format?: "xlsx" | "csv" | "md"
      summary?: string
      keyPoints?: string[]
      kbReferences?: Array<{
        articleTitle: string
        knowledgeBaseName: string
        relevance: string
      }>
      fileName?: string
    }

    const { rows, format, summary, keyPoints, kbReferences, fileName } = body
    const exportFormat = format || "xlsx"

    if (exportFormat === "md") {
      if (!summary) {
        return NextResponse.json({ error: "summary required for md export" }, { status: 400 })
      }

      const lines = [
        `# Report Summary — ${fileName || "document"}`,
        "",
        "## 總述",
        summary,
        "",
      ]

      if (keyPoints && keyPoints.length > 0) {
        lines.push("## 知識庫相關要點", "")
        for (const point of keyPoints) {
          lines.push(`- ${point}`)
        }
        lines.push("")
      }

      if (kbReferences && kbReferences.length > 0) {
        lines.push("## 參考條文", "")
        for (const ref of kbReferences) {
          lines.push(`- **${ref.articleTitle}** (${ref.knowledgeBaseName}) — ${ref.relevance}`)
        }
        lines.push("")
      }

      const markdown = lines.join("\n")
      return new NextResponse(markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="report-summary-${Date.now()}.md"`,
        },
      })
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 })
    }

    // Build worksheet data: header row + data rows
    const sheetData: string[][] = [["Field", "Value"]]
    for (const row of rows) {
      sheetData.push([row.field || "", row.value || ""])
    }

    if (exportFormat === "csv") {
      const csv = sheetData
        .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
        .join("\n")
      const bom = "﻿"

      return new NextResponse(bom + csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="report-export-${Date.now()}.csv"`,
        },
      })
    }

    // Generate XLSX using SheetJS
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData)

    // Set column widths
    worksheet["!cols"] = [
      { wch: 30 }, // Field column
      { wch: 50 }, // Value column
    ]

    XLSX.utils.book_append_sheet(workbook, worksheet, "Report")
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="report-export-${Date.now()}.xlsx"`,
      },
    })
  } catch (error) {
    console.error("Export error:", error)
    return NextResponse.json(
      { error: "Export failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
