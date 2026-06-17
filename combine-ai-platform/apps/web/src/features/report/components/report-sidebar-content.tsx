"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Plus, Trash2, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { startNewReportAnalyze } from "@/features/report/lib/report-workspace-store"

interface ReportSession {
  id: string
  title: string
  status: string
  updatedAt: string
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    processing: { label: "Processing", className: "bg-blue-100 text-blue-700" },
    completed: { label: "Done", className: "bg-green-100 text-green-700" },
    failed: { label: "Failed", className: "bg-red-100 text-red-700" },
    active: { label: "Ready", className: "bg-muted text-muted-foreground" },
  }
  const cfg = config[status] || { label: status, className: "bg-muted text-muted-foreground" }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium ${cfg.className}`}>
      {status === "processing" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {cfg.label}
    </span>
  )
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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/report/sessions")
      if (res.ok) {
        const data = await res.json()
        const list: ReportSession[] = data.sessions || []
        setSessions(list)

        // Auto-poll if any session is processing
        const hasProcessing = list.some((s) => s.status === "processing")
        if (hasProcessing && !intervalRef.current) {
          intervalRef.current = setInterval(fetchSessions, 3000)
        } else if (!hasProcessing && intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } catch (err) {
      console.error("Failed to load report sessions:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Fetch immediately on mount
    fetchSessions()

    // Listen for update events
    const handler = () => fetchSessions()
    window.addEventListener("report:sessions-updated", handler)

    return () => {
      window.removeEventListener("report:sessions-updated", handler)
      // Clean up polling interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchSessions])

  const handleNewAnalyze = useCallback(() => {
    startNewReportAnalyze()
    if (pathname !== "/report") {
      router.push("/report")
    }
  }, [pathname, router])

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
        onClick={handleNewAnalyze}
        className={cn(
          "mb-3 flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm transition-colors",
          pathname === "/report"
            ? "border-primary/50 bg-accent text-accent-foreground"
            : "text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
        )}
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
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{formatDate(session.updatedAt)}</span>
                        <StatusBadge status={session.status} />
                      </div>
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
