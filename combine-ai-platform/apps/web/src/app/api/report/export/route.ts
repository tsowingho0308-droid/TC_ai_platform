import { NextResponse } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { prisma } from "@/lib/server/prisma"
import {
  buildBatchMarkdown,
  buildBatchXlsx,
} from "@/lib/server/report-batch-export"
import { buildReportDocx } from "@/lib/server/report-docx-export"
import * as XLSX from "xlsx"

export const dynamic = "force-dynamic"

function buildReportSummaryBody(params: {
  fileName?: string
  summary: string
  rows?: Array<{ field: string; value: string }>
  keyPoints?: string[]
  kbReferences?: Array<{
    articleTitle: string
    knowledgeBaseName: string
    relevance: string
  }>
}): { title: string; bodyText: string } {
  const { fileName, summary, rows, keyPoints, kbReferences } = params
  const title = `Report Summary — ${fileName || "document"}`
  const lines: string[] = []

  if (rows && rows.length > 0) {
    lines.push("## 抽取欄位", "")
    for (const row of rows) {
      lines.push(`- ${row.field || ""}: ${row.value || ""}`)
    }
    lines.push("")
  }

  lines.push("## 總述", summary, "")

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

  return { title, bodyText: lines.join("\n") }
}

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as {
      rows?: Array<{ field: string; value: string }>
      format?: "xlsx" | "csv" | "md" | "docx" | "batch-md" | "batch-xlsx"
      summary?: string
      keyPoints?: string[]
      kbReferences?: Array<{
        articleTitle: string
        knowledgeBaseName: string
        relevance: string
      }>
      fileName?: string
      sessionIds?: string[]
      includeSummaries?: boolean
    }

    const {
      rows,
      format,
      summary,
      keyPoints,
      kbReferences,
      fileName,
      sessionIds,
      includeSummaries = true,
    } = body
    const exportFormat = format || "xlsx"

    if (exportFormat === "batch-md" || exportFormat === "batch-xlsx") {
      if (!sessionIds || sessionIds.length === 0) {
        return NextResponse.json({ error: "sessionIds required for batch export" }, { status: 400 })
      }

      const sessions = await prisma.reportSession.findMany({
        where: {
          id: { in: sessionIds },
          workspaceId: session.workspaceId,
        },
        select: {
          id: true,
          title: true,
          rows: true,
          draftNote: true,
        },
      })

      if (sessions.length === 0) {
        return NextResponse.json({ error: "No sessions found" }, { status: 404 })
      }

      const ordered = sessionIds
        .map((id) => sessions.find((s) => s.id === id))
        .filter((s): s is (typeof sessions)[number] => Boolean(s))
        .map((s) => ({
          id: s.id,
          title: s.title,
          rows: (s.rows as Array<{ field: string; value: string }> | null) || undefined,
          draftNote: s.draftNote,
        }))

      if (exportFormat === "batch-md") {
        const markdown = buildBatchMarkdown(ordered, includeSummaries)
        return new NextResponse(markdown, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="integrated-report-${Date.now()}.md"`,
          },
        })
      }

      const buffer = buildBatchXlsx(ordered, includeSummaries)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="integrated-report-${Date.now()}.xlsx"`,
        },
      })
    }

    if (exportFormat === "md" || exportFormat === "docx") {
      if (!summary) {
        return NextResponse.json({ error: "summary required for report export" }, { status: 400 })
      }

      const { title, bodyText } = buildReportSummaryBody({
        fileName,
        summary,
        rows,
        keyPoints,
        kbReferences,
      })

      if (exportFormat === "docx") {
        const docxBuffer = await buildReportDocx({ title, bodyText })
        return new NextResponse(new Uint8Array(docxBuffer), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="report-summary-${Date.now()}.docx"`,
          },
        })
      }

      const markdown = `# ${title}\n\n${bodyText}`
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
