// Client-side API functions for Context Management

export interface ContextDocument {
  id: string
  title: string
  content: string
  tags: string[]
  language: string
  sourceDocName?: string
  targetAudience: string
  businessProcesses: string[]
  documentType: string
  linkedArticleIds: string[]
  languageCode: string
  knowledgeBase: {
    id: string
    name: string
    slug: string
    department: string
  }
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeBase {
  id: string
  name: string
  slug: string
  department: string
  description?: string
  articleCount: number
  createdAt: string
  updatedAt: string
}

export interface SearchResult {
  chunkId: string | null
  content: string
  chunkIndex: number
  articleId: string
  articleTitle: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  knowledgeBaseSlug: string
  department: string
  similarity: number
  excerpt: string
}

export async function listDocuments(params?: {
  knowledgeBaseId?: string
  department?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<{ documents: ContextDocument[]; total: number }> {
  const searchParams = new URLSearchParams()
  if (params?.knowledgeBaseId) searchParams.set("knowledgeBaseId", params.knowledgeBaseId)
  if (params?.department) searchParams.set("department", params.department)
  if (params?.search) searchParams.set("search", params.search)
  if (params?.limit) searchParams.set("limit", String(params.limit))
  if (params?.offset) searchParams.set("offset", String(params.offset))

  const res = await fetch(`/api/context/documents?${searchParams.toString()}`)
  if (!res.ok) throw new Error(`Failed to fetch documents: ${res.status}`)
  return res.json()
}

export async function uploadDocument(
  file: File,
  knowledgeBaseId: string,
  title?: string,
  metadata?: {
    targetAudience?: string
    businessProcesses?: string[]
    documentType?: string
    linkedArticleIds?: string[]
  }
): Promise<{
    document: ContextDocument
    chunksCreated: number
    autoKbMatched?: string | null
    autoDocCategory?: string | null
    autoDepartments?: string[]
    aiSuggestions?: {
      tags: Array<{ tag: string; confidence: number; reason: string }>
      suggestedDepartment: string | null
      suggestedDocumentType: string | null
      summary: string | null
    }
  }> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("knowledgeBaseId", knowledgeBaseId)
  if (title) formData.append("title", title)
  if (metadata?.targetAudience) formData.append("targetAudience", metadata.targetAudience)
  if (metadata?.businessProcesses?.length) formData.append("businessProcesses", metadata.businessProcesses.join(","))
  if (metadata?.documentType) formData.append("documentType", metadata.documentType)
  if (metadata?.linkedArticleIds?.length) formData.append("linkedArticleIds", JSON.stringify(metadata.linkedArticleIds))

  const res = await fetch("/api/context/documents", {
    method: "POST",
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Upload failed: ${res.status}`)
  }
  return res.json()
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch("/api/context/documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) throw new Error(`Failed to delete document: ${res.status}`)
}

export async function searchDocuments(
  q: string,
  department?: string,
  limit?: number
): Promise<{ results: SearchResult[]; total: number; searchType: string }> {
  const params = new URLSearchParams({ q })
  if (department) params.set("department", department)
  if (limit) params.set("limit", String(limit))

  const res = await fetch(`/api/context/search?${params.toString()}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}

export async function listKnowledgeBases(): Promise<{
  knowledgeBases: KnowledgeBase[]
}> {
  const res = await fetch("/api/context/knowledge-bases")
  if (!res.ok) throw new Error(`Failed to fetch knowledge bases: ${res.status}`)
  return res.json()
}

export async function ingestText(params: {
  text: string
  title: string
  knowledgeBaseId: string
  tags?: string[]
  language?: string
  targetAudience?: string
  businessProcesses?: string[]
  documentType?: string
}): Promise<{ article: { id: string; title: string; content: string; tags: string[]; language: string; targetAudience: string; businessProcesses: string[]; documentType: string }; chunksCreated: number }> {
  const res = await fetch("/api/context/ingest?action=upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Ingest failed: ${res.status}`)
  }
  return res.json()
}

export async function reprocessDocument(id: string): Promise<{
  success: boolean
  chunksReprocessed: number
}> {
  const res = await fetch("/api/context/ingest?action=reprocess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || `Reprocess failed: ${res.status}`)
  }
  return res.json()
}
