export type ReportPreviewKind = "pdf" | "image" | "word" | "text" | "other"

export function previewKindFromMime(mimeType: string, fileName: string): ReportPreviewKind {
  const mime = mimeType.toLowerCase()
  const ext = fileName.includes(".")
    ? `.${fileName.split(".").pop()!.toLowerCase()}`
    : ""

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

export function previewKindFromFile(file: File): ReportPreviewKind {
  return previewKindFromMime(file.type, file.name)
}

export function isPreviewableFile(file: File): boolean {
  return previewKindFromFile(file) !== "other"
}

export function fileNeedsBlobUrl(kind: ReportPreviewKind): boolean {
  return kind === "pdf" || kind === "image"
}
