import type { PendingUploadFile } from "@/features/report/components/report-upload-queue"
import { fileNeedsBlobUrl, previewKindFromFile } from "@/features/report/lib/report-preview-kind"

const LAST_PATH_KEY = "report:last-path"

export interface ReportAnalyzeTableRow {
  field: string
  value: string
  page?: number
}

export interface ReportAnalyzeSummary {
  summary: string
  keyPoints: string[]
  kbReferences: Array<{
    articleTitle: string
    knowledgeBaseName: string
    relevance: string
  }>
  searchType: "semantic" | "keyword" | "none"
}

export interface ReportEmailAttachment {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface ReportEmailSource {
  id: string
  subject: string
  senderName: string
  senderEmail: string
  body: string
  attachments: ReportEmailAttachment[]
}

export interface ReportFocusTarget {
  page?: number
  field: string
  value: string
}

export type ReportStreamingStatus =
  | "idle"
  | "connecting"
  | "thinking"
  | "highlighting"
  | "done"
  | "error"

export interface ReportAnalyzeWorkspaceSnapshot {
  emailSource: ReportEmailSource | null
  selectedAttachmentIds: string[]
  extractedRows: ReportAnalyzeTableRow[]
  kbHighlightPhrases: string[]
  highlightEnabled: boolean
  activePreviewId: string | null
  focusTarget: ReportFocusTarget | null
  selectedTableRowIndex: number | null
  activeSessionId: string | null
  sessionId: string | null
  pendingFiles: PendingUploadFile[]
  selectedUploadFileIds: string[]
  reportSummary: ReportAnalyzeSummary | null
  model: string
  previewFile: File | null
  documentType: string | null
  confidence: number | null
  streamingStatus: ReportStreamingStatus
  refineInstruction: string
  rowsManuallyEdited: boolean
  error: string | null
  mockWarning: string | null
}

interface StoredAnalyzeWorkspace extends Omit<ReportAnalyzeWorkspaceSnapshot, "pendingFiles" | "previewFile" | "selectedUploadFileIds"> {
  pendingFiles: PendingUploadFile[]
  previewFile: File | null
  selectedUploadFileIds: string[]
  previewUrl: string | null
}

let memoryWorkspace: StoredAnalyzeWorkspace | null = null

export function setReportLastPath(path: string) {
  if (typeof window === "undefined") return
  if (!path.startsWith("/report")) return
  sessionStorage.setItem(LAST_PATH_KEY, path)
}

export function getReportLastPath(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(LAST_PATH_KEY)
}

export function getReportAgentHref(): string {
  return getReportLastPath() || "/report"
}

function recreatePreviewUrl(previewFile: File | null, existingUrl: string | null): string | null {
  if (!previewFile) return null
  if (existingUrl) return existingUrl
  const kind = previewKindFromFile(previewFile)
  return fileNeedsBlobUrl(kind) ? URL.createObjectURL(previewFile) : null
}

export function getReportAnalyzeWorkspace(): ReportAnalyzeWorkspaceSnapshot & { previewUrl: string | null } | null {
  if (!memoryWorkspace) return null

  const previewUrl = recreatePreviewUrl(memoryWorkspace.previewFile, memoryWorkspace.previewUrl)

  return {
    emailSource: memoryWorkspace.emailSource,
    selectedAttachmentIds: memoryWorkspace.selectedAttachmentIds,
    extractedRows: memoryWorkspace.extractedRows,
    kbHighlightPhrases: memoryWorkspace.kbHighlightPhrases,
    highlightEnabled: memoryWorkspace.highlightEnabled,
    activePreviewId: memoryWorkspace.activePreviewId,
    focusTarget: memoryWorkspace.focusTarget,
    selectedTableRowIndex: memoryWorkspace.selectedTableRowIndex,
    activeSessionId: memoryWorkspace.activeSessionId,
    sessionId: memoryWorkspace.sessionId,
    pendingFiles: memoryWorkspace.pendingFiles,
    selectedUploadFileIds: memoryWorkspace.selectedUploadFileIds,
    reportSummary: memoryWorkspace.reportSummary,
    model: memoryWorkspace.model,
    previewFile: memoryWorkspace.previewFile,
    documentType: memoryWorkspace.documentType,
    confidence: memoryWorkspace.confidence,
    streamingStatus: memoryWorkspace.streamingStatus,
    refineInstruction: memoryWorkspace.refineInstruction,
    rowsManuallyEdited: memoryWorkspace.rowsManuallyEdited,
    error: memoryWorkspace.error,
    mockWarning: memoryWorkspace.mockWarning,
    previewUrl,
  }
}

export function saveReportAnalyzeWorkspace(snapshot: ReportAnalyzeWorkspaceSnapshot & { previewUrl: string | null }) {
  memoryWorkspace = {
    emailSource: snapshot.emailSource,
    selectedAttachmentIds: snapshot.selectedAttachmentIds,
    extractedRows: snapshot.extractedRows,
    kbHighlightPhrases: snapshot.kbHighlightPhrases,
    highlightEnabled: snapshot.highlightEnabled,
    activePreviewId: snapshot.activePreviewId,
    focusTarget: snapshot.focusTarget,
    selectedTableRowIndex: snapshot.selectedTableRowIndex,
    activeSessionId: snapshot.activeSessionId,
    sessionId: snapshot.sessionId,
    pendingFiles: snapshot.pendingFiles,
    selectedUploadFileIds: snapshot.selectedUploadFileIds,
    reportSummary: snapshot.reportSummary,
    model: snapshot.model,
    previewFile: snapshot.previewFile,
    documentType: snapshot.documentType,
    confidence: snapshot.confidence,
    streamingStatus: snapshot.streamingStatus,
    refineInstruction: snapshot.refineInstruction,
    rowsManuallyEdited: snapshot.rowsManuallyEdited,
    error: snapshot.error,
    mockWarning: snapshot.mockWarning,
    previewUrl: snapshot.previewUrl,
  }
}

export function clearReportAnalyzeWorkspace() {
  if (memoryWorkspace?.previewUrl) {
    URL.revokeObjectURL(memoryWorkspace.previewUrl)
  }
  memoryWorkspace = null
}

export const REPORT_NEW_ANALYZE_EVENT = "report:new-analyze"

export function startNewReportAnalyze() {
  clearReportAnalyzeWorkspace()
  setReportLastPath("/report")
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REPORT_NEW_ANALYZE_EVENT))
  }
}

export function hasRestoredReportAnalyzeWorkspace(): boolean {
  return memoryWorkspace !== null
}
