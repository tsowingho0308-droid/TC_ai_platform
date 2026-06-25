const LAST_PATH_KEY = "tender:last-path"

export interface TenderField {
  field: string
  value: string
}

export interface TenderItem {
  id: string
  name: string
  fileName?: string
  fields: TenderField[]
  type: string | null
}

export interface TenderEmailAttachment {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface TenderEmailSource {
  id: string
  subject: string
  senderName: string
  senderEmail: string
  body: string
  attachments: TenderEmailAttachment[]
}

export interface TenderPendingUploadFile {
  id: string
  file: File
}

export interface TenderAiCompareResult {
  keyDifferences?: string[]
  risksA?: string[]
  risksB?: string[]
  recommendation?: { preferred?: string; reason?: string } | null
  mockWarning?: string | null
}

export type TenderStreamingStatus =
  | "idle"
  | "connecting"
  | "thinking"
  | "done"
  | "error"

export interface TenderWorkspaceSnapshot {
  viewMode: "edit" | "compare"
  tenders: TenderItem[]
  model: string
  selectedTemplate: string | null
  activeSessionId: string | null
  error: string | null
  streamingStatus: TenderStreamingStatus
  confidence: number | null
  pendingFiles: TenderPendingUploadFile[]
  selectedUploadFileIds: string[]
  showDiffsOnly: boolean
  aiCompareResult: TenderAiCompareResult | null
  mockWarning: string | null
  emailSource: TenderEmailSource | null
  selectedAttachmentIds: string[]
}

let memoryWorkspace: TenderWorkspaceSnapshot | null = null
const sessionWorkspaceCache = new Map<string, TenderWorkspaceSnapshot>()

export function cacheTenderSessionWorkspace(
  sessionId: string,
  snapshot: TenderWorkspaceSnapshot
) {
  sessionWorkspaceCache.set(sessionId, { ...snapshot, activeSessionId: sessionId })
}

export function getCachedTenderSessionWorkspace(
  sessionId: string
): TenderWorkspaceSnapshot | null {
  const cached = sessionWorkspaceCache.get(sessionId)
  return cached ? { ...cached } : null
}

export function updateCachedTenderSessionWorkspace(
  sessionId: string,
  patch: Partial<TenderWorkspaceSnapshot>
) {
  const existing = sessionWorkspaceCache.get(sessionId)
  if (existing) {
    sessionWorkspaceCache.set(sessionId, { ...existing, ...patch, activeSessionId: sessionId })
  } else {
    sessionWorkspaceCache.set(sessionId, {
      viewMode: "edit",
      tenders: [],
      model: "",
      selectedTemplate: null,
      activeSessionId: sessionId,
      error: null,
      streamingStatus: "idle",
      confidence: null,
      pendingFiles: [],
      selectedUploadFileIds: [],
      showDiffsOnly: true,
      aiCompareResult: null,
      mockWarning: null,
      emailSource: null,
      selectedAttachmentIds: [],
      ...patch,
    })
  }
}

export function removeCachedTenderSessionWorkspace(sessionId: string) {
  sessionWorkspaceCache.delete(sessionId)
}

export function setTenderLastPath(path: string) {
  if (typeof window === "undefined") return
  if (!path.startsWith("/tender")) return
  sessionStorage.setItem(LAST_PATH_KEY, path)
}

export function getTenderLastPath(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(LAST_PATH_KEY)
}

export function getTenderAgentHref(): string {
  return getTenderLastPath() || "/tender"
}

export function getTenderWorkspace(): TenderWorkspaceSnapshot | null {
  return memoryWorkspace
}

export function saveTenderWorkspace(snapshot: TenderWorkspaceSnapshot) {
  memoryWorkspace = { ...snapshot }
}

export function clearTenderWorkspace() {
  memoryWorkspace = null
}

export const TENDER_NEW_ANALYZE_EVENT = "tender:new-analyze"

export function startNewTenderAnalyze() {
  setTenderLastPath("/tender")
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(TENDER_NEW_ANALYZE_EVENT))
  }
}
