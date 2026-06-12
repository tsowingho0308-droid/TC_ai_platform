"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  FINANCE_ANALYSIS_COMPLETE,
  FINANCE_ANALYSIS_FAILED,
  FINANCE_ANALYSIS_STARTED,
  FINANCE_ANALYSIS_UPDATED,
  getActiveFinanceSessionId,
  getPendingFinanceAnalyses,
  isFinanceAnalysisInProgress,
  type FinanceAnalysisCompleteDetail,
  type FinanceAnalysisFailedDetail,
} from "@/features/finance/finance-analysis-tracker"
import { normalizeExtractedRows } from "@/features/finance/extracted-rows"

interface UseFinanceAnalysisSyncOptions {
  sessionId?: string | null
  onSessionId?: (sessionId: string) => void
  onRows?: (rows: Array<{ field: string; value: string }>) => void
  onPolicyReset?: () => void
  onError?: (message: string | null) => void
}

export function useFinanceAnalysisSync(options: UseFinanceAnalysisSyncOptions = {}) {
  const [analyzingSessionIds, setAnalyzingSessionIds] = useState<string[]>(() =>
    getPendingFinanceAnalyses().map((item) => item.sessionId)
  )
  const optionsRef = useRef(options)
  optionsRef.current = options

  const refreshAnalyzingState = useCallback(() => {
    setAnalyzingSessionIds(getPendingFinanceAnalyses().map((item) => item.sessionId))
  }, [])

  const isAnalyzing = useCallback(
    (sessionId?: string | null) => {
      if (sessionId) return analyzingSessionIds.includes(sessionId)
      return analyzingSessionIds.length > 0
    },
    [analyzingSessionIds]
  )

  useEffect(() => {
    refreshAnalyzingState()

    function onStarted() {
      refreshAnalyzingState()
    }

    function onUpdated() {
      refreshAnalyzingState()
    }

    function onComplete(event: Event) {
      const detail = (event as CustomEvent<FinanceAnalysisCompleteDetail>).detail
      refreshAnalyzingState()
      if (!detail) return

      optionsRef.current.onSessionId?.(detail.sessionId)
      optionsRef.current.onRows?.(detail.rows)
      optionsRef.current.onPolicyReset?.()
      optionsRef.current.onError?.(null)
    }

    function onFailed(event: Event) {
      const detail = (event as CustomEvent<FinanceAnalysisFailedDetail>).detail
      refreshAnalyzingState()
      if (!detail) return
      optionsRef.current.onError?.(detail.error)
    }

    window.addEventListener(FINANCE_ANALYSIS_STARTED, onStarted)
    window.addEventListener(FINANCE_ANALYSIS_UPDATED, onUpdated)
    window.addEventListener(FINANCE_ANALYSIS_COMPLETE, onComplete as EventListener)
    window.addEventListener(FINANCE_ANALYSIS_FAILED, onFailed as EventListener)

    return () => {
      window.removeEventListener(FINANCE_ANALYSIS_STARTED, onStarted)
      window.removeEventListener(FINANCE_ANALYSIS_UPDATED, onUpdated)
      window.removeEventListener(FINANCE_ANALYSIS_COMPLETE, onComplete as EventListener)
      window.removeEventListener(FINANCE_ANALYSIS_FAILED, onFailed as EventListener)
    }
  }, [refreshAnalyzingState])

  useEffect(() => {
    const activeSessionId = options.sessionId || getActiveFinanceSessionId()
    if (!activeSessionId || !isFinanceAnalysisInProgress(activeSessionId)) return

    let cancelled = false

    async function hydrateIfAlreadyDone() {
      try {
        const res = await fetch(`/api/finance/sessions?id=${encodeURIComponent(activeSessionId!)}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        const financeSession = data.session as {
          id: string
          status: string
          extractedRows: unknown
          draftNote?: string | null
        }

        if (financeSession.status === "analyzed") {
          const rows = normalizeExtractedRows(financeSession.extractedRows)
          if (rows.length > 0) {
            optionsRef.current.onSessionId?.(financeSession.id)
            optionsRef.current.onRows?.(rows)
            optionsRef.current.onPolicyReset?.()
            optionsRef.current.onError?.(null)
          }
        } else if (financeSession.status === "analysis_failed") {
          optionsRef.current.onError?.(
            financeSession.draftNote?.trim() || "Analysis failed. Please upload the file again."
          )
        }
      } catch {
        // Background poller will keep trying.
      }
    }

    void hydrateIfAlreadyDone()
    return () => {
      cancelled = true
    }
  }, [options.sessionId])

  return {
    analyzingSessionIds,
    isAnalyzing,
    refreshAnalyzingState,
  }
}
