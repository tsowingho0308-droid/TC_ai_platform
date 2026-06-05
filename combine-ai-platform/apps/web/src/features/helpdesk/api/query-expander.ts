// Query Expansion for RAG — pre-processes user queries with an LLM
// to generate cross-language variants for better retrieval recall.

import { getDashScopeProvider, DEFAULT_MODELS } from "@combine-ai/ai-provider"

// ── Types ────────────────────────────────────────────────────────

export interface ExpandedQuery {
  original: string
  variants: string[]
  expansionTimeMs?: number
}

// ── Cache ────────────────────────────────────────────────────────

const expansionCache = new Map<string, ExpandedQuery>()
const CACHE_MAX = 500

function normalizeKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

// ── Main Expand ──────────────────────────────────────────────────

const EXPANSION_SYSTEM_PROMPT = `You are a search query expansion assistant. Your job is to generate alternative search queries that will help find relevant information in a company knowledge base.

Rules:
- Generate 3-5 alternative search queries (concise, 5-15 words each)
- If the input is in Chinese (Traditional/Simplified) or Cantonese, also generate English equivalents
- If the input is in English, also generate Chinese equivalents
- Cover different aspects: policy names, process steps, department context, related terms
- Do NOT add greetings, explanations, or conversational text
- Output ONLY a JSON array of strings — no markdown, no code fences, no commentary`

/**
 * Expand a user query into multiple search variants using a fast LLM.
 * For Chinese input, generates English equivalents for cross-language matching.
 * Results are cached by normalized query string.
 */
export async function expandQuery(
  userQuery: string
): Promise<ExpandedQuery> {
  const normalized = normalizeKey(userQuery)

  // Check cache
  const cached = expansionCache.get(normalized)
  if (cached) return cached

  const startTime = Date.now()
  const provider = getDashScopeProvider()

  const userPrompt = `Expand this query for knowledge base search: "${userQuery}"`

  try {
    const result = await provider.createCompletion({
      model: DEFAULT_MODELS.email, // qwen-flash for low latency
      temperature: 0.1,
      maxTokens: 400,
      messages: [
        { role: "system", content: EXPANSION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    let variants: string[] = []
    try {
      // Clean and parse as JSON array
      const cleaned = result.messageContent
        .replace(/```json\s*/gi, "")
        .replace(/\s*```/g, "")
        .trim()
      variants = JSON.parse(cleaned)
      if (!Array.isArray(variants)) variants = []
    } catch {
      // Fallback: split by lines, strip numbering
      variants = result.messageContent
        .split("\n")
        .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
        .filter((l) => l.length > 3 && !l.startsWith("["))
    }

    // Deduplicate, filter empty/same-as-original, cap at 5 additional
    const allVariants = [
      userQuery,
      ...variants
        .filter((v) => v !== userQuery && v.length > 2)
        .filter((v, i, arr) => arr.indexOf(v) === i),
    ].slice(0, 6) // max 6 total (original + 5)

    const expanded: ExpandedQuery = {
      original: userQuery,
      variants: allVariants,
      expansionTimeMs: Date.now() - startTime,
    }

    // Cache with LRU eviction
    if (expansionCache.size >= CACHE_MAX) {
      const firstKey = expansionCache.keys().next().value
      if (firstKey) expansionCache.delete(firstKey)
    }
    expansionCache.set(normalized, expanded)

    return expanded
  } catch (err) {
    console.warn("Query expansion failed, using original query only:", err)
    return { original: userQuery, variants: [userQuery] }
  }
}

/** Clear the expansion cache (useful for testing). */
export function clearExpansionCache(): void {
  expansionCache.clear()
}
