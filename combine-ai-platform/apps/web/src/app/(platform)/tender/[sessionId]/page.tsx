"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, AlertCircle } from "lucide-react"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import {
  cacheTenderSessionWorkspace,
  getCachedTenderSessionWorkspace,
  saveTenderWorkspace,
  setTenderLastPath,
  getTenderWorkspace,
} from "@/features/tender/lib/tender-workspace-store"
import {
  fetchTenderSessionById,
  resolveTenderSessionWorkspace,
} from "@/features/tender/lib/tender-session-loader"
import { isTenderAnalysisInProgress } from "@/features/tender/tender-analysis-tracker"
import {
  isTenderBatchComplete,
  setTenderBatchAnalysis,
} from "@/features/tender/lib/tender-session-workspace"

function syncBatchProgressFromWorkspace(
  sessionId: string,
  workspace: NonNullable<ReturnType<typeof resolveTenderSessionWorkspace>>
) {
  if (workspace.analysisProgress && !isTenderBatchComplete(workspace)) {
    setTenderBatchAnalysis(sessionId, {
      totalFiles: workspace.analysisProgress.totalFiles,
      completedFiles: workspace.analysisProgress.completedFiles,
      failedFiles: workspace.analysisProgress.failedFiles,
      fileNames: workspace.analysisProgress.fileNames,
      errors: workspace.analysisProgress.errors,
    })
  }
}

function hydrateTenderSession(
  sessionId: string,
  workspace: NonNullable<ReturnType<typeof resolveTenderSessionWorkspace>>,
  status: string
) {
  const isProcessing =
    status === "processing" || workspace.analysisState === "processing"

  const snapshot = {
    viewMode: workspace.viewMode,
    tenders: workspace.tenders,
    model: workspace.model || DEFAULT_MODELS.tender,
    selectedTemplate: workspace.selectedTemplate,
    activeSessionId: sessionId,
    error: null,
    streamingStatus: isProcessing ? ("thinking" as const) : ("done" as const),
    confidence: null,
    pendingFiles: [],
    selectedUploadFileIds: [],
    showDiffsOnly: workspace.showDiffsOnly,
    aiCompareResult: workspace.aiCompareResult ?? null,
    mockWarning: null,
    emailSource: null,
    selectedAttachmentIds: [],
  }

  saveTenderWorkspace(snapshot)
  cacheTenderSessionWorkspace(sessionId, snapshot)
  syncBatchProgressFromWorkspace(sessionId, workspace)
  setTenderLastPath("/tender")
}

export default function TenderSessionPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params?.sessionId as string
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    async function load() {
      const cached = getCachedTenderSessionWorkspace(sessionId)
      if (cached) {
        saveTenderWorkspace({ ...cached, activeSessionId: sessionId })
        setTenderLastPath("/tender")
        router.replace("/tender")
        return
      }

      const memory = getTenderWorkspace()
      if (
        memory?.activeSessionId === sessionId &&
        (memory.tenders.length > 0 ||
          memory.pendingFiles.length > 0 ||
          memory.streamingStatus === "thinking" ||
          memory.streamingStatus === "connecting")
      ) {
        saveTenderWorkspace(memory)
        setTenderLastPath("/tender")
        router.replace("/tender")
        return
      }

      const session = await fetchTenderSessionById(sessionId)
      if (cancelled) return

      if (!session) {
        setError("Session not found")
        return
      }

      const workspace = resolveTenderSessionWorkspace(session)
      const isProcessing =
        session.status === "processing" ||
        workspace?.analysisState === "processing" ||
        isTenderAnalysisInProgress(sessionId)

      if (isProcessing) {
        hydrateTenderSession(
          sessionId,
          workspace ?? {
            version: 1,
            tenders: [],
            viewMode: "edit",
            showDiffsOnly: true,
            selectedTemplate: null,
            model: DEFAULT_MODELS.tender,
            analysisState: "processing",
          },
          session.status
        )
        router.replace("/tender")
        return
      }

      if (!workspace || workspace.tenders.length === 0) {
        if (session.status === "failed") {
          setError("Analysis failed. Start a new analysis to upload documents.")
        } else {
          setError("This session has no saved analysis yet. Start a new analysis to upload documents.")
        }
        return
      }

      hydrateTenderSession(sessionId, workspace, session.status)
      router.replace("/tender")
    }

    void load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load session")
      }
    })

    return () => {
      cancelled = true
    }
  }, [sessionId, router])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <Link href="/tender" className="text-sm text-primary hover:underline">
            Back to Tender Agent
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading session...</p>
      </div>
    </div>
  )
}
