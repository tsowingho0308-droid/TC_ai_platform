import { PDFParse } from "pdf-parse"
import mammoth from "mammoth"

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
])

export const MIN_DOCUMENT_TEXT_LENGTH = 50

export const TEXT_EXTRACTION_ERROR =
  "Could not extract readable text from document. Try a text-based PDF or DOCX."

export const SCANNED_PDF_ERROR =
  "PDF appears to be image-only (scanned); no text layer found. Try a text-based PDF or DOCX."

export function validateDocumentText(documentText?: string): string | null {
  if ((documentText || "").trim().length < MIN_DOCUMENT_TEXT_LENGTH) {
    return TEXT_EXTRACTION_ERROR
  }
  return null
}

export function isSupportedDocumentMimeType(mimeType: string, fileName: string) {
  const normalized = mimeType.toLowerCase()
  if (SUPPORTED_MIME_TYPES.has(normalized)) return true
  const lower = fileName.toLowerCase()
  return lower.endsWith(".pdf") || lower.endsWith(".txt") || lower.endsWith(".docx") || lower.endsWith(".doc")
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const text = (result.text || "").trim()
    if (text.length === 0 && result.total > 0) {
      throw new Error(SCANNED_PDF_ERROR)
    }
    return text
  } catch (err) {
    if (err instanceof Error && err.message === SCANNED_PDF_ERROR) {
      throw err
    }
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`PDF extraction failed: ${detail}`)
  } finally {
    await parser.destroy()
  }
}

export async function extractTextFromDocument(buffer: Buffer, fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase()
  const normalizedMime = mimeType.toLowerCase()

  if (normalizedMime.includes("pdf") || lowerName.endsWith(".pdf")) {
    return extractPdfText(buffer)
  }

  if (
    normalizedMime.includes("wordprocessingml") ||
    normalizedMime.includes("msword") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc")
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer })
      return (result.value || "").trim()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`DOCX extraction failed: ${detail}`)
    }
  }

  if (normalizedMime.startsWith("text/") || lowerName.endsWith(".txt")) {
    return buffer.toString("utf8").trim()
  }

  throw new Error(`Unsupported document type: ${mimeType || fileName}`)
}
