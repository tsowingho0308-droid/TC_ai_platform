import type { KnowledgeChunkResult } from "@/lib/server/knowledge-search"

const PHRASE_MIN_LEN = 6
const PHRASE_MAX_LEN = 80
const MAX_PHRASES = 40

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u00a0\u2000-\u200b\u3000]+/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[.,;:!?，。；：！？、]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function splitIntoSegments(content: string): string[] {
  const raw = content
    .split(/[\n\r]+|(?<=[。；;！!？?])/u)
    .map((s) => s.trim())
    .filter(Boolean)

  const segments: string[] = []
  for (const part of raw) {
    if (part.length <= PHRASE_MAX_LEN) {
      segments.push(part)
      continue
    }
    // Split long paragraphs into smaller chunks at commas or spaces
    const subparts = part.split(/[,，、]/u).map((s) => s.trim()).filter(Boolean)
    for (const sub of subparts.length > 1 ? subparts : [part]) {
      if (sub.length <= PHRASE_MAX_LEN) {
        segments.push(sub)
      } else {
        for (let i = 0; i < sub.length; i += PHRASE_MAX_LEN) {
          segments.push(sub.slice(i, i + PHRASE_MAX_LEN).trim())
        }
      }
    }
  }
  return segments
}

function phraseScore(phrase: string): number {
  let score = 0
  const len = phrase.length
  if (len >= PHRASE_MIN_LEN && len <= 40) score += 30
  if (len > 40 && len <= PHRASE_MAX_LEN) score += 10
  if (/\d/.test(phrase)) score += 15
  if (/[$¥€£]|HKD|USD|CNY|%/i.test(phrase)) score += 12
  if (/[A-Z]{2,}/.test(phrase)) score += 8
  if (/第[一二三四五六七八九十\d]+[條章节項]/.test(phrase)) score += 20
  score -= Math.max(0, len - 50)
  return score
}

/**
 * Extract short phrases from KB chunks for PDF line-level fuzzy highlighting.
 */
export function extractKbHighlightPhrases(chunks: KnowledgeChunkResult[]): string[] {
  const seen = new Set<string>()
  const candidates: Array<{ phrase: string; score: number }> = []

  for (const chunk of chunks) {
    const sources = [chunk.content, chunk.excerpt, chunk.articleTitle].filter(Boolean)
    for (const source of sources) {
      for (const segment of splitIntoSegments(source)) {
        const normalized = normalizePhrase(segment)
        if (normalized.length < PHRASE_MIN_LEN || normalized.length > PHRASE_MAX_LEN) {
          continue
        }
        if (seen.has(normalized)) continue
        seen.add(normalized)
        candidates.push({ phrase: segment.trim(), score: phraseScore(segment) })
      }
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PHRASES)
    .map((c) => c.phrase)
}
