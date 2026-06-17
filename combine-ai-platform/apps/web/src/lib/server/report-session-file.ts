import path from "path"
import fs from "fs"

export const REPORTS_DATA_DIR = path.resolve(process.cwd(), "data", "reports")

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
}

export type StoredReportFile = {
  filePath: string
  storedName: string
  extension: string
  mimeType: string
}

export function getMimeTypeForExtension(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || "application/octet-stream"
}

export function findStoredReportFile(sessionId: string): StoredReportFile | null {
  const dir = path.join(REPORTS_DATA_DIR, sessionId)
  if (!fs.existsSync(dir)) return null

  for (const entry of fs.readdirSync(dir)) {
    const filePath = path.join(dir, entry)
    if (!fs.statSync(filePath).isFile()) continue
    const extension = path.extname(entry).toLowerCase()
    return {
      filePath,
      storedName: entry,
      extension,
      mimeType: getMimeTypeForExtension(extension),
    }
  }
  return null
}

export function readStoredReportFile(sessionId: string): (StoredReportFile & { buffer: Buffer }) | null {
  const stored = findStoredReportFile(sessionId)
  if (!stored) return null
  return {
    ...stored,
    buffer: fs.readFileSync(stored.filePath),
  }
}

export type ReportPreviewKind = "pdf" | "image" | "word" | "text" | "other"

export function previewKindFromMime(mimeType: string, extension: string): ReportPreviewKind {
  const mime = mimeType.toLowerCase()
  const ext = extension.toLowerCase()
  if (mime === "application/pdf" || ext === ".pdf") return "pdf"
  if (mime.startsWith("image/")) return "image"
  if (
    mime.includes("wordprocessingml") ||
    mime === "application/msword" ||
    ext === ".docx" ||
    ext === ".doc"
  ) {
    return "word"
  }
  if (mime.startsWith("text/") || ext === ".txt") return "text"
  return "other"
}
