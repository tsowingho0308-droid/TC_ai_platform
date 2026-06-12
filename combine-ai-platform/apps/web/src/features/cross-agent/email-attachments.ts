export interface EmailAttachmentRef {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export function parseAttachmentIdsFromSearchParams(
  attachmentIdsParam: string | null,
  attachmentIdParam: string | null
): string[] {
  if (attachmentIdsParam) {
    return attachmentIdsParam.split(",").map((id) => id.trim()).filter(Boolean)
  }
  if (attachmentIdParam) return [attachmentIdParam]
  return []
}

export function isAnalyzableEmailAttachment(
  att: EmailAttachmentRef,
  options?: { includeImages?: boolean }
): boolean {
  const name = att.fileName.toLowerCase()
  if (att.mimeType === "application/pdf" || name.endsWith(".pdf")) return true
  if (name.endsWith(".docx") || name.endsWith(".doc") || name.endsWith(".txt")) return true
  if (options?.includeImages) {
    return att.mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)
  }
  return false
}

export function getInitialSelectedAttachmentIds(
  attachments: EmailAttachmentRef[],
  preferredIds: string[],
  options?: { includeImages?: boolean }
): Set<string> {
  const analyzable = attachments.filter((att) => isAnalyzableEmailAttachment(att, options))
  const preferred = preferredIds.filter((id) => analyzable.some((att) => att.id === id))
  if (preferred.length > 0) return new Set(preferred)
  if (analyzable.length > 0) return new Set([analyzable[0].id])
  return new Set()
}

export function getSelectedAnalyzableAttachments(
  attachments: EmailAttachmentRef[],
  selectedIds: Set<string>,
  options?: { includeImages?: boolean }
): EmailAttachmentRef[] {
  return attachments.filter(
    (att) => selectedIds.has(att.id) && isAnalyzableEmailAttachment(att, options)
  )
}
