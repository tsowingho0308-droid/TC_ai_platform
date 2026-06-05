import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import mammoth from "mammoth"
import { PDFParse } from "pdf-parse"

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
])

let pdfWorkerReady = false

function resolvePdfWorkerUrl() {
  const candidates = [
    join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    join(process.cwd(), "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    join(process.cwd(), "../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href
    }
  }

  throw new Error("pdf.worker.mjs not found — run npm install")
}

function ensurePdfWorker() {
  if (pdfWorkerReady) return
  PDFParse.setWorker(resolvePdfWorkerUrl())
  pdfWorkerReady = true
}

export function isSupportedDocumentMimeType(mimeType: string, fileName: string) {
  const normalized = mimeType.toLowerCase()
  if (SUPPORTED_MIME_TYPES.has(normalized)) return true
  const lower = fileName.toLowerCase()
  return lower.endsWith(".pdf") || lower.endsWith(".txt") || lower.endsWith(".docx") || lower.endsWith(".doc")
}

export async function extractTextFromDocument(buffer: Buffer, fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase()
  const normalizedMime = mimeType.toLowerCase()

  if (normalizedMime.includes("pdf") || lowerName.endsWith(".pdf")) {
    ensurePdfWorker()
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return (result.text || "").trim()
    } finally {
      await parser.destroy()
    }
  }

  if (
    normalizedMime.includes("wordprocessingml") ||
    normalizedMime.includes("msword") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc")
  ) {
    const result = await mammoth.extractRawText({ buffer })
    return (result.value || "").trim()
  }

  if (normalizedMime.startsWith("text/") || lowerName.endsWith(".txt")) {
    return buffer.toString("utf8").trim()
  }

  throw new Error(`Unsupported document type: ${mimeType || fileName}`)
}
