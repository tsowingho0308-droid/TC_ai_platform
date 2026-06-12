"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { MessageCircleQuestion, Clock, CheckCircle, AlertCircle, User, ArrowRight, Filter } from "lucide-react"
import { cn, MarkdownContent } from "@combine-ai/shared-ui"
import { toast } from "sonner"

interface HelpdeskTicket {
  id: string
  question: string
  status: string
  department: string
  aiAnswer: string | null
  aiConfidence: number | null
  createdAt: string
  assignedToName: string | null
  userName: string | null
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  OPEN: <AlertCircle className="h-4 w-4 text-amber-500" />,
  ANSWERED: <MessageCircleQuestion className="h-4 w-4 text-blue-500" />,
  ESCALATED: <AlertCircle className="h-4 w-4 text-red-500" />,
  CLOSED: <CheckCircle className="h-4 w-4 text-green-500" />,
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  ANSWERED: "Answered",
  ESCALATED: "Escalated",
  CLOSED: "Closed",
}

const DEPARTMENT_OPTIONS = [
  { value: "", label: "All Departments" },
  { value: "HR", label: "HR" },
  { value: "IT", label: "IT" },
  { value: "ADMIN", label: "Admin" },
  { value: "FINANCE", label: "Finance" },
  { value: "GENERAL", label: "General" },
]

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "OPEN", label: "Open" },
  { value: "ANSWERED", label: "Answered" },
  { value: "ESCALATED", label: "Escalated" },
  { value: "CLOSED", label: "Closed" },
]

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDept, setFilterDept] = useState("")
  const [filterStatus, setFilterStatus] = useState("")

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/tickets?limit=100")
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || [])
      }
    } catch (err) {
      console.error("Failed to fetch tickets:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  const handleClaim = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "claim" }),
      })
      if (res.ok) {
        toast.success("Ticket claimed")
        fetchTickets()
      }
    } catch {
      toast.error("Failed to claim ticket")
    }
  }, [fetchTickets])

  const handleCloseTicket = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "CLOSED" }),
      })
      if (res.ok) {
        toast.success("Ticket closed")
        fetchTickets()
      }
    } catch {
      toast.error("Failed to close ticket")
    }
  }, [fetchTickets])

  const filtered = tickets.filter((t) => {
    if (filterDept && t.department !== filterDept) return false
    if (filterStatus && t.status !== filterStatus) return false
    return true
  })

  const openCount = tickets.filter((t) => t.status === "OPEN").length
  const answeredCount = tickets.filter((t) => t.status === "ANSWERED").length
  const escalatedCount = tickets.filter((t) => t.status === "ESCALATED").length

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Helpdesk Tickets</h1>
          <p className="text-xs text-muted-foreground">Manage and respond to internal support tickets</p>
        </div>
        <Link
          href="/helpdesk"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <MessageCircleQuestion className="h-4 w-4" />
          Ask a Question
        </Link>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 px-6 pt-4">
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{openCount}</p>
          <p className="text-xs text-muted-foreground">Open</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{answeredCount}</p>
          <p className="text-xs text-muted-foreground">Answered</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{escalatedCount}</p>
          <p className="text-xs text-muted-foreground">Escalated</p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-2xl font-bold">{tickets.length}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="rounded-md border bg-transparent px-2 py-1 text-xs"
        >
          {DEPARTMENT_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border bg-transparent px-2 py-1 text-xs"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Ticket List */}
      <div className="flex-1 overflow-y-auto px-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageCircleQuestion className="h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">No Tickets</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tickets.length === 0
                ? "When the AI cannot answer a question confidently, a ticket is automatically created."
                : "No tickets match the current filters."}
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-6">
            {filtered.map((ticket) => (
              <div
                key={ticket.id}
                className="flex items-start gap-4 rounded-lg border p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="mt-0.5">{STATUS_ICONS[ticket.status]}</div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/helpdesk/tickets/${ticket.id}`}
                    className="text-sm font-semibold hover:text-primary transition-colors line-clamp-1"
                  >
                    {ticket.question}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
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
                    <span>{STATUS_LABELS[ticket.status]}</span>
                    <span>·</span>
                    <span>
                      <Clock className="inline h-3 w-3 mr-0.5" />
                      {formatDate(ticket.createdAt)}
                    </span>
                    {ticket.userName && (
                      <>
                        <span>·</span>
                        <span>
                          <User className="inline h-3 w-3 mr-0.5" />
                          {ticket.userName}
                        </span>
                      </>
                    )}
                    {ticket.aiConfidence !== null && (
                      <>
                        <span>·</span>
                        <span>AI confidence: {Math.round(ticket.aiConfidence * 100)}%</span>
                      </>
                    )}
                  </div>
                  {ticket.aiAnswer && (
                    <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      <span className="text-xs text-muted-foreground">AI:</span> <MarkdownContent compact>{ticket.aiAnswer}</MarkdownContent>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {ticket.status === "OPEN" && (
                    <button
                      onClick={() => handleClaim(ticket.id)}
                      className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Claim
                    </button>
                  )}
                  <Link
                    href={`/helpdesk/tickets/${ticket.id}`}
                    className="rounded-md p-1.5 hover:bg-accent"
                    title="View details"
                  >
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
