"use client"

import { useEffect, useRef } from "react"
import {
  cacheTenderSessionWorkspace,
  saveTenderWorkspace,
  type TenderWorkspaceSnapshot,
} from "@/features/tender/lib/tender-workspace-store"

export function useTenderWorkspaceSync(snapshot: TenderWorkspaceSnapshot) {
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useEffect(() => {
    saveTenderWorkspace(snapshotRef.current)
    if (snapshotRef.current.activeSessionId) {
      cacheTenderSessionWorkspace(
        snapshotRef.current.activeSessionId,
        snapshotRef.current
      )
    }
  })

  useEffect(() => {
    return () => {
      saveTenderWorkspace(snapshotRef.current)
      if (snapshotRef.current.activeSessionId) {
        cacheTenderSessionWorkspace(
          snapshotRef.current.activeSessionId,
          snapshotRef.current
        )
      }
    }
  }, [])
}
