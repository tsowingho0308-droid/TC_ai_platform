// Shared RAG search helper for Helpdesk Agent
// Supports optional query expansion for cross-language retrieval.

import { prisma } from "@/lib/server/prisma"
import { generateEmbedding } from "@combine-ai/ai-provider"
import { COL, KB_JOIN_CHAIN, KB_VECTOR_SELECT, KB_WORKSPACE_WHERE } from "@/lib/server/db-columns"

// ── Types ────────────────────────────────────────────────────────

export interface SearchResult {
  id: string
  title: string
  content: string
  knowledgeBaseName: string
  knowledgeBaseSlug: string
  department: string
  similarity?: number
  documentType?: string
  businessProcesses?: string[]
  createdAt?: string
}

export interface SearchOptions {
  workspaceId: string
  department?: string
  topK?: number
  minSimilarity?: number
  /** Below this, results are treated as "suggestions" rather than direct matches. Default 0.45. */
  suggestionThreshold?: number
  /** Enable LLM query expansion for cross-language matching. Default true. */
  useQueryExpansion?: boolean
  /** Optional date filter extracted from query (e.g., "6月10號", "June 10", "最近") */
  dateFilter?: { type: "exact" | "recent"; date?: Date }
}

export type SearchTier = "matched" | "suggestions" | "none"

export interface SearchResultSet {
  articles: SearchResult[]
  suggestions: SearchResult[]
  maxScore: number
  tier: SearchTier
  searchMethod: "vector" | "keyword" | "none" | "expanded"
}

type RawVectorResult = {
  article_id: string; title: string; content: string
  kb_name: string; kb_slug: string; department: string; similarity: number
  document_type: string | null
  business_processes: string[] | null
  created_at: Date | null
}

// ── Helpers ──────────────────────────────────────────────────────

let pgVectorAvailable: boolean | null = null

