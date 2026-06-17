import mammoth from "mammoth"

export async function buildWordPreviewHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  return result.value || "<p>(Empty document)</p>"
}

export function buildTextPreview(buffer: Buffer): string {
  return buffer.toString("utf-8")
}
