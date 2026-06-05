"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, MessageCircleQuestion, Clock, User, CheckCircle,
  XCircle, ExternalLink, AlertCircle, Send, Loader2
} from "lucide-react"
import { cn, MarkdownContent } from "@combine-ai/shared-ui"
import { toast } from "sonner"

interface TicketDetail {
  id: string
  question: string
  status: string
  department: string
  aiAnswer: string | null
  aiConfidence: number | null
  aiSources: Array<{ articleId: string; articleTitle: string; excerpt: string }> | null
  humanReply: string | null
  createdAt: string
  resolvedAt: string | null
  userName: string | null
  assignedToName: string | null
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function TicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/helpdesk/tickets?id=${id}`)
      if (!res.ok) throw new Error("Ticket not found")
      const data = await res.json()
      setTicket(data.ticket)
    } catch {
      toast.error("Failed to load ticket")
      router.push("/helpdesk/tickets")
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => { fetchTicket() }, [fetchTicket])

  const handleClaim = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "claim" }),
      })
      if (res.ok) {
        toast.success("Ticket claimed")
        fetchTicket()
      }
    } catch {
      toast.error("Failed to claim ticket")
    }
  }, [id, fetchTicket])

  const handleSendReply = useCallback(async () => {
    if (!reply.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, humanReply: reply, status: "ANSWERED" }),
      })
      if (res.ok) {
        toast.success("Reply sent")
        setReply("")
        fetchTicket()
      }
    } catch {
      toast.error("Failed to send reply")
    } finally {
      setSubmitting(false)
    }
  }, [id, reply, fetchTicket])

  const handleClose = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "CLOSED" }),
      })
      if (res.ok) {
        toast.success("Ticket closed")
        fetchTicket()
      }
    } catch {
      toast.error("Failed to close ticket")
    }
  }, [id, fetchTicket])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ticket) return null

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    OPEN: { icon: <AlertCircle className="h-4 w-4" />, label: "Open", color: "text-amber-600 bg-amber-50 border-amber-200" },
    ANSWERED: { icon: <MessageCircleQuestion className="h-4 w-4" />, label: "Answered", color: "text-blue-600 bg-blue-50 border-blue-200" },
    ESCALATED: { icon: <AlertCircle className="h-4 w-4" />, label: "Escalated", color: "text-red-600 bg-red-50 border-red-200" },
    CLOSED: { icon: <CheckCircle className="h-4 w-4" />, label: "Closed", color: "text-green-600 bg-green-50 border-green-200" },
  }

  const status = statusConfig[ticket.status] || statusConfig.OPEN

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/helpdesk/tickets")} className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold line-clamp-1">{ticket.question}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", status.color)}>
                {status.icon}
                {status.label}
              </span>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                ticket.department === "HR" && "bg-pink-100 text-pink-800",
                ticket.department === "IT" && "bg-blue-100 text-blue-800",
                ticket.department === "ADMIN" && "bg-gray-100 text-gray-800",
                ticket.department === "FINANCE" && "bg-green-100 text-green-800",
                ticket.department === "GENERAL" && "bg-yellow-100 text-yellow-800"
              )}>
                {ticket.department}
              </span>
              <span className="text-xs text-muted-foreground">
                <Clock className="inline h-3 w-3 mr-0.5" />
                {formatDate(ticket.createdAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ticket.status === "OPEN" && (
            <button
              onClick={handleClaim}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Claim Ticket
            </button>
          )}
          {(ticket.status === "ANSWERED" || ticket.status === "ESCALATED") && (
            <button
              onClick={handleClose}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Close Ticket
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Question */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium">{ticket.userName || "Employee"}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{ticket.question}</p>
              </div>
            </div>
          </div>

          {/* AI Answer */}
          {ticket.aiAnswer && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                  <MessageCircleQuestion className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">AI Assistant</span>
                    {ticket.aiConfidence !== null && (
                      <span className="text-xs text-muted-foreground">
                        Confidence: {Math.round(ticket.aiConfidence * 100)}%
                      </span>
                    )}
                  </div>
                  <MarkdownContent>{ticket.aiAnswer}</MarkdownContent>

                  {/* Sources */}
                  {ticket.aiSources && ticket.aiSources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-blue-200">
                      <p className="text-xs font-semibold text-blue-800 mb-1">Sources:</p>
                      {ticket.aiSources.map((s, i) => (
                        <div key={i} className="flex items-start gap-1 mt-1">
                          <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 text-blue-600" />
                          <div>
                            <span className="text-xs font-medium text-blue-700">{s.articleTitle}</span>
                            <p className="text-xs text-blue-600/70">{s.excerpt}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Human Reply */}
          {ticket.humanReply && (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">
                      {ticket.assignedToName || "Support Agent"}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{ticket.humanReply}</p>
                </div>
              </div>
            </div>
          )}

          {/* Reply Form (if not closed) */}
          {ticket.status !== "CLOSED" && (
            <div className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold mb-3">Reply to this ticket</h3>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type your reply here..."
                rows={4}
                className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={handleSendReply}
                  disabled={!reply.trim() || submitting}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send Reply
                </button>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="rounded-lg border p-4 text-xs text-muted-foreground">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="font-medium">Ticket ID:</span> {ticket.id}
              </div>
              <div>
                <span className="font-medium">Status:</span> {ticket.status}
              </div>
              <div>
                <span className="font-medium">Department:</span> {ticket.department}
              </div>
              <div>
                <span className="font-medium">Created:</span> {formatDate(ticket.createdAt)}
              </div>
              {ticket.resolvedAt && (
                <div>
                  <span className="font-medium">Resolved:</span> {formatDate(ticket.resolvedAt)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
