"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { Plus, Trash2, GitBranch, UserPlus, ClipboardList } from "lucide-react"

interface WorkflowRunSummary {
  id: string
  title: string
  category: string
  status: string
  completedSteps: number
  totalSteps: number
  createdAt: string
}

interface WorkflowTemplateSummary {
  id: string
  name: string
  category: string
  stepCount: number
}

export function WorkflowSidebarContent() {
  const pathname = usePathname()
  const router = useRouter()
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)

  const activeRunId = pathname.startsWith("/workflow/runs/")
    ? decodeURIComponent(pathname.split("/").pop() || "")
    : null

  const fetchData = useCallback(async () => {
    try {
      const [runsRes, tmplRes] = await Promise.all([
        fetch("/api/workflow/runs"),
        fetch("/api/workflow/templates"),
      ])
      if (runsRes.ok) {
        const data = await runsRes.json()
        setRuns(data.runs || [])
      }
      if (tmplRes.ok) {
        const data = await tmplRes.json()
        setTemplates(data.templates || [])
      }
    } catch (err) {
      console.error("Failed to load workflow data:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const handler = () => fetchData()
    window.addEventListener("workflow:data-updated", handler)
    return () => window.removeEventListener("workflow:data-updated", handler)
  }, [fetchData])

  const handleCreateRun = useCallback(async (category: string, templateId?: string) => {
    const res = await fetch("/api/workflow/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `New ${category.charAt(0) + category.slice(1).toLowerCase()} Run`, category, templateId }),
    })
    if (res.ok) {
      const data = await res.json()
      setRuns((prev) => [data.run, ...prev])
      router.push(`/workflow/runs/${data.run.id}`)
    }
  }, [router])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString("en-HK", { month: "short", day: "numeric" })
  }

  const activeRuns = runs.filter(r => r.status === "active")
  const completedRuns = runs.filter(r => r.status === "completed")
  const onboardingTemplate = templates.find(t => t.category === "ONBOARDING" && t.id.includes("default"))

  return (
    <div className="px-2">
      {/* Quick Create */}
      <div className="mb-3 space-y-1">
        <button
          onClick={() => handleCreateRun("ONBOARDING", onboardingTemplate?.id)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-accent-foreground"
        >
          <UserPlus className="h-4 w-4" />
          New Onboarding
        </button>
      </div>

      {/* Active Runs */}
      {activeRuns.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Active ({activeRuns.length})
          </h3>
          <nav className="space-y-0.5">
            {activeRuns.map((run) => {
              const isActive = run.id === activeRunId
              const progress = run.totalSteps > 0 ? Math.round((run.completedSteps / run.totalSteps) * 100) : 0
              return (
                <Link
                  key={run.id}
                  href={`/workflow/runs/${run.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <UserPlus className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{run.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="h-1.5 flex-1 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span>{run.completedSteps}/{run.totalSteps}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </nav>
        </div>
      )}

      {/* Completed Runs */}
      {completedRuns.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Completed ({completedRuns.length})
          </h3>
          <nav className="space-y-0.5">
            {completedRuns.slice(0, 5).map((run) => {
              const isActive = run.id === activeRunId
              return (
                <Link
                  key={run.id}
                  href={`/workflow/runs/${run.id}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <UserPlus className="h-4 w-4 shrink-0 text-green-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{run.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(run.createdAt)}</p>
                  </div>
                </Link>
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

      {!loading && runs.length === 0 && (
        <div className="px-2 py-4 text-center text-xs text-muted-foreground">
          <GitBranch className="mx-auto mb-1 h-6 w-6 opacity-30" />
          No workflow runs yet.
        </div>
      )}

      {/* Navigation */}
      <div className="mt-4 border-t pt-3 space-y-0.5">
        <Link
          href="/workflow"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          <GitBranch className="h-4 w-4" />
          Workflow Dashboard
        </Link>
        <Link
          href="/workflow/templates"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          <ClipboardList className="h-4 w-4" />
          Manage Templates
        </Link>
      </div>
    </div>
  )
}
