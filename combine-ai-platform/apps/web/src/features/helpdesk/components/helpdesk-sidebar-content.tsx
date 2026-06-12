"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Ticket } from "lucide-react"

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
  const [tickets, setTickets] = useState<HelpdeskTicketSummary[]>([])
  const [loading, setLoading] = useState(true)

  const activeTicketId = pathname.startsWith("/helpdesk/tickets/")
    ? decodeURIComponent(pathname.split("/").pop() || "")
    : null

  const fetchData = useCallback(async () => {
    try {
      const ticketRes = await fetch("/api/helpdesk/tickets?limit=10")
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

      {/* Quick Links */}
      <div className="mt-4 border-t pt-3 space-y-0.5">
        <Link
          href="/helpdesk/tickets"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          <Ticket className="h-4 w-4" />
          View All Tickets
        </Link>
      </div>
    </div>
  )
}
