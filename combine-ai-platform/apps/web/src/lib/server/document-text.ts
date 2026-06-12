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

export type DocumentKind = "pdf" | "word" | "image" | "text" | "unknown"

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

function isZipArchive(buffer: Buffer) {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
}

function isOleCompoundDocument(buffer: Buffer) {
  return buffer.length >= 2 && buffer[0] === 0xd0 && buffer[1] === 0xcf
}

function isPdfBuffer(buffer: Buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString() === "%PDF"
}

function isJpegBuffer(buffer: Buffer) {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8
}

function isPngBuffer(buffer: Buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
}

export function inferDocumentMimeType(mimeType: string, fileName: string, buffer?: Buffer) {
  const lowerName = fileName.toLowerCase()
  const normalizedMime = (mimeType || "").toLowerCase()

  if (buffer) {
    if (isPdfBuffer(buffer)) return "application/pdf"
    if (isJpegBuffer(buffer)) return "image/jpeg"
    if (isPngBuffer(buffer)) return "image/png"
    if (isZipArchive(buffer)) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
    if (isOleCompoundDocument(buffer)) return "application/msword"
  }

  if (normalizedMime.startsWith("image/")) return normalizedMime
  if (normalizedMime.includes("pdf")) return "application/pdf"
  if (normalizedMime.includes("wordprocessingml")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (normalizedMime.includes("msword")) return "application/msword"
  if (normalizedMime.startsWith("text/")) return normalizedMime

  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg"
  if (lowerName.endsWith(".png")) return "image/png"
  if (lowerName.endsWith(".webp")) return "image/webp"
  if (lowerName.endsWith(".gif")) return "image/gif"
  if (lowerName.endsWith(".pdf")) return "application/pdf"
  if (lowerName.endsWith(".txt")) return "text/plain"
  if (lowerName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (lowerName.endsWith(".doc")) return "application/msword"

  return normalizedMime || "application/octet-stream"
}

export function detectDocumentKind(buffer: Buffer, mimeType: string, fileName: string): DocumentKind {
  const normalizedMime = inferDocumentMimeType(mimeType, fileName, buffer)
  const lowerName = fileName.toLowerCase()

  if (normalizedMime.startsWith("image/")) return "image"
  if (normalizedMime.includes("pdf") || lowerName.endsWith(".pdf") || isPdfBuffer(buffer)) {
    return "pdf"
  }
  if (
    normalizedMime.includes("wordprocessingml") ||
    normalizedMime.includes("msword") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    isZipArchive(buffer) ||
    isOleCompoundDocument(buffer)
  ) {
    return "word"
  }
  if (normalizedMime.startsWith("text/") || lowerName.endsWith(".txt")) return "text"
  return "unknown"
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

async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer })
    return (result.value || "").trim()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`DOCX extraction failed: ${detail}`)
  }
}

async function extractLegacyDocText(buffer: Buffer): Promise<string> {
  try {
    const WordExtractor = (await import("word-extractor")).default
    const extractor = new WordExtractor()
    const doc = await extractor.extract(buffer)
    return [doc.getBody(), doc.getHeaders(), doc.getFootnotes()]
      .filter(Boolean)
      .join("\n")
      .trim()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`DOC extraction failed: ${detail}`)
  }
}

export async function extractImagesFromDocx(buffer: Buffer): Promise<string[]> {
  const images: string[] = []

  await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement((image) =>
        image.read("base64").then((imageBuffer) => {
          images.push(`data:${image.contentType};base64,${imageBuffer}`)
          return { src: "" }
        })
      ),
    }
  )

  return images
}

export async function extractTextFromDocument(buffer: Buffer, fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase()
  const normalizedMime = inferDocumentMimeType(mimeType, fileName, buffer)

  if (normalizedMime.includes("pdf") || lowerName.endsWith(".pdf") || isPdfBuffer(buffer)) {
    return extractPdfText(buffer)
  }

  if (
    normalizedMime.includes("wordprocessingml") ||
    lowerName.endsWith(".docx") ||
    (isZipArchive(buffer) && !lowerName.endsWith(".doc"))
  ) {
    return extractDocxText(buffer)
  }

  if (normalizedMime.includes("msword") || lowerName.endsWith(".doc") || isOleCompoundDocument(buffer)) {
    return extractLegacyDocText(buffer)
  }

  if (normalizedMime.startsWith("text/") || lowerName.endsWith(".txt")) {
    return buffer.toString("utf8").trim()
  }

  throw new Error(`Unsupported document type: ${mimeType || fileName}`)
}