export async function checkPgVector(): Promise<boolean> {
  if (pgVectorAvailable !== null) return pgVectorAvailable
  try {
    const result = await prisma.$queryRaw<Array<{ available: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_type WHERE typname = 'vector'
      ) as available
    `
    pgVectorAvailable = result[0]?.available ?? false
  } catch {
    pgVectorAvailable = false
  }
  return pgVectorAvailable
}

export function resetPgVectorCheck(): void {
  pgVectorAvailable = null
}

// ── Core Vector Search (extracted for reuse in expansion) ─────────

async function runVectorSearch(
  embedding: number[],
  workspaceId: string,
  department: string | undefined,
  limit: number
): Promise<RawVectorResult[]> {
  const hasDeptFilter = department && department !== "GENERAL"

  const C_COL = COL.KnowledgeChunk
  const A_COL = COL.KnowledgeArticle
  const K_COL = COL.KnowledgeBase

  const embLiteral = `'[${embedding.join(",")}]'`

  const buildSQL = (deptFilter: string) => `
    SELECT DISTINCT ON (ka."${A_COL.id}")
      ${KB_VECTOR_SELECT},
      (1 - (kc."${C_COL.embedding}" <=> ${embLiteral}::vector))
        * CASE WHEN ka."${A_COL.documentType}" IN ('PLAYBOOK', 'PROCESS_MAP') THEN 0.85 ELSE 1.0 END
        as similarity
    ${KB_JOIN_CHAIN}
    WHERE ${KB_WORKSPACE_WHERE} = '${workspaceId}'${deptFilter}
    ORDER BY ka."${A_COL.id}", kc."${C_COL.embedding}" <=> ${embLiteral}::vector
    LIMIT ${limit}
  `

  const sql = hasDeptFilter
    ? buildSQL(` AND kb."${K_COL.department}" = '${department}'::"HelpdeskDepartment"`)
    : buildSQL("")

  return await prisma.$queryRawUnsafe<RawVectorResult[]>(sql)
}

function mapResults(
  raw: RawVectorResult[],
  minSimilarity: number
): SearchResult[] {
  return raw
    .map((r) => ({
      id: r.article_id,
      title: r.title,
      content: r.content,
      knowledgeBaseName: r.kb_name,
      knowledgeBaseSlug: r.kb_slug,
      department: r.department,
      similarity: Math.round(r.similarity * 100) / 100,
      documentType: r.document_type || undefined,
      businessProcesses: r.business_processes || undefined,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
    }))
    .filter((a) => a.similarity === undefined || a.similarity >= minSimilarity)
}

// ── Keyword Fallback ─────────────────────────────────────────────

async function keywordSearch(
  query: string,
  workspaceId: string,
  department: string | undefined,
  topK: number
): Promise<SearchResult[]> {
  // Extract keywords from long queries for tag matching
  // e.g. "我們公司的病假規矩是什麼" → ["sick", "病假", "leave"]
  const tagKeywords = extractTagKeywords(query)

  const orConditions: Record<string, unknown>[] = [
    { title: { contains: query } },
    { content: { contains: query } },
    // Search tags with the full query
    { tags: { hasSome: [query] } },
  ]

  // Also search tags with extracted keywords (long sentence → individual terms)
  if (tagKeywords.length > 0) {
    orConditions.push({ tags: { hasSome: tagKeywords } })
    // Also search title/content with shorter keywords for better recall
    for (const kw of tagKeywords.slice(0, 3)) {
      orConditions.push({ title: { contains: kw } })
      orConditions.push({ content: { contains: kw } })
    }
  }

  const where: Record<string, unknown> = {
    knowledgeBase: { workspaceId },
    OR: orConditions,
  }

  if (department && department !== "GENERAL") {
    where.knowledgeBase = { workspaceId, department }
  }

  let articleResults = await prisma.knowledgeArticle.findMany({
    where,
    take: topK,
    orderBy: { updatedAt: "desc" },
    include: {
      knowledgeBase: { select: { name: true, slug: true, department: true } },
    },
  })

  if (articleResults.length === 0 && department && department !== "GENERAL") {
    articleResults = await prisma.knowledgeArticle.findMany({
      where: {
        knowledgeBase: { workspaceId },
        OR: orConditions,
      },
      take: topK,
      orderBy: { updatedAt: "desc" },
      include: {
        knowledgeBase: { select: { name: true, slug: true, department: true } },
      },
    })
  }

  console.log(
    `[RAG Keyword Search] query="${query.slice(0, 80)}" | tagKeywords=[${tagKeywords.join(", ")}] | results=${articleResults.length}`
  )

  return articleResults.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    knowledgeBaseName: a.knowledgeBase.name,
    knowledgeBaseSlug: a.knowledgeBase.slug,
    department: a.knowledgeBase.department,
  }))
}

// ── Date Extraction ──────────────────────────────────────────────

/**
 * Extract date filters from natural language queries.
 * Supports:
 * - "最近" / "recent" → recent filter
 * - "6月10號" / "June 10" / "2026-06-10" → exact date
 */
export function extractDateFromQuery(query: string): { type: "exact" | "recent" | null; date?: Date } {
  const q = query.toLowerCase()

  // Recent / 最近
  if (/最近|recent|latest|newest|最新/.test(q)) {
    return { type: "recent" }
  }

  // Chinese date: 6月10號, 6月10日, 6月10
  const cnDateMatch = q.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[號日]?/)
  if (cnDateMatch) {
    const month = parseInt(cnDateMatch[1])
    const day = parseInt(cnDateMatch[2])
    const now = new Date()
    const date = new Date(now.getFullYear(), month - 1, day)
    // If date is in the future, assume previous year
    if (date > now) date.setFullYear(date.getFullYear() - 1)
    return { type: "exact", date }
  }

  // English date: June 10, Jun 10, 10 June
  const enDateMatch = q.match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?/i)
  if (enDateMatch) {
    const months: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
    const mKey = enDateMatch[1].toLowerCase().slice(0, 3)
    if (months[mKey] !== undefined) {
      const day = parseInt(enDateMatch[2])
      const now = new Date()
      const date = new Date(now.getFullYear(), months[mKey], day)
      if (date > now) date.setFullYear(date.getFullYear() - 1)
      return { type: "exact", date }
    }
  }

  // ISO date: 2026-06-10
  const isoMatch = q.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return { type: "exact", date: new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3])) }
  }

  // Today / 今天
  if (/今天|today/.test(q)) {
    return { type: "exact", date: new Date() }
  }

  // Yesterday / 昨天
  if (/昨天|yesterday/.test(q)) {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return { type: "exact", date: d }
  }

  return { type: null }
}

// ── Tag Keyword Extraction ───────────────────────────────────────

// Common Chinese-English keyword → taxonomy tag mappings for HK enterprise context
// Each entry maps keywords to the corresponding tag name in tag-taxonomy.ts
const KEYWORD_MAP: Record<string, string[]> = {
  leave: ["sick", "病假", "請病假", "病", "medical leave", "醫生紙", "annual leave", "年假", "請假", "假期", "放假", "leave"],
  expense: ["expense", "報銷", "開支", "費用", "claim", "支出"],
  tender: ["tender", "標書", "招標", "投標", "rfp", "rfq", "標"],
  onboarding: ["onboarding", "入職", "orientation", "新人", "報到", " onboard"],
  offboarding: ["offboarding", "離職", "resign", "辭職", "exit", "退職"],
  procurement: ["procurement", "採購", "購買", "purchase", "購置"],
  budget: ["budget", "預算", "budgeting", "經費"],
  equipment: ["equipment", "設備", "電腦", "laptop", "硬體", "硬件", "硬件", "筆電"],
  vpn: ["vpn", "remote access", "遠端", "遠程", "在家工作", "wfh", "work from home"],
  security: ["security", "安全", "密碼", "password", "保安"],
  travel: ["travel", "出差", "旅行", "機票", "酒店", "flight", "hotel"],
  handbook: ["handbook", "手冊", "員工手冊", "守則", "code of conduct"],
  holiday: ["holiday", "公眾假期", "公假", "放假", "假期安排"],
  compliance: ["compliance", "合規", "法規", "regulatory", "審計", "audit"],
  invoice: ["invoice", "發票", "單據", "receipt", "收據", "賬單"],
  contract: ["contract", "合約", "合同", "協議", "agreement", "mou"],
  report: ["report", "報告", "報表", "分析", "summary"],
  policy: ["policy", "政策", "規矩", "規定", "rules", "規則", "制度"],
  recruitment: ["recruitment", "招聘", "請人", "hire", "interview", "面試", "求職"],
  training: ["training", "培訓", "訓練", "課程", "course", "學習"],
  benefits: ["benefits", "福利", "benefit", "保險", "insurance", "補貼"],
  facilities: ["facilities", "設施", "辦公室", "meeting room", "會議室", "停車場", "canteen"],
  "access-card": ["access", "門禁", "card", "badge", "通行證", "出入", "門卡"],
  software: ["software", "軟件", "軟體", "license", "授權", "安裝"],
  "email-systems": ["email", "郵件", "電郵", "信箱", "gmail", "郵箱"],
  emergency: ["emergency", "緊急", "急救", "first aid", "火警", "fire", "疏散"],
  "it-support": ["it support", "help desk", "技術支援", "維修", "troubleshoot"],
  "remote-work": ["remote", "遠程工作", "在家辦公", "work from home", "wfh"],
}

/**
 * Extract tag-relevant keywords from a query (Chinese or English).
 * For short queries (≤3 words), just return empty — the full query already matches.
 * For long queries, extract known substrings that map to tags.
 */
function extractTagKeywords(query: string): string[] {
  const qLower = query.toLowerCase().trim()
  const words = qLower.split(/\s+/)

  // Extract keywords even for short queries if they match known tags
  // (skip only single-word queries that are just a tag name itself)
  if (words.length === 1 && qLower.length <= 15) return []

  const matched: Set<string> = new Set()

  for (const [tag, synonyms] of Object.entries(KEYWORD_MAP)) {
    for (const syn of synonyms) {
      if (qLower.includes(syn.toLowerCase())) {
        matched.add(tag)
        break
      }
    }
  }

  return [...matched]
}

// ── Tier Computation ─────────────────────────────────────────────

function computeTier(
  rawResults: SearchResult[],
  minSimilarity: number,
  suggestionThreshold: number,
  dateFilter?: SearchOptions["dateFilter"],
  query?: string
): { articles: SearchResult[]; suggestions: SearchResult[]; maxScore: number; tier: SearchTier } {
  let adjustedResults = rawResults

  // ═══════════════════════════════════════════════════════════
  // BOOST 1: Title Text Match Override
  // If the user's query contains words that appear in a document's title,
  // give it a massive boost. This handles cross-language failures.
  // ═══════════════════════════════════════════════════════════
  if (query) {
    const queryLower = query.toLowerCase()
    // Extract meaningful tokens from query (alphanumeric + CJK)
    const tokens = queryLower
      .split(/[\s,，。、？！]+/)
      .filter((t) => t.length >= 2)
    // Also extract individual significant substrings (like names, English words in CJK queries)
    const engMatches = queryLower.match(/[a-z0-9_\-]+/gi) || []
    const allTokens = [...new Set([...tokens, ...engMatches.map((m) => m.toLowerCase())])]

    adjustedResults = adjustedResults.map((r) => {
      const titleLower = r.title.toLowerCase()
      let titleBoost = 0

      // Check token matches against title
      for (const token of allTokens) {
        if (token.length < 2) continue
        if (titleLower.includes(token)) {
          // Exact token match in title → big boost per token
          titleBoost += 0.12
        }
      }

      // Special: if query has a word that's a substring of >50% of the title (or vice versa), it's a near-exact match
      const titleWords = titleLower.split(/[\s_\-]+/).filter((w) => w.length >= 2)
      for (const tw of titleWords) {
        if (tw.length >= 4 && queryLower.includes(tw)) {
          titleBoost += 0.08 // additional boost for each title word found in query
        }
      }

      // Cap the title boost at 0.50
      titleBoost = Math.min(titleBoost, 0.50)

      // If any boost, ensure minimum floor of 0.75 for strong partial matches
      if (titleBoost >= 0.20) {
        const newScore = Math.max((r.similarity ?? 0) + titleBoost, 0.75)
        return { ...r, similarity: Math.min(newScore, 0.98) }
      }

      if (titleBoost > 0) {
        return { ...r, similarity: (r.similarity ?? 0) + titleBoost }
      }

      return r
    })
  }

  // ═══════════════════════════════════════════════════════════
  // BOOST 2: Date Proximity
  // ═══════════════════════════════════════════════════════════
  if (dateFilter?.type === "recent") {
    const now = Date.now()
    adjustedResults = adjustedResults.map((r) => {
      const age = r.createdAt ? (now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 365
      const recencyBoost = Math.max(0, (1 - age / 365) * 0.15)
      return { ...r, similarity: (r.similarity ?? 0) + recencyBoost }
    })
  } else if (dateFilter?.type === "exact" && dateFilter.date) {
    const target = dateFilter.date.getTime()
    adjustedResults = rawResults.map((r) => {
      const diff = r.createdAt ? Math.abs(target - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24) : 365
      const proximityBoost = Math.max(0, (1 - diff / 30) * 0.1)
      return { ...r, similarity: (r.similarity ?? 0) + proximityBoost }
    })
  }

  const maxScore = adjustedResults.length > 0
    ? Math.max(...adjustedResults.map((r) => r.similarity ?? 0))
    : 0

  if (maxScore >= minSimilarity) {
    return {
      articles: adjustedResults.filter((r) => (r.similarity ?? 0) >= minSimilarity),
      suggestions: [],
      maxScore,
      tier: "matched",
    }
  }

  if (maxScore >= suggestionThreshold) {
    return {
      articles: [],
      suggestions: adjustedResults
        .filter((r) => (r.similarity ?? 0) >= suggestionThreshold)
        .slice(0, 2),
      maxScore,
      tier: "suggestions",
    }
  }

  return { articles: [], suggestions: [], maxScore, tier: "none" }
}

// ── Date Boosting ────────────────────────────────────────────────

/**
 * Boost search results that are close to the target date.
 * For "recent" queries, newer documents get a similarity boost.
 * For exact dates, documents close to that date get a boost.
 */
function boostByDateProximity(
  results: SearchResult[],
  dateFilter: NonNullable<SearchOptions["dateFilter"]>
): SearchResult[] {
  const now = new Date()
  const targetDate = dateFilter.type === "exact" && dateFilter.date
    ? dateFilter.date
    : now

  // For each result, we need the article's createdAt. Since SearchResult
  // doesn't include createdAt, we skip per-result boosting and instead
  // just ensure results are not negatively affected.
  // The actual date filtering happens at the keyword/Prisma level.

  return results
}

// ── Main Search ──────────────────────────────────────────────────

export async function searchKnowledgeBase(
  query: string,
  options: SearchOptions
): Promise<SearchResultSet> {
  const {
    workspaceId, department, topK = 5,
    minSimilarity = 0.42, suggestionThreshold = 0.35,
    useQueryExpansion = true,
  } = options

  const vectorAvailable = await checkPgVector()

  // ══════════════════════════════════════════════════════════════
  // Tier 0: Expanded multi-query vector search
  // ══════════════════════════════════════════════════════════════
  if (vectorAvailable && useQueryExpansion) {
    try {
      const { expandQuery } = await import("./query-expander")
      const expanded = await expandQuery(query)

      if (expanded.variants.length > 1) {
        // Run vector search for each variant, merge by best similarity
        const combined = new Map<string, SearchResult & { bestSimilarity: number }>()

        for (const variant of expanded.variants) {
          const variantEmbedding = await generateEmbedding(variant)
          const variantResults = await runVectorSearch(
            variantEmbedding,
            workspaceId,
            department,
            Math.ceil(topK / 2)
          )

          for (const r of variantResults) {
            const sim = Math.round(r.similarity * 100) / 100
            const existing = combined.get(r.article_id)
            if (!existing || sim > existing.bestSimilarity) {
              combined.set(r.article_id, {
                id: r.article_id,
                title: r.title,
                content: r.content,
                knowledgeBaseName: r.kb_name,
                knowledgeBaseSlug: r.kb_slug,
                department: r.department,
                similarity: sim,
                bestSimilarity: sim,
              })
            }
          }
        }

        const rawResults = [...combined.values()]
          .sort((a, b) => (b.bestSimilarity ?? 0) - (a.bestSimilarity ?? 0))
          .slice(0, topK)
          .map(({ bestSimilarity: _, ...rest }) => rest)

        const tierResult = computeTier(rawResults, minSimilarity, suggestionThreshold, options.dateFilter, query)
        const topScores = rawResults.slice(0, 3).map((a) => (a.similarity ?? 0).toFixed(2))
        console.log(
          `[RAG Expanded Search] query="${query.slice(0, 80)}" | variants=${expanded.variants.length} | top scores: [${topScores.join(", ")}] | tier=${tierResult.tier} | matched=${tierResult.articles.length} | suggestions=${tierResult.suggestions.length}`
        )
        return { ...tierResult, searchMethod: "expanded" }
      }
    } catch (err) {
      console.warn("Expanded search failed, falling back to single-query vector search:", err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Tier 1: Single-query vector search
  // ══════════════════════════════════════════════════════════════

  if (vectorAvailable) {
    try {
      const embedding = await generateEmbedding(query)
      const rawResults = await runVectorSearch(
        embedding, workspaceId, department, topK
      )
      const allResults = mapResults(rawResults, 0) // get ALL results first, not filtered

      // Debug: log similarity scores
      const scores = rawResults.map((r) => Math.round(r.similarity * 10000) / 100)
      const tierResult = computeTier(allResults, minSimilarity, suggestionThreshold, options.dateFilter, query)
      console.log(
        `[RAG Vector Search] query="${query.slice(0, 80)}" | top scores: [${scores.slice(0, 5).join(", ")}%] | threshold=${minSimilarity} | dateFilter=${options.dateFilter?.type || "none"} | tier=${tierResult.tier} | matched=${tierResult.articles.length} | suggestions=${tierResult.suggestions.length}`
      )
      return { ...tierResult, searchMethod: "vector" }
    } catch (err) {
      console.warn("Vector search failed, falling back to keyword search:", err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Tier 2: Keyword fallback (no similarity scores — all "matched" or "none")
  // ══════════════════════════════════════════════════════════════
  const kwArticles = await keywordSearch(query, workspaceId, department, topK)
  return {
    articles: kwArticles,
    suggestions: [],
    maxScore: 0,
    tier: kwArticles.length > 0 ? "matched" : "none",
    searchMethod: kwArticles.length > 0 ? "keyword" : "none",
  }
}

// ── Source Formatting ────────────────────────────────────────────

export function formatSourcesText(
  articles: SearchResult[],
  contentMaxChars = 1500
): string {
  if (articles.length === 0) {
    return "No relevant policy documents found in the knowledge base."
  }

  return (
    articles
      .map((a, i) => {
        let line = `[Article ${i + 1}] Title: ${a.title}\nDepartment: ${a.department}`
        if (a.documentType) line += `\nType: ${a.documentType.replace(/_/g, " ")}`
        if (a.businessProcesses?.length) line += `\nProcesses: ${a.businessProcesses.join(", ")}`
        line += `\nContent: ${a.content.slice(0, contentMaxChars)}`
        if (a.similarity !== undefined) {
          line += `\nRelevance: ${Math.round(a.similarity * 100)}%`
        }
        return line
      })
      .join("\n\n") +
    "\n\n---\nWhen answering, cite the article title(s) you used."
  )
}
