"use client"

import { useEffect, useRef } from "react"
import {
  dispatchFinanceAnalysisUpdated,
  FINANCE_ANALYSIS_COMPLETE,
  FINANCE_ANALYSIS_FAILED,
  getPendingFinanceAnalyses,
  removePendingFinanceAnalysis,
  type FinanceAnalysisCompleteDetail,
  type FinanceAnalysisFailedDetail,
} from "@/features/finance/finance-analysis-tracker"
import { normalizeExtractedRows } from "@/features/finance/extracted-rows"

const POLL_MS = 2500

export function FinanceBackgroundAnalysis() {
  const pollingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function pollPendingSessions() {
      if (pollingRef.current) return
      const pending = getPendingFinanceAnalyses()
      if (pending.length === 0) return

      pollingRef.current = true
      try {
        for (const item of pending) {
          if (cancelled) break
          try {
            const res = await fetch(`/api/finance/sessions?id=${encodeURIComponent(item.sessionId)}`)
            if (!res.ok) continue
            const data = await res.json()
            const financeSession = data.session as {
              id: string
              status: string
              extractedRows: unknown
              draftNote?: string | null
            }

            if (financeSession.status === "analyzed") {
              removePendingFinanceAnalysis(item.sessionId)
              window.dispatchEvent(
                new CustomEvent<FinanceAnalysisCompleteDetail>(FINANCE_ANALYSIS_COMPLETE, {
                  detail: {
                    sessionId: item.sessionId,
                    rows: normalizeExtractedRows(financeSession.extractedRows),
                  },
                })
              )
              dispatchFinanceAnalysisUpdated()
              window.dispatchEvent(new Event("finance:sessions-updated"))
            } else if (financeSession.status === "analysis_failed") {
              removePendingFinanceAnalysis(item.sessionId)
              window.dispatchEvent(
                new CustomEvent<FinanceAnalysisFailedDetail>(FINANCE_ANALYSIS_FAILED, {
                  detail: {
                    sessionId: item.sessionId,
                    error:
                      financeSession.draftNote?.trim() ||
                      "Analysis failed. Please upload the file again.",
                  },
                })
              )
              dispatchFinanceAnalysisUpdated()
              window.dispatchEvent(new Event("finance:sessions-updated"))
            }
          } catch {
            // Keep polling on transient network errors.
          }
        }
      } finally {
        pollingRef.current = false
      }
    }

    function schedulePoll() {
      if (cancelled) return
      timer = setTimeout(async () => {
        await pollPendingSessions()
        schedulePoll()
      }, POLL_MS)
    }

    function onAnalysisStarted() {
      void pollPendingSessions()
    }

    void pollPendingSessions()
    schedulePoll()
    window.addEventListener("finance:analysis-started", onAnalysisStarted)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener("finance:analysis-started", onAnalysisStarted)
    }
  }, [])

  return null
}
