"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GitBranch, UserPlus, ClipboardList, ArrowRight, CheckCircle, Clock, AlertTriangle } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface WorkflowRunSummary {
  id: string
  title: string
  category: string
  status: string
  completedSteps: number
  totalSteps: number
  createdAt: string
}

interface DashboardStats {
  activeRuns: number
  totalSteps: number
  completedSteps: number
  overdueSteps: number
}

export default function WorkflowPage() {
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/workflow/runs")
      .then((r) => r.json())
      .then((data) => setRuns(data.runs || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const activeRuns = runs.filter((r) => r.status === "active")
  const completedRuns = runs.filter((r) => r.status === "completed")

  const stats: DashboardStats = {
    activeRuns: activeRuns.length,
    totalSteps: activeRuns.reduce((sum, r) => sum + r.totalSteps, 0),
    completedSteps: activeRuns.reduce((sum, r) => sum + r.completedSteps, 0),
    overdueSteps: 0, // Would need SLA tracking logic
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Workflow Agent</h1>
          <p className="text-xs text-muted-foreground">Cross-department workflow automation & onboarding management</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/workflow/templates"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <ClipboardList className="h-4 w-4" />
            Templates
          </Link>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 p-6 pb-0">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-500" />
            <span className="text-sm font-medium">Active Runs</span>
          </div>
          <p className="mt-2 text-2xl font-bold">{stats.activeRuns}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            <span className="text-sm font-medium">Pending Steps</span>
          </div>
          <p className="mt-2 text-2xl font-bold">{stats.totalSteps - stats.completedSteps}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <span className="text-sm font-medium">Completed</span>
          </div>
          <p className="mt-2 text-2xl font-bold">{stats.completedSteps}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <span className="text-sm font-medium">Overdue</span>
          </div>
          <p className="mt-2 text-2xl font-bold">{stats.overdueSteps}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <GitBranch className="h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">No Workflow Runs Yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Workflow Agent automates cross-department processes like employee onboarding, offboarding, and approvals. Each run tracks tasks across Admin, IT, HR, and Management.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active Runs */}
            {activeRuns.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold">Active Workflows</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {activeRuns.map((run) => {
                    const progress = run.totalSteps > 0
                      ? Math.round((run.completedSteps / run.totalSteps) * 100)
                      : 0
                    return (
                      <Link
                        key={run.id}
                        href={`/workflow/runs/${run.id}`}
                        className="group rounded-xl border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-md"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                            <UserPlus className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold group-hover:text-primary">{run.title}</h3>
                            <p className="text-xs text-muted-foreground">{run.category}</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Progress</span>
                            <span className="font-medium">{progress}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {run.completedSteps} of {run.totalSteps} steps completed
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Completed Runs */}
            {completedRuns.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold">Recently Completed</h2>
                <div className="space-y-2">
                  {completedRuns.slice(0, 5).map((run) => (
                    <Link
                      key={run.id}
                      href={`/workflow/runs/${run.id}`}
                      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                    >
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{run.title}</p>
                        <p className="text-xs text-muted-foreground">{run.category}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
