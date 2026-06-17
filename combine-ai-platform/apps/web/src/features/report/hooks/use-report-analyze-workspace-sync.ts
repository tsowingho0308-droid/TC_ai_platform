"use client"

import { useEffect, useRef } from "react"
import {
  saveReportAnalyzeWorkspace,
  type ReportAnalyzeWorkspaceSnapshot,
} from "@/features/report/lib/report-workspace-store"

export function useReportAnalyzeWorkspaceSync(
  snapshot: ReportAnalyzeWorkspaceSnapshot & { previewUrl: string | null }
) {
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useEffect(() => {
    saveReportAnalyzeWorkspace(snapshotRef.current)
  })

  useEffect(() => {
    return () => {
      saveReportAnalyzeWorkspace(snapshotRef.current)
    }
  }, [])
}
