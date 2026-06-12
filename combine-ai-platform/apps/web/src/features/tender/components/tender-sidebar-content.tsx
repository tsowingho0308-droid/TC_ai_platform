"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Plus, Trash2, FileText } from "lucide-react"

interface TenderSession {
  id: string
  title: string
  templateId: string | null
  tenderType: string | null
  status: string
  updatedAt: string
}

interface TenderTemplate {
  id: string
  locale: string
  title: string
  scenario: string | null
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
    <span className={`rounded-full px-1.5 py-0 text-[10px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

export function TenderSidebarContent() {
  const pathname = usePathname()
  const router = useRouter()
  const [sessions, setSessions] = useState<TenderSession[]>([])
  const [templates, setTemplates] = useState<TenderTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const activeSessionId = pathname.startsWith("/tender/")
    ? decodeURIComponent(pathname.split("/").pop() || "")
    : null

  const fetchData = useCallback(async () => {
    try {
      const [sessionsRes, templatesRes] = await Promise.all([
        fetch("/api/tender/sessions"),
        fetch("/api/tender/templates"),
      ])
      if (sessionsRes.ok) {
        const data = await sessionsRes.json()
        setSessions(data.sessions || [])
      }
      if (templatesRes.ok) {
        const data = await templatesRes.json()
        setTemplates(data.templates || [])
      }
    } catch (err) {
      console.error("Failed to load tender data:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const handler = () => fetchData()
    window.addEventListener("tender:sessions-updated", handler)
    return () => window.removeEventListener("tender:sessions-updated", handler)
  }, [fetchData])

  const handleCreateSession = useCallback(async () => {
    const id = `tender-${Date.now()}`
    const res = await fetch("/api/tender/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: `Tender Analysis ${new Date().toLocaleDateString()}` }),
    })
    if (res.ok) {
      const data = await res.json()
      setSessions(data.sessions || [])
      router.push(`/tender/${id}`)
    }
  }, [router])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    if (pendingDelete === sessionId) {
      const res = await fetch(`/api/tender/sessions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
      })
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
        if (activeSessionId === sessionId) {
          const next = data.sessions?.[0]
          router.push(next ? `/tender/${next.id}` : "/tender")
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

  const getTenderTypeLabel = (type: string | null) => {
    switch (type) {
      case "client_tender": return "Client Tender"
      case "company_bid": return "Company Bid"
      case "comparison": return "Comparison"
      default: return null
    }
  }

  return (
    <div className="px-2">
      {/* New Session */}
      <button
        onClick={handleCreateSession}
        className="mb-3 flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="h-4 w-4" />
        New Tender Analysis
      </button>

      {/* Templates Quick Select */}
      {templates.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Templates
          </h3>
          <nav className="space-y-0.5">
            {templates.slice(0, 4).map((template) => (
              <Link
                key={template.id}
                href={`/tender/new?templateId=${template.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{template.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">{template.locale.replace("_", "-")}</p>
                </div>
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* Session List */}
      <div>
        <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Tender Sessions
        </h3>

        {loading ? (
          <div className="space-y-2 px-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            <FileText className="mx-auto mb-1 h-6 w-6 opacity-30" />
            No tender analyses yet.<br />Upload a tender document to start.
          </div>
        ) : (
          <nav className="space-y-0.5">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId
              const typeLabel = getTenderTypeLabel(session.tenderType)
              return (
                <div key={session.id} className="group relative">
                  <Link
                    href={`/tender/${session.id}`}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{session.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(session.updatedAt)}</span>
                        {typeLabel && <span>· {typeLabel}</span>}
                        <span>·</span>
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

    </div>
  )
}
