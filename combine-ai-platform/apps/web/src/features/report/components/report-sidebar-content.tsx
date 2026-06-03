"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Plus, Trash2, Download, FileSpreadsheet } from "lucide-react"

interface ReportSession {
  id: string
  title: string
  status: string
  updatedAt: string
}

export function ReportSidebarContent() {
  const pathname = usePathname()
  const router = useRouter()
  const [sessions, setSessions] = useState<ReportSession[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const activeSessionId = pathname.startsWith("/report/")
    ? decodeURIComponent(pathname.split("/").pop() || "")
    : null

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/report/sessions")
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch (err) {
      console.error("Failed to load report sessions:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const handler = () => fetchSessions()
    window.addEventListener("report:sessions-updated", handler)
    return () => window.removeEventListener("report:sessions-updated", handler)
  }, [fetchSessions])

  const handleCreateSession = useCallback(async () => {
    const id = `report-${Date.now()}`
    const res = await fetch("/api/report/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: `New Report ${new Date().toLocaleDateString()}` }),
    })
    if (res.ok) {
      const data = await res.json()
      setSessions(data.sessions || [])
      router.push(`/report/${id}`)
    }
  }, [router])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (pendingDelete === sessionId) {
      // Confirm delete
      const res = await fetch(`/api/report/sessions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
      })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
        if (activeSessionId === sessionId) {
          const next = data.sessions?.[0]
          router.push(next ? `/report/${next.id}` : "/report")
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

  return (
    <div className="px-2">
      {/* New Session */}
      <button
        onClick={handleCreateSession}
        className="mb-3 flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="h-4 w-4" />
        New Report Session
      </button>

      {/* Session List */}
      <div>
        <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Report Sessions
        </h3>

        {loading ? (
          <div className="space-y-2 px-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            <FileSpreadsheet className="mx-auto mb-1 h-6 w-6 opacity-30" />
            No report sessions yet.<br />Upload a document to start.
          </div>
        ) : (
          <nav className="space-y-0.5">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              return (
                <div key={session.id} className="group relative">
                  <Link
                    href={`/report/${session.id}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0" />
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
        )}
      </div>

      {/* Batch Export */}
      {sessions.length > 1 && (
        <div className="mt-4 border-t pt-3">
          <Link
            href="/report/export"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <Download className="h-4 w-4" />
            Batch Export All
          </Link>
        </div>
      )}
    </div>
  )
}
