type CidAttachment = {
  id: string
  contentId?: string | null
  fileName: string
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
}

export function rewriteEmailHtmlCids(html: string, attachments: CidAttachment[]): string {
  let result = html
  for (const att of attachments) {
    const raw = att.contentId?.trim()
    if (!raw) continue
    const normalized = raw.replace(/^<|>$/g, "")
    const url = `/api/email/attachments?action=inline&id=${encodeURIComponent(att.id)}`
    for (const cid of [raw, normalized, `<${normalized}>`]) {
      result = result.replace(new RegExp(`cid:${escapeRegExp(cid)}`, "gi"), url)
    }
  }
  return result
}

export function prepareEmailHtml(html: string, attachments: CidAttachment[]): string {
  return sanitizeEmailHtml(rewriteEmailHtmlCids(html, attachments))
}

export function isInlineImageAttachment(att: { contentId?: string | null; mimeType: string }) {
  return Boolean(att.contentId) && att.mimeType.toLowerCase().startsWith("image/")
}
