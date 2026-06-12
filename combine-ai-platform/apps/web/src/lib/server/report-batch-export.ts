import * as XLSX from "xlsx"
import { parseReportDraftNote } from "@/features/report/lib/report-draft-note"

export interface ReportSessionExport {
  id: string
  title: string
  rows?: Array<{ field: string; value: string }>
  draftNote?: string | null
}

function sanitizeSheetName(title: string, used: Set<string>): string {
  let name = title.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Report"
  let candidate = name
  let n = 2
  while (used.has(candidate)) {
    const suffix = ` ${n}`
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`
    n++
  }
  used.add(candidate)
  return candidate
}

export function buildBatchMarkdown(
  sessions: ReportSessionExport[],
  includeSummaries = true
): string {
  const lines: string[] = ["# Integrated Report", ""]

  for (const session of sessions) {
    lines.push(`## ${session.title}`, "")

    if (includeSummaries) {
      const draft = parseReportDraftNote(session.draftNote)
      if (draft?.summary) {
        lines.push("### Summary", "", draft.summary, "")
      }
      if (draft?.keyPoints && draft.keyPoints.length > 0) {
        lines.push("### Key Points", "")
        for (const point of draft.keyPoints) {
          lines.push(`- ${point}`)
        }
        lines.push("")
      }
      if (draft?.kbReferences && draft.kbReferences.length > 0) {
        lines.push("### References", "")
        for (const ref of draft.kbReferences) {
          lines.push(
            `- **${ref.articleTitle}** (${ref.knowledgeBaseName}) — ${ref.relevance}`
          )
        }
        lines.push("")
      }
    }

    const rows = session.rows || []
    if (rows.length > 0) {
      lines.push("### Extracted Fields", "", "| Field | Value |", "| --- | --- |")
      for (const row of rows) {
        const field = (row.field || "").replace(/\|/g, "\\|")
        const value = (row.value || "").replace(/\|/g, "\\|")
        lines.push(`| ${field} | ${value} |`)
      }
      lines.push("")
    } else {
      lines.push("_No extracted fields._", "")
    }
  }

  return lines.join("\n")
}

export function buildBatchXlsx(sessions: ReportSessionExport[], includeSummaries = true): Buffer {
  const workbook = XLSX.utils.book_new()
  const usedNames = new Set<string>()

  for (const session of sessions) {
    const sheetData: string[][] = [[session.title], [""]]

    if (includeSummaries) {
      const draft = parseReportDraftNote(session.draftNote)
      if (draft?.summary) {
        sheetData.push(["Summary"], [draft.summary], [""])
      }
      if (draft?.keyPoints && draft.keyPoints.length > 0) {
        sheetData.push(["Key Points"])
        for (const point of draft.keyPoints) {
          sheetData.push([point])
        }
        sheetData.push([""])
      }
    }

    sheetData.push(["Field", "Value"])
    const rows = session.rows || []
    if (rows.length === 0) {
      sheetData.push(["(no data)", ""])
    } else {
      for (const row of rows) {
        sheetData.push([row.field || "", row.value || ""])
      }
    }

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData)
    worksheet["!cols"] = [{ wch: 30 }, { wch: 50 }]
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      sanitizeSheetName(session.title, usedNames)
    )
  }

  if (workbook.SheetNames.length === 0) {
    const worksheet = XLSX.utils.aoa_to_sheet([["No sessions selected"]])
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report")
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
}
