import type {
  TenderAiCompareResult,
  TenderItem,
} from "@/features/tender/lib/tender-workspace-store"

export const TENDER_WORKSPACE_KEY = "__workspace"

export type TenderAnalysisState = "processing" | "completed" | "failed"

export interface TenderAnalysisProgress {
  totalFiles: number
  completedFiles: number
  failedFiles?: number
  fileNames: string[]
  errors?: Array<{ fileName: string; error: string }>
}

export interface TenderSessionWorkspace {
  version: 1
  tenders: TenderItem[]
  viewMode: "edit" | "compare"
  showDiffsOnly: boolean
  selectedTemplate: string | null
  model: string
  aiCompareResult?: TenderAiCompareResult | null
  analysisState?: TenderAnalysisState
  pendingFileNames?: string[]
  analysisProgress?: TenderAnalysisProgress
}

export interface TenderBatchAnalysisState {
  totalFiles: number
  completedFiles: number
  failedFiles?: number
  fileNames: string[]
  errors?: Array<{ fileName: string; error: string }>
}

const batchAnalysisBySession = new Map<string, TenderBatchAnalysisState>()

export function setTenderBatchAnalysis(sessionId: string, state: TenderBatchAnalysisState) {
  batchAnalysisBySession.set(sessionId, { ...state })
}

export function getTenderBatchAnalysis(sessionId: string): TenderBatchAnalysisState | null {
  const state = batchAnalysisBySession.get(sessionId)
  return state ? { ...state } : null
}

export function incrementTenderBatchCompleted(sessionId: string): TenderBatchAnalysisState | null {
  const state = batchAnalysisBySession.get(sessionId)
  if (!state) return null
  const next = { ...state, completedFiles: state.completedFiles + 1 }
  batchAnalysisBySession.set(sessionId, next)
  return next
}

export function clearTenderBatchAnalysis(sessionId: string) {
  batchAnalysisBySession.delete(sessionId)
}

export function finishTenderBatchFile(sessionId: string): TenderBatchAnalysisState | null {
  return incrementTenderBatchCompleted(sessionId)
}

export function isTenderBatchComplete(
  workspace?: Pick<TenderSessionWorkspace, "analysisProgress"> | null
): boolean {
  const progress = workspace?.analysisProgress
  if (!progress || progress.totalFiles <= 0) return true
  return progress.completedFiles + (progress.failedFiles ?? 0) >= progress.totalFiles
}

export function isTenderBatchInProgress(sessionId: string): boolean {
  const batch = batchAnalysisBySession.get(sessionId)
  if (!batch) return false
  return batch.completedFiles + (batch.failedFiles ?? 0) < batch.totalFiles
}

export function getTenderEffectiveStatus(
  workspace: Pick<TenderSessionWorkspace, "analysisProgress" | "analysisState"> | null | undefined,
  dbStatus: string
): string {
  if (workspace?.analysisState === "processing") return "processing"
  if (workspace?.analysisProgress && !isTenderBatchComplete(workspace)) return "processing"
  return dbStatus
}

export function normalizeTenderViewMode(
  viewMode: "edit" | "compare",
  tenderCount: number
): "edit" | "compare" {
  return tenderCount >= 2 && viewMode === "compare" ? "compare" : "edit"
}

export interface ExtractedTenderForMerge {
  fileName?: string
  fields: Array<{ field: string; value: string }>
  tenderTitle?: string
  tenderType?: string | null
}

