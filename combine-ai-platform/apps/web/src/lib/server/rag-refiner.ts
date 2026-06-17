// RAG Refinement Layer — bridges the gap between naive vector retrieval
// and production-grade context assembly for LLM prompts.
//
// Four-stage pipeline: Retrieve → Dedup → Budget → Format
//
// Stage 1: Dedup — remove duplicate chunks (same article, near-duplicate content)
// Stage 2: Budget — cap total token count to avoid Lost-in-the-Middle
// Stage 3: Temporal — boost recency, de-prioritize stale documents
// Stage 4: Format — build clean prompt context

import type { SearchResult } from "@/features/helpdesk/api/helpdesk-search"

// ══════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════

export interface ScoredChunk extends SearchResult {
  score: number
  sourceQuery?: string
}

export interface RefineOptions {
  /** Maximum total tokens to include in the final context. Default 3000. */
  maxTokens?: number
  /** Enable article-level deduplication (one chunk per article). Default true. */
  articleDedup?: boolean
  /** Enable content-level deduplication (Jaccard >80% = duplicate). Default true. */
  contentDedup?: boolean
  /** Boost recency (newer documents get higher weight). Default true. */
  temporalBoost?: boolean
}

// ══════════════════════════════════════════════════════════════════════
// Token Estimation (rough: 1 token ≈ 1.5 Chinese chars, 4 English chars)
// ══════════════════════════════════════════════════════════════════════

function estimateTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    if (/[一-鿿]/.test(char)) {
      tokens += 0.67 // CJK: ~1.5 chars per token
    } else if (/[a-zA-Z0-9]/.test(char)) {
      tokens += 0.25 // English: ~4 chars per token
    } else {
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}

// ══════════════════════════════════════════════════════════════════════
// Jaccard Similarity (3-gram overlap)
// ══════════════════════════════════════════════════════════════════════

function ngrams(text: string, n: number): Set<string> {
  const s = new Set<string>()
  const clean = text.replace(/\s+/g, " ").trim().toLowerCase()
  for (let i = 0; i <= clean.length - n; i++) {
    s.add(clean.slice(i, i + n))
  }
  return s
}

function jaccardSimilarity(a: string, b: string): number {
  const sa = ngrams(a, 3)
  const sb = ngrams(b, 3)
  if (sa.size === 0 && sb.size === 0) return 1
  let intersection = 0
  for (const item of sa) {
    if (sb.has(item)) intersection++
  }
  const union = sa.size + sb.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ══════════════════════════════════════════════════════════════════════
// Stage 1: Deduplication
// ══════════════════════════════════════════════════════════════════════

export function dedupChunks(
  chunks: ScoredChunk[],
  options: { articleDedup?: boolean; contentDedup?: boolean } = {}
): ScoredChunk[] {
  const { articleDedup = true, contentDedup = true } = options

  // Sort by score descending — keep the best first
  const sorted = [...chunks].sort((a, b) => b.score - a.score)

  const seenArticles = new Set<string>()
  const result: ScoredChunk[] = []

  for (const chunk of sorted) {
    // Article-level: one chunk per article
    if (articleDedup && seenArticles.has(chunk.id)) continue

    // Content-level: skip near-duplicate content
    if (contentDedup) {
      const isDup = result.some(
        (r) => jaccardSimilarity(r.content.slice(0, 500), chunk.content.slice(0, 500)) > 0.8
      )
      if (isDup) continue
    }

    seenArticles.add(chunk.id)
    result.push(chunk)
  }

  return result
}

// ══════════════════════════════════════════════════════════════════════
// Stage 2: Token Budget
// ══════════════════════════════════════════════════════════════════════

export function applyTokenBudget(
  chunks: ScoredChunk[],
  maxTokens: number = 3000
): ScoredChunk[] {
  const selected: ScoredChunk[] = []
  let used = 0

  for (const chunk of chunks) {
    const t = estimateTokens(chunk.content)
    if (used + t > maxTokens) {
      // If this is the first chunk and it alone exceeds budget,
      // truncate it rather than returning nothing
      if (selected.length === 0) {
        const budgetForContent = Math.floor(maxTokens * 1.5) // rough char budget
        const truncated = { ...chunk, content: chunk.content.slice(0, budgetForContent) + "…" }
        selected.push(truncated)
      }
      break
    }
    selected.push(chunk)
    used += t
  }

  return selected
}

// ══════════════════════════════════════════════════════════════════════
// Stage 3: Temporal Boost
// ══════════════════════════════════════════════════════════════════════

/**
 * Apply temporal decay to search results.
 * Newer documents get a multiplicative boost; older documents are penalized.
 *
 * Half-life: 365 days (a document 1 year old gets its score halved).
 * This naturally de-prioritizes outdated policies while keeping relevant
 * historical context accessible.
 */
export function applyTemporalBoost(
  chunks: ScoredChunk[],
  halfLifeDays: number = 365
): ScoredChunk[] {
  const now = Date.now()

  return chunks.map((chunk) => {
    const createdAt = chunk.createdAt ? new Date(chunk.createdAt).getTime() : now
    const ageDays = Math.max(0, (now - createdAt) / (1000 * 60 * 60 * 24))

    // Exponential decay: score * 0.5^(age / halfLife)
    const decayFactor = Math.pow(0.5, ageDays / halfLifeDays)

    return {
      ...chunk,
      score: chunk.score * decayFactor,
    }
  })
}

// ══════════════════════════════════════════════════════════════════════
// Stage 4: Format → Prompt-ready context string
// ══════════════════════════════════════════════════════════════════════

export function formatRefinedContext(chunks: ScoredChunk[]): string {
  if (chunks.length === 0) return "No relevant documents found."

  return chunks
    .map((c, i) => {
      const dept = c.department !== "GENERAL" ? ` [${c.department}]` : ""
      const type = c.documentType ? ` (${c.documentType})` : ""
      const date = c.createdAt
        ? ` — ${new Date(c.createdAt).toLocaleDateString("zh-HK")}`
        : ""
      const header = `📄 **${c.title}**${dept}${type}${date}`
      return `${header}\n> ${c.content.slice(0, 2000)}`
    })
    .join("\n\n---\n\n")
}

// ══════════════════════════════════════════════════════════════════════
// Full Pipeline
// ══════════════════════════════════════════════════════════════════════

export function refineSearchResults(
  results: SearchResult[],
  options: RefineOptions = {}
): { refinedChunks: ScoredChunk[]; contextText: string } {
  const {
    maxTokens = 3000,
    articleDedup = true,
    contentDedup = true,
    temporalBoost = true,
  } = options

  // Convert to scored chunks (use similarity as initial score)
  let chunks: ScoredChunk[] = results.map((r) => ({
    ...r,
    score: r.similarity ?? 0.5,
  }))

  // Stage 1: Temporal boost
  if (temporalBoost) {
    chunks = applyTemporalBoost(chunks)
  }

  // Re-sort after temporal boost
  chunks.sort((a, b) => b.score - a.score)

  // Stage 2: Deduplication
  chunks = dedupChunks(chunks, { articleDedup, contentDedup })

  // Stage 3: Token budget
  chunks = applyTokenBudget(chunks, maxTokens)

  // Stage 4: Format context
  const contextText = formatRefinedContext(chunks)

  return { refinedChunks: chunks, contextText }
}
