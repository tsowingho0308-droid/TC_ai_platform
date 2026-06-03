// Shared TypeScript types for the Combine AI Platform
// Re-exports from each domain

// ── Auth ─────────────────────────────────────
export interface LoginRequest {
  email: string
  password: string
}

export interface SignupRequest {
  email: string
  password: string
  name: string
  workspaceName: string
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  workspaceId: string
  workspaceName: string
  uiLanguage: string
}

// ── Email ────────────────────────────────────
export interface MailboxFolder {
  id: string
  name: string
  count: number
}

export interface ConversationSummary {
  id: string
  inboxId: string
  subject: string
  senderName: string
  senderEmail: string
  preview: string
  read: boolean
  starred: boolean
  labels: string[]
  status: string
  workType: string | null
  aiTriagedAt: string | null
  aiRouteConfidence: number | null
  folderId: string
  createdAt: string
  updatedAt: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageDetail[]
  inquiryTasks: InquiryTaskSummary[]
  finalReplyDraft: string | null
  finalReplyStatus: string | null
}

export interface MessageDetail {
  id: string
  direction: "INBOUND" | "OUTBOUND" | "NOTE"
  body: string
  bodyText: string | null
  bodyHtml: string | null
  createdAt: string
}

export interface InquiryTaskSummary {
  id: string
  inboxId: string
  questionTitle: string
  questionBody: string
  status: string
  confidence: number | null
  sortOrder: number
}

// ── Report ───────────────────────────────────
export interface TableRow {
  field: string
  value: string
}

export interface ReportSessionSummary {
  id: string
  title: string
  status: string
  updatedAt: string
}

export interface ReportSessionDetail extends ReportSessionSummary {
  rows: TableRow[]
  draftNote: string | null
  turns: ConversationTurn[]
}

export interface ConversationTurn {
  id: string
  role: "user" | "assistant"
  content: string | null
  assistantReply: string | null
  trace: Record<string, unknown> | null
  createdAt: string
}

// ── Tender ───────────────────────────────────
export interface TenderTemplateSummary {
  id: string
  locale: string
  title: string
  scenario: string | null
  description: string | null
}

export interface TenderTemplateField {
  key: string
  expected: string
}

export interface TenderSessionSummary {
  id: string
  title: string
  templateId: string | null
  tenderType: string | null
  status: string
  updatedAt: string
}

export interface TenderComparisonResult {
  id: string
  title: string
  comparisonType: string
  comparisonData: Record<string, unknown> | null
  comparedTenderIds: string[]
  exportedFormat: string | null
  createdAt: string
}

// ── Agent Registry ──────────────────────────
export interface AgentInfo {
  id: string
  slug: string
  name: string
  nameZh: string | null
  description: string | null
  descriptionZh: string | null
  icon: string | null
  enabled: boolean
  sortOrder: number
}

// ── Finance ──────────────────────────────────
export interface FinanceSessionSummary {
  id: string
  title: string
  sessionType: string
  status: string
  updatedAt: string
}

export interface FinanceSessionDetail extends FinanceSessionSummary {
  extractedRows: TableRow[] | null
  policyResults: PolicyResult[] | null
  draftNote: string | null
  documents: FinanceDocumentInfo[]
  turns: ConversationTurn[]
}

export interface FinanceDocumentInfo {
  id: string
  docType: string
  fileName: string
  createdAt: string
}

export interface PolicyResult {
  rule: string
  passed: boolean
  detail: string
}

export interface ExpensePolicyInfo {
  id: string
  name: string
  rule: string
  description: string | null
  threshold: number | null
  unit: string | null
  enabled: boolean
}

export interface ThreeWayMatchResult {
  matchedItems: Array<{
    poItem: string
    grnQty: number
    invQty: number
    poPrice: number
    invPrice: number
    status: "match" | "qty_mismatch" | "price_mismatch" | "missing_grn" | "missing_po"
  }>
  summary: {
    totalMatchCount: number
    discrepancyCount: number
    totalPOAmount: number
    totalInvAmount: number
    variance: number
  }
  flags: string[]
}

// ── Helpdesk ─────────────────────────────────
export interface KnowledgeBaseSummary {
  id: string
  name: string
  slug: string
  department: string
  description: string | null
  articleCount?: number
}

export interface KnowledgeArticleInfo {
  id: string
  knowledgeBaseId: string
  title: string
  content: string
  tags: string[]
  language: string
  sourceDocName: string | null
  createdAt: string
  updatedAt: string
}

export interface HelpdeskTicketSummary {
  id: string
  question: string
  status: string
  department: string
  aiConfidence: number | null
  assignedToName: string | null
  createdAt: string
}

export interface HelpdeskTicketDetail extends HelpdeskTicketSummary {
  aiAnswer: string | null
  aiSources: Array<{ articleId: string; articleTitle: string; excerpt: string }> | null
  humanReply: string | null
  userId: string | null
  assignedToId: string | null
  resolvedAt: string | null
}

export interface HelpdeskAskResponse {
  answer: string
  sources: Array<{ articleId: string; articleTitle: string; excerpt: string }>
  confidence: number
  needsEscalation: boolean
  suggestedDepartment: string
}

// ── Workflow ─────────────────────────────────
export interface WorkflowTemplateSummary {
  id: string
  name: string
  description: string | null
  category: string
  stepCount: number
  isDefault: boolean
}

export interface WorkflowTemplateDetail extends WorkflowTemplateSummary {
  steps: WorkflowStep[]
}

export interface WorkflowStep {
  stepIndex: number
  title: string
  department: string
  description: string
  slaHours: number
}

export interface WorkflowRunSummary {
  id: string
  title: string
  category: string
  status: string
  targetPerson: Record<string, unknown> | null
  completedSteps: number
  totalSteps: number
  createdAt: string
  updatedAt: string
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  templateId: string | null
  steps: WorkflowStepRunInfo[]
}

export interface WorkflowStepRunInfo {
  id: string
  stepIndex: number
  title: string
  department: string
  assignedToId: string | null
  assignedToName: string | null
  status: string
  notes: string | null
  slaHours: number | null
  completedAt: string | null
}

export interface WorkflowDashboardStats {
  activeRuns: number
  totalSteps: number
  completedSteps: number
  overdueSteps: number
  byDepartment: Array<{ department: string; pending: number; completed: number; overdue: number }>
}
