export interface PendingTenderAnalysis {
  sessionId: string
  fileName: string
  startedAt: string
}

const PENDING_KEY = "tender:pending-analyses"

export const TENDER_ANALYSIS_STARTED = "tender:analysis-started"
export const TENDER_ANALYSIS_COMPLETE = "tender:analysis-complete"
export const TENDER_ANALYSIS_FAILED = "tender:analysis-failed"
export const TENDER_ANALYSIS_UPDATED = "tender:analysis-updated"

export interface TenderAnalysisCompleteDetail {
  sessionId: string
  status: string
}

export interface TenderAnalysisFailedDetail {
  sessionId: string
  error: string
}

function readPending(): PendingTenderAnalysis[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PendingTenderAnalysis[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writePending(items: PendingTenderAnalysis[]) {
  if (typeof window === "undefined") return
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(items))
}

export function getPendingTenderAnalyses(): PendingTenderAnalysis[] {
  return readPending()
}

export function registerPendingTenderAnalysis(entry: PendingTenderAnalysis) {
  const next = readPending().filter((item) => item.sessionId !== entry.sessionId)
  next.push(entry)
  writePending(next)
}

export function removePendingTenderAnalysis(sessionId: string) {
  writePending(readPending().filter((item) => item.sessionId !== sessionId))
}

export function dispatchTenderAnalysisUpdated() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(TENDER_ANALYSIS_UPDATED))
}

export function isTenderAnalysisInProgress(sessionId?: string | null) {
  const pending = readPending()
  if (!sessionId) return pending.length > 0
  return pending.some((item) => item.sessionId === sessionId)
}
