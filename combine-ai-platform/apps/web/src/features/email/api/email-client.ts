// Client-side API for Email Agent

interface ConversationSummary {
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

interface ConversationDetail extends ConversationSummary {
  messages: MessageDetail[]
  inquiryTasks: InquiryTaskSummary[]
  aiIntentSummary: string | null
  finalReplyDraft: string | null
  finalReplyStatus: string | null
  parentConversation: { id: string; subject: string } | null
  childConversations: Array<{
    id: string
    subject: string
    status: string
    departmentReviewStatus: string | null
  }>
}

interface MessageDetail {
  id: string
  direction: "INBOUND" | "OUTBOUND" | "NOTE"
  body: string
  bodyText: string | null
  bodyHtml: string | null
  createdAt: string
}

interface InquiryTaskSummary {
  id: string
  inboxId: string
  questionTitle: string
  questionBody: string
  status: string
  confidence: number | null
  sortOrder: number
  childConversation: { id: string; subject: string; status: string } | null
}

export async function listConversations(params: {
  folder?: string
  inboxId?: string
  department?: string
  q?: string
}): Promise<ConversationSummary[]> {
  const sp = new URLSearchParams()
  if (params.folder) sp.set("folder", params.folder)
  if (params.inboxId) sp.set("inboxId", params.inboxId)
  if (params.department) sp.set("department", params.department)
  if (params.q) sp.set("q", params.q)

  const res = await fetch(`/api/email/mailbox?${sp}`)
  if (!res.ok) throw new Error("Failed to load conversations")
  const data = await res.json()
  return data.conversations || []
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/email/mailbox?conversationId=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error("Failed to load conversation")
  const data = await res.json()
  return data.conversation
}

export async function classifyConversation(conversationId: string): Promise<{
  workType: string
  summary: string
  confidence: number
  department: string
}> {
  const res = await fetch("/api/email/agent?action=classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  })
  if (!res.ok) throw new Error("Classification failed")
  const data = await res.json()
  return data.classification
}

export async function generateReplySuggestion(conversationId: string): Promise<{
  suggestion: { id: string; title: string; draftReply: string; status: string }
}> {
  const res = await fetch("/api/email/agent?action=reply-suggestion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  })
  if (!res.ok) throw new Error("Reply suggestion failed")
  return res.json()
}

export async function runConversationTriage(conversationId: string): Promise<{
  triage: {
    summary: string | null
    workType: string | null
    confidence: number | null
    tasks: Array<{
      id: string
      questionTitle: string
      questionBody: string
      status: string
      confidence: number | null
    }>
  }
}> {
  const res = await fetch("/api/email/agent?action=triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  })
  if (!res.ok) throw new Error("Triage failed")
  return res.json()
}

export async function updateConversation(
  id: string,
  action: string,
  body: Record<string, unknown> = {}
): Promise<void> {
  const res = await fetch(`/api/email/conversations?id=${encodeURIComponent(id)}&action=${action}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Failed to ${action} conversation`)
}

export async function getIntegrationStatus(): Promise<Array<{
  id: string
  inboxId: string
  provider: string
  status: string
  externalEmail: string | null
  lastSyncedAt: string | null
}>> {
  const res = await fetch("/api/email/integrations?action=status")
  if (!res.ok) throw new Error("Failed to load integrations")
  const data = await res.json()
  return data.integrations || []
}

export async function connectGmail(inboxId: string): Promise<string> {
  const res = await fetch(`/api/email/integrations?action=connect-url&inboxId=${encodeURIComponent(inboxId)}`)
  if (!res.ok) throw new Error("Failed to get connect URL")
  const data = await res.json()
  return data.url
}

export async function syncGmail(inboxId: string): Promise<string> {
  const res = await fetch("/api/email/integrations?action=sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inboxId }),
  })
  if (!res.ok) throw new Error("Failed to start sync")
  const data = await res.json()
  return data.syncRunId
}
