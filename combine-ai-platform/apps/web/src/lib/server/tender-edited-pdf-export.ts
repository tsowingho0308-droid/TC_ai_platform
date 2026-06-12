import path from "path"
import PDFDocument from "pdfkit"
import {
  TENDER_FIELD_SECTIONS,
  groupFieldsBySection,
} from "@/features/tender/lib/tender-field-sections"

type PdfDoc = InstanceType<typeof PDFDocument>

export interface TenderFieldExport {
  field: string
  value: string
}

export interface TenderEditedPdfInput {
  name: string
  fileName?: string
  fields: TenderFieldExport[]
}

const PAGE_MARGIN = 50
const CONTENT_WIDTH = 495

function getFontPath(): string {
  return path.join(process.cwd(), "public/fonts/NotoSansHK-Regular.otf")
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "tender"
}

export function buildEditedPdfFilename(fileName?: string, name?: string): string {
  if (fileName?.trim()) {
    const base = fileName.replace(/\.[^.]+$/, "")
    return `${sanitizeFilename(base)}-edited.pdf`
  }
  return `${sanitizeFilename(name || "tender")}-edited.pdf`
}

function ensureSpace(doc: PdfDoc, height: number) {
  const bottom = doc.page.height - PAGE_MARGIN
  if (doc.y + height > bottom) {
    doc.addPage()
  }
}

function writeSectionHeader(doc: PdfDoc, label: string) {
  ensureSpace(doc, 28)
  doc
    .moveDown(0.5)
    .fontSize(11)
    .fillColor("#52525b")
    .text(label, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.25)
  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
    .strokeColor("#e4e4e7")
    .stroke()
  doc.moveDown(0.35)
}

function writeFieldRow(doc: PdfDoc, field: string, value: string) {
  ensureSpace(doc, 40)
  doc.fontSize(10).fillColor("#18181b").text(field || "—", PAGE_MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    continued: false,
  })
  doc
    .fontSize(10)
    .fillColor("#3f3f46")
    .text(value || "—", PAGE_MARGIN, doc.y + 2, { width: CONTENT_WIDTH })
  doc.moveDown(0.6)
}

export async function buildEditedTenderPdfBuffer(
  input: TenderEditedPdfInput
): Promise<Buffer> {
  const fontPath = getFontPath()
  const grouped = groupFieldsBySection(input.fields)

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" })
    const chunks: Buffer[] = []

    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    try {
      doc.registerFont("NotoSansHK", fontPath)
      doc.font("NotoSansHK")
    } catch {
      doc.font("Helvetica")
    }

    doc.fontSize(16).fillColor("#18181b").text(input.name || "Tender", {
      width: CONTENT_WIDTH,
    })

    if (input.fileName?.trim()) {
      doc
        .moveDown(0.2)
        .fontSize(9)
        .fillColor("#71717a")
        .text(input.fileName, { width: CONTENT_WIDTH })
    }

    doc
      .moveDown(0.4)
      .fontSize(9)
      .fillColor("#71717a")
      .text(`Exported: ${new Date().toISOString().slice(0, 10)}`, {
        width: CONTENT_WIDTH,
      })

    doc.moveDown(0.8)

    if (input.fields.length === 0) {
      doc.fontSize(11).fillColor("#71717a").text("No fields to export.", {
        width: CONTENT_WIDTH,
      })
      doc.end()
      return
    }

    for (const section of TENDER_FIELD_SECTIONS) {
      const rows = grouped.get(section.id) ?? []
      if (section.id === "other" && rows.length === 0) continue

      writeSectionHeader(doc, section.label)

      if (rows.length === 0) {
        doc.fontSize(9).fillColor("#a1a1aa").text("No fields in this section.", {
          width: CONTENT_WIDTH,
        })
        doc.moveDown(0.4)
        continue
      }

      for (const row of rows) {
        writeFieldRow(doc, row.field, row.value)
      }
    }

    doc.end()
  })
}
