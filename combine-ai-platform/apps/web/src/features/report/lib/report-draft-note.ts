export interface ReportSummaryDraft {
  summary?: string
  keyPoints?: string[]
  kbReferences?: Array<{
    articleTitle: string
    knowledgeBaseName: string
    relevance: string
  }>
  searchType?: string
}

export function parseReportDraftNote(draftNote?: string | null): ReportSummaryDraft | null {
  if (!draftNote) return null
  try {
    const parsed = JSON.parse(draftNote) as ReportSummaryDraft
    if (parsed && typeof parsed === "object" && parsed.summary) return parsed
  } catch {
    // Plain text note — not a summary payload
  }
  return null
}

export function buildReportDraftNote(summary: ReportSummaryDraft): string {
  return JSON.stringify(summary)
}
