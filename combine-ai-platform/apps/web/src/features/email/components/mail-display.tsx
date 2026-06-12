"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Bot, Send, FileText, ExternalLink, Paperclip, PencilLine, Receipt } from "lucide-react"
import {
  getConversation,
  generateReplySuggestion,
  classifyConversation,
  runConversationTriage,
  sendEmail,
} from "../api/email-client"
import { useCrossAgent } from "@/features/cross-agent/use-cross-agent"
import { cn } from "@combine-ai/shared-ui"
import { isInlineImageAttachment, prepareEmailHtml } from "@/lib/email-html"

interface ConversationDetail {
  id: string
  subject: string
  senderName: string
  senderEmail: string
  preview: string
  read: boolean
  status: string
  workType: string | null
  aiTriagedAt: string | null
  aiRouteConfidence: number | null
  aiIntentSummary: string | null
  messages: Array<{
    id: string
    direction: string
    body: string
    bodyText: string | null
    bodyHtml: string | null
    createdAt: string
  }>
  attachments: Array<{
    id: string
    fileName: string
    mimeType: string
    sizeBytes: number
    messageId: string
    contentId?: string | null
    createdAt: string
  }>
  inquiryTasks: Array<{
    id: string
    questionTitle: string
    questionBody: string
    status: string
    confidence: number | null
  }>
  finalReplyDraft: string | null
  finalReplyStatus: string | null
}

interface MailDisplayProps {
  conversationId: string | null
  onClose: () => void
}