export function mergeExtractedTenderIntoWorkspace(
  preservedWorkspace: unknown,
  extracted: ExtractedTenderForMerge
): TenderSessionWorkspace {
  const resolvedFileName = extracted.fileName || "Tender Analysis"
  const newTender: TenderItem = {
    id: `tender-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name:
      extracted.tenderTitle ||
      resolvedFileName.replace(/\.(pdf|docx?|txt)$/i, ""),
    fileName: resolvedFileName,
    fields: extracted.fields,
    type: extracted.tenderType ?? null,
  }

  let base: TenderSessionWorkspace
  if (
    preservedWorkspace &&
    typeof preservedWorkspace === "object" &&
    !Array.isArray(preservedWorkspace)
  ) {
    const data = preservedWorkspace as Partial<TenderSessionWorkspace>
    base = {
      version: 1,
      tenders: Array.isArray(data.tenders) ? [...data.tenders] : [],
      viewMode: data.viewMode === "compare" ? "compare" : "edit",
      showDiffsOnly: data.showDiffsOnly ?? true,
      selectedTemplate: data.selectedTemplate ?? null,
      model: data.model ?? "",
      aiCompareResult: data.aiCompareResult ?? null,
      analysisState: data.analysisState,
      pendingFileNames: data.pendingFileNames,
      analysisProgress: data.analysisProgress,
    }
  } else {
    base = {
      version: 1,
      tenders: [],
      viewMode: "edit",
      showDiffsOnly: true,
      selectedTemplate: null,
      model: "",
    }
  }

  const existingIdx = base.tenders.findIndex(
    (t) => t.fileName && t.fileName === resolvedFileName
  )
  if (existingIdx >= 0) {
    base.tenders[existingIdx] = newTender
  } else {
    base.tenders.push(newTender)
  }

  base.viewMode = normalizeTenderViewMode(base.viewMode, base.tenders.length)
  return base
}

export function packTenderProcessingMarker(options: {
  fileNames: string[]
  model: string
  selectedTemplate: string | null
  showDiffsOnly?: boolean
}): Record<string, unknown> {
  const workspace: TenderSessionWorkspace = {
    version: 1,
    tenders: [],
    viewMode: "edit",
    showDiffsOnly: options.showDiffsOnly ?? true,
    selectedTemplate: options.selectedTemplate,
    model: options.model,
    analysisState: "processing",
    pendingFileNames: options.fileNames,
    analysisProgress: {
      totalFiles: options.fileNames.length,
      completedFiles: 0,
      failedFiles: 0,
      fileNames: options.fileNames,
      errors: [],
    },
  }
  return {
    [TENDER_WORKSPACE_KEY]: workspace,
  }
}

export function packTenderFieldInputs(
  workspace: TenderSessionWorkspace
): Record<string, unknown> {
  const flat: Record<string, string> = {}
  const primary = workspace.tenders[0]
  if (primary) {
    for (const field of primary.fields) {
      if (field.field.trim()) flat[field.field] = field.value
    }
  }
  return {
    ...flat,
    [TENDER_WORKSPACE_KEY]: workspace,
  }
}

export function unpackTenderSessionWorkspace(
  fieldInputs: unknown,
  options?: { title?: string; fileName?: string }
): TenderSessionWorkspace | null {
  if (!fieldInputs || typeof fieldInputs !== "object" || Array.isArray(fieldInputs)) {
    return null
  }

  const record = fieldInputs as Record<string, unknown>
  const workspace = record[TENDER_WORKSPACE_KEY]
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace)) {
    const data = workspace as Partial<TenderSessionWorkspace>
    const hasTenders = Array.isArray(data.tenders) && data.tenders.length > 0
    const isProcessing = data.analysisState === "processing"
    const batchIncomplete =
      data.analysisProgress &&
      data.analysisProgress.completedFiles + (data.analysisProgress.failedFiles ?? 0) <
        data.analysisProgress.totalFiles
    if (hasTenders || isProcessing || batchIncomplete) {
      const tenders = hasTenders ? data.tenders! : []
      return {
        version: 1,
        tenders,
        viewMode: normalizeTenderViewMode(
          data.viewMode === "compare" ? "compare" : "edit",
          tenders.length
        ),
        showDiffsOnly: data.showDiffsOnly ?? true,
        selectedTemplate: data.selectedTemplate ?? null,
        model: data.model ?? "",
        aiCompareResult: data.aiCompareResult ?? null,
        analysisState: data.analysisState,
        pendingFileNames: data.pendingFileNames,
        analysisProgress: data.analysisProgress,
      }
    }
  }

  const flatEntries = Object.entries(record).filter(([key]) => key !== TENDER_WORKSPACE_KEY)
  if (flatEntries.length === 0) return null

  const fields = flatEntries.map(([field, value]) => ({
    field,
    value: typeof value === "string" ? value : String(value ?? ""),
  }))

  const name =
    options?.fileName?.replace(/\.(pdf|docx?|txt)$/i, "") ||
    options?.title ||
    "Tender Analysis"

  return {
    version: 1,
    tenders: [
      {
        id: `tender-restored-${Date.now()}`,
        name,
        fileName: options?.fileName,
        fields,
        type: null,
      },
    ],
    viewMode: "edit",
    showDiffsOnly: true,
    selectedTemplate: null,
    model: "",
    aiCompareResult: null,
  }
}

export function deriveTenderSessionTitle(tenders: TenderItem[], fallback?: string): string {
  if (tenders.length === 1) {
    return tenders[0].fileName || tenders[0].name || fallback || "Tender Analysis"
  }
  if (tenders.length > 1) {
    return `Comparison (${tenders.length} tenders)`
  }
  return fallback || "Tender Analysis"
}

export function deriveTenderSessionType(tenders: TenderItem[]): string | null {
  if (tenders.length >= 2) return "comparison"
  return tenders[0]?.type ?? null
}
