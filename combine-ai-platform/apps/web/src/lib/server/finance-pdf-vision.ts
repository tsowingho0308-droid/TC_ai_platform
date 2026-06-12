import sharp from "sharp"

const MAX_RENDERED_PDF_PAGES = 6
const MAX_IMAGE_WIDTH = 1400

export type ExtractedFinanceRow = { field: string; value: string }

export type VisionExtractionResult = {
  documentType?: string
  rows?: ExtractedFinanceRow[]
  currency?: string
  taxId?: string
}

export async function renderPdfPagesAsJpegDataUrls(buffer: Buffer): Promise<string[]> {
  const { PDFiumLibrary } = await import("@hyzyla/pdfium")
  const library = await PDFiumLibrary.init()
  const document = await library.loadDocument(buffer)
  const dataUrls: string[] = []

  try {
    for (const page of document.pages()) {
      if (dataUrls.length >= MAX_RENDERED_PDF_PAGES) break

      const image = await page.render({
        scale: 2,
        render: async (options) =>
          sharp(options.data, {
            raw: {
              width: options.width,
              height: options.height,
              channels: 4,
            },
          })
            .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer(),
      })

      const jpegBase64 = Buffer.from(image.data).toString("base64")
      dataUrls.push(`data:image/jpeg;base64,${jpegBase64}`)
    }
  } finally {
    document.destroy()
    library.destroy()
  }

  if (dataUrls.length === 0) {
    throw new Error("No PDF pages could be rendered for scanning.")
  }

  return dataUrls
}

export function prefixReceiptRows(
  rows: ExtractedFinanceRow[],
  receiptLabel: string
): ExtractedFinanceRow[] {
  return rows.map((row) => ({
    field: `${receiptLabel} - ${row.field}`,
    value: row.value,
  }))
}

export async function mergeVisionPageResults(
  pageResults: VisionExtractionResult[],
  options?: { multiReceipt?: boolean }
): Promise<VisionExtractionResult> {
  const multiReceipt = options?.multiReceipt ?? pageResults.length > 1
  const mergedRows: ExtractedFinanceRow[] = []

  pageResults.forEach((result, index) => {
    const pageRows = result.rows || []
    const receiptLabel = multiReceipt ? `Receipt ${index + 1}` : "Receipt 1"
    mergedRows.push(...prefixReceiptRows(pageRows, receiptLabel))
  })

  const first = pageResults[0] || {}
  return {
    documentType: first.documentType || "receipt",
    currency: first.currency || "",
    taxId: first.taxId || "",
    rows: mergedRows,
  }
}
