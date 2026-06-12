export interface PendingFinanceAnalysis {
  sessionId: string
  fileName: string
  startedAt: string
}

const PENDING_KEY = "finance:pending-analyses"
const ACTIVE_SESSION_KEY = "finance:active-session-id"

export const FINANCE_ANALYSIS_STARTED = "finance:analysis-started"
export const FINANCE_ANALYSIS_COMPLETE = "finance:analysis-complete"
export const FINANCE_ANALYSIS_FAILED = "finance:analysis-failed"
export const FINANCE_ANALYSIS_UPDATED = "finance:analysis-updated"

export interface FinanceAnalysisCompleteDetail {
  sessionId: string
  rows: Array<{ field: string; value: string }>
}

export interface FinanceAnalysisFailedDetail {
  sessionId: string
  error: string
}

function readPending(): PendingFinanceAnalysis[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PendingFinanceAnalysis[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writePending(items: PendingFinanceAnalysis[]) {
  if (typeof window === "undefined") return
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(items))
}

export function getPendingFinanceAnalyses(): PendingFinanceAnalysis[] {
  return readPending()
}

export function registerPendingFinanceAnalysis(entry: PendingFinanceAnalysis) {
  const next = readPending().filter((item) => item.sessionId !== entry.sessionId)
  next.push(entry)
  writePending(next)
  setActiveFinanceSessionId(entry.sessionId)
}

export function removePendingFinanceAnalysis(sessionId: string) {
  writePending(readPending().filter((item) => item.sessionId !== sessionId))
}

export function setActiveFinanceSessionId(sessionId: string | null) {
  if (typeof window === "undefined") return
  if (sessionId) sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
  else sessionStorage.removeItem(ACTIVE_SESSION_KEY)
}

export function getActiveFinanceSessionId(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(ACTIVE_SESSION_KEY)
}

export function dispatchFinanceAnalysisUpdated() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(FINANCE_ANALYSIS_UPDATED))
}

export function isFinanceAnalysisInProgress(sessionId?: string | null) {
  const pending = readPending()
  if (!sessionId) return pending.length > 0
  return pending.some((item) => item.sessionId === sessionId)
}
