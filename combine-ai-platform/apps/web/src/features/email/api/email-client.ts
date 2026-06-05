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

interface AttachmentSummary {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  messageId: string
  createdAt: string
}

interface ConversationDetail extends ConversationSummary {
  replyTo: string
  messages: MessageDetail[]
  attachments: AttachmentSummary[]
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
  const conversation = data.conversation
  if (!conversation) throw new Error("Failed to load conversation")
  return {
    ...conversation,
    attachments: conversation.attachments ?? [],
  }
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

export async function disconnectGmail(inboxId: string): Promise<void> {
  const res = await fetch("/api/email/integrations?action=disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inboxId }),
  })
  if (!res.ok) throw new Error("Failed to disconnect Gmail")
}

export async function syncGmail(inboxId: string): Promise<string> {
  const res = await fetch("/api/email/integrations?action=sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inboxId }),
  })
  const data = await res.json().catch(() => ({})) as { syncRunId?: string; detail?: string; error?: string }
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Failed to start sync")
  }
  return data.syncRunId || ""
}

export interface ComposeUploadedFile {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  textExcerpt: string
}

export async function uploadComposeFile(file: File): Promise<ComposeUploadedFile> {
  const formData = new FormData()
  formData.append("file", file)
  const res = await fetch("/api/email/compose/files", { method: "POST", body: formData })
  const data = await res.json().catch(() => ({})) as ComposeUploadedFile & { error?: string; detail?: string }
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Failed to upload file")
  }
  return data
}

export async function removeComposeFile(id: string): Promise<void> {
  const res = await fetch(`/api/email/compose/files?id=${encodeURIComponent(id)}`, { method: "DELETE" })
  if (!res.ok) throw new Error("Failed to remove file")
}

export async function generateComposeDraft(params: {
  brief: string
  model?: string
  to?: string
  subject?: string
  context?: string
  recipientName?: string
  conversationId?: string
}): Promise<{ to: string; subject: string; body: string; draft: string }> {
  const res = await fetch("/api/email/agent?action=compose-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({})) as {
    to?: string
    subject?: string
    body?: string
    draft?: string
    error?: string
    detail?: string
  }
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Failed to generate draft")
  }
  const bodyText = data.body || data.draft || ""
  return {
    to: data.to || "",
    subject: data.subject || "",
    body: bodyText,
    draft: bodyText,
  }
}

export async function rewriteComposeBody(params: {
  model?: string
  to?: string
  subject?: string
  body: string
}): Promise<{ body: string }> {
  const res = await fetch("/api/email/agent?action=compose-rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({})) as { body?: string; error?: string; detail?: string }
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Failed to rewrite email")
  }
  return { body: data.body || params.body }
}

export async function sendEmail(params: {
  to: string
  subject: string
  body: string
  inboxId?: string
  conversationId?: string
  attachmentIds?: string[]
}): Promise<{ messageId: string; threadId: string }> {
  const hasAttachments = (params.attachmentIds?.length ?? 0) > 0
  const res = await fetch("/api/email/send", {
    method: "POST",
    headers: hasAttachments ? undefined : { "Content-Type": "application/json" },
    body: hasAttachments
      ? (() => {
          const formData = new FormData()
          formData.append("to", params.to)
          formData.append("subject", params.subject)
          formData.append("body", params.body)
          if (params.inboxId) formData.append("inboxId", params.inboxId)
          if (params.conversationId) formData.append("conversationId", params.conversationId)
          formData.append("attachmentIds", JSON.stringify(params.attachmentIds))
          return formData
        })()
      : JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({})) as {
    messageId?: string
    threadId?: string
    error?: string
    detail?: string
  }
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Failed to send email")
  }
  return { messageId: data.messageId || "", threadId: data.threadId || "" }
}
