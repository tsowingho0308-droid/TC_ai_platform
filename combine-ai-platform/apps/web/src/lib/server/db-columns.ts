// ── Database Column Name Constants ──────────────────────────────
//
// IMPORTANT: All raw SQL queries MUST use these constants instead of
// hardcoded column names. This prevents the camelCase vs snake_case
// mismatch that occurs when Prisma maps field names directly to PostgreSQL.
//
// Prisma in this project does NOT use @map("snake_case"), so PostgreSQL
// columns are camelCase (matching the Prisma field names exactly).

export const COL = {
  KnowledgeChunk: {
    table: "KnowledgeChunk",
    id: "id",
    articleId: "articleId",
    content: "content",
    chunkIndex: "chunkIndex",
    tokenCount: "tokenCount",
    embedding: "embedding",
    createdAt: "createdAt",
  },
  KnowledgeArticle: {
    table: "KnowledgeArticle",
    id: "id",
    knowledgeBaseId: "knowledgeBaseId",
    title: "title",
    content: "content",
    tags: "tags",
    language: "language",
    sourceDocName: "sourceDocName",
    targetAudience: "targetAudience",
    businessProcesses: "businessProcesses",
    documentType: "documentType",
    linkedArticleIds: "linkedArticleIds",
    languageCode: "languageCode",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  KnowledgeBase: {
    table: "KnowledgeBase",
    id: "id",
    workspaceId: "workspaceId",
    name: "name",
    slug: "slug",
    department: "department",
    description: "description",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
} as const

// ── Convenience helpers for building SQL fragments ────────────────

const C = COL.KnowledgeChunk
const A = COL.KnowledgeArticle
const K = COL.KnowledgeBase

/**
 * Standard JOIN chain for KnowledgeChunk → KnowledgeArticle → KnowledgeBase.
 * Use this in FROM clauses of vector search queries.
 */
export const KB_JOIN_CHAIN = `
  FROM "${C.table}" kc
  JOIN "${A.table}" ka ON ka."${A.id}" = kc."${C.articleId}"
  JOIN "${K.table}" kb ON kb."${K.id}" = ka."${A.knowledgeBaseId}"
`

/**
 * Standard SELECT columns for vector search results (article-level, DISTINCT ON).
 */
export const KB_VECTOR_SELECT = `
  ka."${A.id}" as article_id,
  ka."${A.title}" as title,
  ka."${A.content}" as content,
  kb."${K.name}" as kb_name,
  kb."${K.slug}" as kb_slug,
  kb."${K.department}" as department,
  ka."${A.documentType}" as document_type,
  ka."${A.businessProcesses}" as business_processes,
  ka."${A.createdAt}" as created_at
`

/**
 * Standard WHERE clause for workspace scoping.
 */
export const KB_WORKSPACE_WHERE = `kb."${K.workspaceId}"`
