"use client"

import { useEffect, useRef } from "react"
import {
  dispatchTenderAnalysisUpdated,
  TENDER_ANALYSIS_COMPLETE,
  TENDER_ANALYSIS_FAILED,
  TENDER_ANALYSIS_STARTED,
  getPendingTenderAnalyses,
  removePendingTenderAnalysis,
  type TenderAnalysisCompleteDetail,
  type TenderAnalysisFailedDetail,
} from "@/features/tender/tender-analysis-tracker"
import { updateCachedTenderSessionWorkspace } from "@/features/tender/lib/tender-workspace-store"
import { unpackTenderSessionWorkspace, isTenderBatchComplete } from "@/features/tender/lib/tender-session-workspace"

const POLL_MS = 2500

export function TenderBackgroundAnalysis() {
  const pollingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function pollPendingSessions() {
      if (pollingRef.current) return
      const pending = getPendingTenderAnalyses()
      if (pending.length === 0) return

      pollingRef.current = true
      try {
        for (const item of pending) {
          if (cancelled) break
          try {
            const res = await fetch(
              `/api/tender/sessions?id=${encodeURIComponent(item.sessionId)}`
            )
            if (!res.ok) continue
            const data = await res.json()
            const tenderSession = data.session as {
              id: string
              status: string
              fieldInputs?: unknown
              title?: string
            }

            const workspace = unpackTenderSessionWorkspace(tenderSession.fieldInputs, {
              title: tenderSession.title,
            })
            const batchDone = isTenderBatchComplete(workspace)

            if (tenderSession.status === "completed" && batchDone) {
              removePendingTenderAnalysis(item.sessionId)
              if (workspace && workspace.tenders.length > 0) {
                updateCachedTenderSessionWorkspace(item.sessionId, {
                  tenders: workspace.tenders,
                  viewMode: workspace.viewMode,
                  showDiffsOnly: workspace.showDiffsOnly,
                  selectedTemplate: workspace.selectedTemplate,
                  model: workspace.model,
                  aiCompareResult: workspace.aiCompareResult ?? null,
                  streamingStatus: "done",
                  error: null,
                })
              }
              window.dispatchEvent(
                new CustomEvent<TenderAnalysisCompleteDetail>(TENDER_ANALYSIS_COMPLETE, {
                  detail: { sessionId: item.sessionId, status: tenderSession.status },
                })
              )
              dispatchTenderAnalysisUpdated()
              window.dispatchEvent(new Event("tender:sessions-updated"))
            } else if (tenderSession.status === "failed") {
              removePendingTenderAnalysis(item.sessionId)
              window.dispatchEvent(
                new CustomEvent<TenderAnalysisFailedDetail>(TENDER_ANALYSIS_FAILED, {
                  detail: {
                    sessionId: item.sessionId,
                    error: "Analysis failed. Please upload the file again.",
                  },
                })
              )
              dispatchTenderAnalysisUpdated()
              window.dispatchEvent(new Event("tender:sessions-updated"))
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
    window.addEventListener(TENDER_ANALYSIS_STARTED, onAnalysisStarted)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener(TENDER_ANALYSIS_STARTED, onAnalysisStarted)
    }
  }, [])

  return null
}