export function MailDisplay({ conversationId, onClose }: MailDisplayProps) {
  const router = useRouter()
  const { openInTenderAgent, openInReportAgent, openInFinanceAgent, createLink } = useCrossAgent()
  const [conversation, setConversation] = useState<ConversationDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [replyDraft, setReplyDraft] = useState("")
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [triaging, setTriaging] = useState(false)
  const [openingTender, setOpeningTender] = useState(false)
  const [openingReport, setOpeningReport] = useState(false)
  const [openingFinance, setOpeningFinance] = useState(false)

  useEffect(() => {
    if (!conversationId) {
      setConversation(null)
      return
    }

    setLoading(true)
    getConversation(conversationId)
      .then(setConversation)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [conversationId])

  async function handleGenerateReply() {
    if (!conversationId) return
    setGenerating(true)
    try {
      const { suggestion } = await generateReplySuggestion(conversationId)
      setReplyDraft(suggestion.draftReply)
    } catch (err) {
      console.error("Failed to generate reply:", err)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSendReply() {
    if (!conversationId || !conversation || !replyDraft.trim()) return
    setSending(true)
    try {
      await sendEmail({
        to: conversation.senderEmail,
        subject: conversation.subject.startsWith("Re:")
          ? conversation.subject
          : `Re: ${conversation.subject}`,
        body: replyDraft.trim(),
        conversationId,
      })
      setReplyDraft("")
      const refreshed = await getConversation(conversationId)
      setConversation(refreshed)
    } catch (err) {
      console.error("Failed to send reply:", err)
    } finally {
      setSending(false)
    }
  }

  async function handleClassify() {
    if (!conversationId) return
    setClassifying(true)
    try {
      const result = await classifyConversation(conversationId)
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              workType: result.workType,
              aiTriagedAt: new Date().toISOString(),
              aiRouteConfidence: result.confidence,
              aiIntentSummary: result.summary,
            }
          : prev
      )
      const refreshed = await getConversation(conversationId)
      setConversation(refreshed)
    } catch (err) {
      console.error("Classification failed:", err)
    } finally {
      setClassifying(false)
    }
  }

  async function handleTriage() {
    if (!conversationId) return
    setTriaging(true)
    try {
      await runConversationTriage(conversationId)
      const refreshed = await getConversation(conversationId)
      setConversation(refreshed)
    } catch (err) {
      console.error("Triage failed:", err)
    } finally {
      setTriaging(false)
    }
  }

  const attachments = conversation?.attachments ?? []

  function getPrimaryDocumentAttachment() {
    if (!attachments.length) return null
    return (
      attachments.find(
        (att) =>
          att.mimeType === "application/pdf" ||
          att.fileName.toLowerCase().endsWith(".pdf") ||
          att.fileName.toLowerCase().endsWith(".docx")
      ) || attachments[0]
    )
  }

  async function handleOpenInTender() {
    if (!conversationId || !conversation) return
    setOpeningTender(true)
    try {
      const primaryAttachment = getPrimaryDocumentAttachment()
      await createLink({
        sourceType: "email",
        sourceId: conversationId,
        targetType: "tender",
        targetId: conversationId,
        linkType: primaryAttachment ? "attachment" : "reference",
      })
      await openInTenderAgent({
        sourceId: conversationId,
        subject: conversation.subject,
        attachmentId: primaryAttachment?.id,
        attachmentName: primaryAttachment?.fileName,
      })
    } catch (err) {
      console.error("Failed to open in Tender:", err)
    } finally {
      setOpeningTender(false)
    }
  }

  async function handleExtractWithReport() {
    if (!conversationId || !conversation) return
    setOpeningReport(true)
    try {
      const primaryAttachment = getPrimaryDocumentAttachment()
      await createLink({
        sourceType: "email",
        sourceId: conversationId,
        targetType: "report",
        targetId: conversationId,
        linkType: primaryAttachment ? "attachment" : "reference",
      })
      await openInReportAgent({
        sourceId: conversationId,
        subject: conversation.subject,
        attachmentId: primaryAttachment?.id,
        attachmentName: primaryAttachment?.fileName,
      })
    } catch (err) {
      console.error("Failed to extract with Report:", err)
    } finally {
      setOpeningReport(false)
    }
  }

  async function handleAnalyzeWithFinance() {
    if (!conversationId || !conversation) return
    setOpeningFinance(true)
    try {
      const primaryAttachment = getPrimaryDocumentAttachment()
      await createLink({
        sourceType: "email",
        sourceId: conversationId,
        targetType: "finance",
        targetId: conversationId,
        linkType: primaryAttachment ? "attachment" : "reference",
      })
      await openInFinanceAgent({
        sourceId: conversationId,
        subject: conversation.subject,
        attachmentId: primaryAttachment?.id,
        attachmentName: primaryAttachment?.fileName,
      })
    } catch (err) {
      console.error("Failed to analyze with Finance:", err)
    } finally {
      setOpeningFinance(false)
    }
  }

  if (!conversationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Select a conversation to view</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Conversation not found</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{conversation.subject}</h2>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{conversation.senderName} &lt;{conversation.senderEmail}&gt;</span>
        </div>

        {/* AI Classification */}
        {conversation.workType && (
          <div className="mt-2 flex items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium",
              conversation.workType === "commercial" ? "bg-orange-100 text-orange-700" :
              conversation.workType === "it" ? "bg-blue-100 text-blue-700" :
              "bg-green-100 text-green-700"
            )}>
              {conversation.workType.toUpperCase()}
            </span>
            {conversation.aiRouteConfidence != null && (
              <span className="text-xs text-muted-foreground">
                Confidence: {Math.round(conversation.aiRouteConfidence * 100)}%
              </span>
            )}
            {conversation.aiIntentSummary && (
              <p className="text-xs text-muted-foreground">{conversation.aiIntentSummary}</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex items-center gap-2">
          {!conversation.workType && (
            <button
              onClick={handleClassify}
              disabled={classifying}
              className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              <Bot className="h-3.5 w-3.5" />
              {classifying ? "Classifying..." : "AI Classify"}
            </button>
          )}
          <button
            onClick={handleTriage}
            disabled={triaging}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Bot className="h-3.5 w-3.5" />
            {triaging ? "Triaging..." : "AI Triage Split"}
          </button>
          <button
            onClick={handleGenerateReply}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Bot className="h-3.5 w-3.5" />
            {generating ? "Generating..." : "AI Reply Suggestion"}
          </button>
          <button
            onClick={() => router.push(`/email/compose?replyTo=${encodeURIComponent(conversationId || "")}`)}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent"
          >
            <PencilLine className="h-3.5 w-3.5" />
            Compose Reply
          </button>
          <button
            onClick={handleOpenInTender}
            disabled={openingTender}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {openingTender ? "Opening..." : "Open in Tender"}
          </button>
          <button
            onClick={handleExtractWithReport}
            disabled={openingReport}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            {openingReport ? "Opening..." : "Extract with Report"}
          </button>
          <button
            onClick={handleAnalyzeWithFinance}
            disabled={openingFinance}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Receipt className="h-3.5 w-3.5" />
            {openingFinance ? "Opening..." : "Analyze with Finance"}
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {conversation.messages.map((msg) => {
          const messageAttachments = attachments.filter((att) => att.messageId === msg.id)
          const fileAttachments = messageAttachments.filter((att) => !isInlineImageAttachment(att))
          const htmlBody = msg.bodyHtml
            ? prepareEmailHtml(msg.bodyHtml, messageAttachments)
            : null

          return (
          <div key={msg.id} className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">
                {msg.direction === "INBOUND" ? conversation.senderName : "You"}
              </span>
              <span>{new Date(msg.createdAt).toLocaleString()}</span>
            </div>
            {htmlBody ? (
              <div
                className="prose prose-sm max-w-none text-sm [&_img]:max-w-full [&_img]:h-auto [&_a]:text-primary [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: htmlBody }}
              />
            ) : (
              <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap">
                {msg.bodyText || msg.body}
              </div>
            )}
            {fileAttachments.map((att) => (
                <a
                  key={att.id}
                  href={`/api/email/attachments?action=download&id=${encodeURIComponent(att.id)}`}
                  className="mt-3 inline-flex items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-xs hover:bg-accent"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{att.fileName}</span>
                  <span className="text-muted-foreground">
                    ({Math.max(1, Math.round(att.sizeBytes / 1024))} KB)
                  </span>
                </a>
              ))}
          </div>
          )
        })}
      </div>

      {/* Inquiry Tasks */}
      {conversation.inquiryTasks.length > 0 && (
        <div className="border-t p-4">
          <h3 className="mb-2 text-sm font-semibold">AI Triage Tasks</h3>
          <div className="space-y-2">
            {conversation.inquiryTasks.map((task) => (
              <div key={task.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{task.questionTitle}</p>
                  <span className="text-xs text-muted-foreground">{task.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{task.questionBody}</p>
                {task.confidence != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Confidence: {Math.round(task.confidence * 100)}%
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reply Composer */}
      {replyDraft && (
        <div className="border-t p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">AI Reply Draft</h3>
            <button
              onClick={() => setReplyDraft("")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="rounded-md border p-3">
            <textarea
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              rows={6}
              className="w-full resize-none bg-transparent text-sm outline-none"
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleSendReply}
              disabled={sending || !replyDraft.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sending ? "Sending..." : "Send Reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
