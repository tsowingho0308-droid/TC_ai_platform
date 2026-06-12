/**
 * Split text into overlapping chunks suitable for embedding.
 */
export function chunkText(
  text: string,
  maxChars: number = 800,
  overlapChars: number = 100
): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean)
  const chunks: string[] = []
  let current = ""

  for (const p of paragraphs) {
    const candidate = current ? current + "\n\n" + p : p

    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current.trim())

      const overlap = current.slice(-overlapChars)
      current = overlap ? overlap + "\n\n" + p : p

      while (current.length > maxChars) {
        const splitPoint = current.lastIndexOf(" ", maxChars)
        const cut = splitPoint > maxChars * 0.7 ? splitPoint : maxChars
        chunks.push(current.slice(0, cut).trim())
        current = current.slice(Math.max(cut - overlapChars, 0)).trim()
      }
    } else {
      current = candidate
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}
