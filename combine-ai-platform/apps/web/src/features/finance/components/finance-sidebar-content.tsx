"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Plus, Trash2, Receipt, GitCompare } from "lucide-react"

interface FinanceSessionSummary {
  id: string
  title: string
  sessionType: string
  status: string
  updatedAt: string
}

export function FinanceSidebarContent() {
  const pathname = usePathname()
  const router = useRouter()
  const [sessions, setSessions] = useState<FinanceSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const activeSessionId = pathname.startsWith("/finance/")
    ? decodeURIComponent(pathname.split("/").pop() || "")
    : null

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/sessions")
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch (err) {
      console.error("Failed to load finance sessions:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const handler = () => fetchSessions()
    window.addEventListener("finance:sessions-updated", handler)
    return () => window.removeEventListener("finance:sessions-updated", handler)
  }, [fetchSessions])

  const handleCreateSession = useCallback(async (sessionType: string) => {
    const id = `finance-${Date.now()}`
    const res = await fetch("/api/finance/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: `Expense Review ${new Date().toLocaleDateString()}`, sessionType }),
    })
    if (res.ok) {
      const data = await res.json()
      setSessions(data.sessions || [])
      router.push(`/finance/${sessionType === "THREE_WAY_MATCH" ? "three-way-match" : "expense-review"}/${id}`)
    }
  }, [router])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (pendingDelete === sessionId) {
      const res = await fetch(`/api/finance/sessions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
      })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
        if (activeSessionId === sessionId) {
          const next = data.sessions?.[0]
          router.push(next ? `/finance/expense-review/${next.id}` : "/finance")
        }
      }
      setPendingDelete(null)
    } else {
      setPendingDelete(sessionId)
    }
  }, [activeSessionId, pendingDelete, router])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-HK", { month: "short", day: "numeric" })
  }

  const expenseSessions = sessions.filter(s => s.sessionType === "EXPENSE_REVIEW")
  const matchSessions = sessions.filter(s => s.sessionType === "THREE_WAY_MATCH")

  return (
    <div className="px-2">
      {/* Quick Actions */}
      <div className="mb-3 space-y-1">
        <button
          onClick={() => handleCreateSession("EXPENSE_REVIEW")}
          className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
        >
          <Receipt className="h-4 w-4" />
          New Expense Review
        </button>
        <button
          onClick={() => handleCreateSession("THREE_WAY_MATCH")}
          className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
        >
          <GitCompare className="h-4 w-4" />
          New 3-Way Match
        </button>
      </div>

      {/* Expense Review Sessions */}
      {expenseSessions.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Expense Reviews
          </h3>
          <nav className="space-y-0.5">
            {expenseSessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <div key={session.id} className="group relative">
                  <Link
                    href={`/finance/expense-review/${session.id}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <Receipt className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{session.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(session.updatedAt)}</p>
                    </div>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDeleteSession(session.id)
                    }}
                    className={cn(
                      "absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100",
                      pendingDelete === session.id && "opacity-100 text-destructive bg-destructive/10"
                    )}
                    title={pendingDelete === session.id ? "Click again to confirm delete" : "Delete session"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </nav>
        </div>
      )}

      {/* 3-Way Match Sessions */}
      {matchSessions.length > 0 && (
        <div>
          <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            3-Way Matches
          </h3>
          <nav className="space-y-0.5">
            {matchSessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <div key={session.id} className="group relative">
                  <Link
                    href={`/finance/three-way-match/${session.id}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <GitCompare className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{session.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(session.updatedAt)}</p>
                    </div>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDeleteSession(session.id)
                    }}
                    className={cn(
                      "absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100",
                      pendingDelete === session.id && "opacity-100 text-destructive bg-destructive/10"
                    )}
                    title={pendingDelete === session.id ? "Click again to confirm delete" : "Delete session"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </nav>
        </div>
      )}

      {loading && (
        <div className="space-y-2 px-2 py-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-muted" />
          ))}
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="px-2 py-4 text-center text-xs text-muted-foreground">
          <Receipt className="mx-auto mb-1 h-6 w-6 opacity-30" />
          No finance sessions yet.
        </div>
      )}

      {/* Policies Link */}
      <div className="mt-4 border-t pt-3">
        <Link
          href="/finance/policies"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Expense Policies
        </Link>
      </div>
    </div>
  )
}
