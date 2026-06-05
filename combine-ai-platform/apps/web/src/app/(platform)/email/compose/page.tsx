"use client"

import { useSearchParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, Suspense } from "react"
import Link from "next/link"
import { ArrowLeft, Bot, Loader2, MessageSquare, Paperclip, Send, Sparkles, X } from "lucide-react"
import {
  type ComposeUploadedFile,
  generateComposeDraft,
  getConversation,
  getIntegrationStatus,
  removeComposeFile,
  rewriteComposeBody,
  sendEmail,
  uploadComposeFile,
} from "@/features/email/api/email-client"

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ComposeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [brief, setBrief] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [to, setTo] = useState("")
  const [attachments, setAttachments] = useState<ComposeUploadedFile[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [primaryInboxId, setPrimaryInboxId] = useState<string | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [sending, setSending] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fromTender = searchParams.get("fromTender")
  const fromReport = searchParams.get("fromReport")
  const replyTo = searchParams.get("replyTo")

  const loadContext = useCallback(async () => {
    try {
      const [inboxRes, integrations] = await Promise.all([
        fetch("/api/email/inboxes?kind=PRIMARY").then((r) => r.json()),
        getIntegrationStatus(),
      ])
      const primary = inboxRes.inboxes?.[0]
      if (primary?.id) setPrimaryInboxId(primary.id)

      const gmail = integrations.find((i) => i.provider === "GMAIL")
      setGmailConnected(gmail?.status === "CONNECTED")
      setGmailEmail(gmail?.externalEmail || null)
    } catch {
      setGmailConnected(false)
    }
  }, [])

  useEffect(() => {
    loadContext()
  }, [loadContext])

  useEffect(() => {
    if (!replyTo) return
    setConversationId(replyTo)
    getConversation(replyTo).catch(console.error)
  }, [replyTo])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    setUploadingFile(true)
    setErrorMessage(null)
    try {
      const uploaded = await uploadComposeFile(file)
      setAttachments((prev) => [...prev, uploaded])
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to upload file")
    } finally {
      setUploadingFile(false)
    }
  }

  async function handleRemoveFile(id: string) {
    try {
      await removeComposeFile(id)
      setAttachments((prev) => prev.filter((f) => f.id !== id))
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to remove file")
    }
  }

  async function handleGenerateDraft() {
    if (!brief.trim() && !conversationId) {
      setErrorMessage("Brief is required.")
      return
    }

    setGeneratingDraft(true)
    setErrorMessage(null)
    try {
      const contextParts: string[] = []
      if (fromTender) contextParts.push(`Tender reference: ${fromTender}`)
      if (fromReport) contextParts.push(`Report reference: ${fromReport}`)

      const result = await generateComposeDraft({
        brief,
        to: to || undefined,
        subject: subject || undefined,
        context: contextParts.join("\n") || undefined,
        conversationId: conversationId || undefined,
      })

      if (result.to) setTo(result.to)
      if (result.subject) setSubject(result.subject)
      setBody(result.body)
      setStatusMessage("Done.")
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to generate draft")
    } finally {
      setGeneratingDraft(false)
    }
  }

  async function handleRewrite() {
    if (!body.trim()) {
      setErrorMessage("Content is required.")
      return
    }

    setRewriting(true)
    setErrorMessage(null)
    try {
      const { body: rewritten } = await rewriteComposeBody({ to, subject, body })
      setBody(rewritten)
      setStatusMessage("Done.")
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to rewrite email")
    } finally {
      setRewriting(false)
    }
  }

  async function handleSend() {
    if (!gmailConnected) {
      setErrorMessage("Gmail is not connected.")
      return
    }
    if (!to || !isValidEmail(to)) {
      setErrorMessage("Valid recipient email is required.")
      return
    }
    if (!subject.trim()) {
      setErrorMessage("Subject is required.")
      return
    }
    if (!body.trim()) {
      setErrorMessage("Content is required.")
      return
    }

    setSending(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const attachmentIds = attachments.map((f) => f.id)
      await sendEmail({
        to,
        subject: subject.trim(),
        body: body.trim(),
        inboxId: primaryInboxId || undefined,
        conversationId: conversationId || undefined,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      })
      setStatusMessage(`Sent to ${to}.`)
      window.setTimeout(() => router.push("/email?folder=sent"), 1200)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to send email")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <Link href="/email" className="rounded-md p-1 hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">New Message</h1>
        {(fromTender || fromReport) && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {fromTender ? "Tender" : "Report"}
          </span>
        )}
        {replyTo && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Reply
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <section className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Email Brief</h2>
            </div>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={7}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={generatingDraft || (!brief.trim() && !conversationId)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {generatingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generatingDraft ? "..." : "AI Draft"}
              </button>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold">Email Draft</h2>

            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">To</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full border-b bg-transparent px-0 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border-b bg-transparent px-0 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">Content</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-muted-foreground">Attachments</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.pdf,.doc,.docx,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {uploadingFile ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" />
                  )}
                  Upload
                </button>

                {attachments.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                  >
                    {file.fileName} ({formatFileSize(file.sizeBytes)})
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(file.id)}
                      className="rounded p-0.5 hover:bg-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer className="border-t px-6 py-3">
        <div className="mx-auto max-w-3xl space-y-2">
          {(statusMessage || errorMessage) && (
            <p className={`text-xs ${errorMessage ? "text-destructive" : "text-muted-foreground"}`}>
              {errorMessage || statusMessage}
            </p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {gmailConnected && gmailEmail ? gmailEmail : ""}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRewrite}
                disabled={rewriting || !body.trim()}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {rewriting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
                {rewriting ? "..." : "AI Rewrite"}
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !gmailConnected}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sending ? "..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading...</div>}>
      <ComposeContent />
    </Suspense>
  )
}
