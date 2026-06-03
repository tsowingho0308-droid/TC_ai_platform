"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Plus, Trash2, MessageCircleQuestion, Ticket, BookOpen } from "lucide-react"

interface KnowledgeBaseSummary {
  id: string
  name: string
  slug: string
  department: string
}

interface HelpdeskTicketSummary {
  id: string
  question: string
  status: string
  department: string
  createdAt: string
}

const DEPARTMENT_ICONS: Record<string, string> = {
  HR: "👥",
  IT: "💻",
  ADMIN: "🏢",
  FINANCE: "💰",
  GENERAL: "📋",
}

export function HelpdeskSidebarContent() {
  const pathname = usePathname()
  const router = useRouter()
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([])
  const [tickets, setTickets] = useState<HelpdeskTicketSummary[]>([])
  const [loading, setLoading] = useState(true)

  const activeTicketId = pathname.startsWith("/helpdesk/tickets/")
    ? decodeURIComponent(pathname.split("/").pop() || "")
    : null

  const fetchData = useCallback(async () => {
    try {
      const [kbRes, ticketRes] = await Promise.all([
        fetch("/api/helpdesk/knowledge"),
        fetch("/api/helpdesk/tickets?limit=10"),
      ])
      if (kbRes.ok) {
        const data = await kbRes.json()
        setKnowledgeBases(data.knowledgeBases || [])
      }
      if (ticketRes.ok) {
        const data = await ticketRes.json()
        setTickets(data.tickets || [])
      }
    } catch (err) {
      console.error("Failed to load helpdesk data:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const handler = () => fetchData()
    window.addEventListener("helpdesk:data-updated", handler)
    return () => window.removeEventListener("helpdesk:data-updated", handler)
  }, [fetchData])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-HK", { month: "short", day: "numeric" })
  }

  return (
    <div className="px-2">
      {/* New Ticket */}
      <button
        onClick={() => router.push("/helpdesk?new=true")}
        className="mb-3 flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="h-4 w-4" />
        Ask a Question
      </button>

      {/* Knowledge Bases */}
      <div className="mb-3">
        <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Knowledge Bases
        </h3>
        {loading ? (
          <div className="space-y-2 px-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : knowledgeBases.length === 0 ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">
            <BookOpen className="mx-auto mb-1 h-5 w-5 opacity-30" />
            No knowledge bases yet.
          </div>
        ) : (
          <nav className="space-y-0.5">
            {knowledgeBases.map((kb) => {
              const isActive = pathname === `/helpdesk/knowledge/${kb.slug}`
              return (
                <Link
                  key={kb.id}
                  href={`/helpdesk/knowledge/${kb.slug}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <span className="text-xs">{DEPARTMENT_ICONS[kb.department] || "📋"}</span>
                  <span className="truncate">{kb.name}</span>
                </Link>
              )
            })}
          </nav>
        )}
      </div>

      {/* Recent Tickets */}
      <div>
        <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Recent Tickets
        </h3>
        {tickets.length === 0 && !loading ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">
            <Ticket className="mx-auto mb-1 h-5 w-5 opacity-30" />
            No tickets yet.
          </div>
        ) : (
          <nav className="space-y-0.5">
            {tickets.slice(0, 10).map((ticket) => {
              const isActive = ticket.id === activeTicketId
              return (
                <Link
                  key={ticket.id}
                  href={`/helpdesk/tickets/${ticket.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <div className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    ticket.status === "OPEN" && "bg-amber-500",
                    ticket.status === "ANSWERED" && "bg-green-500",
                    ticket.status === "ESCALATED" && "bg-red-500",
                    ticket.status === "CLOSED" && "bg-muted-foreground"
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{ticket.question.slice(0, 40)}</p>
                    <p className="text-xs text-muted-foreground">
                      {DEPARTMENT_ICONS[ticket.department] || ""} {formatDate(ticket.createdAt)}
                    </p>
                  </div>
                </Link>
              )
            })}
          </nav>
        )}
      </div>

      {/* Knowledge Base Management */}
      <div className="mt-4 border-t pt-3">
        <Link
          href="/helpdesk/knowledge"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          <BookOpen className="h-4 w-4" />
          Manage Knowledge Bases
        </Link>
      </div>
    </div>
  )
}
