"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Clock, CheckCircle, AlertTriangle, Loader2,
  User, Calendar, GitBranch, PauseCircle
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { toast } from "sonner"

interface StepRun {
  id: string
  stepIndex: number
  title: string
  department: string
  status: string
  notes: string | null
  slaHours: number | null
  completedAt: string | null
  assignedToName?: string | null
  createdAt: string
}

interface WorkflowRunDetail {
  id: string
  title: string
  category: string
  status: string
  targetPerson: Record<string, string> | null
  steps: StepRun[]
  templateName: string | null
  completedSteps: number
  totalSteps: number
  createdAt: string
  updatedAt: string
}

const STEP_STATUS_ICONS: Record<string, React.ReactNode> = {
  PENDING: <Clock className="h-4 w-4 text-muted-foreground" />,
  IN_PROGRESS: <Loader2 className="h-4 w-4 text-blue-500" />,
  COMPLETED: <CheckCircle className="h-4 w-4 text-green-500" />,
  BLOCKED: <AlertTriangle className="h-4 w-4 text-red-500" />,
  SKIPPED: <PauseCircle className="h-4 w-4 text-gray-400" />,
}

const STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
  SKIPPED: "Skipped",
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getSlaStatus(step: StepRun): "ok" | "warning" | "overdue" {
  if (step.status === "COMPLETED" || step.status === "SKIPPED" || !step.slaHours) return "ok"
  const elapsed = Date.now() - new Date(step.createdAt).getTime()
  const slaMs = step.slaHours * 60 * 60 * 1000
  if (elapsed > slaMs) return "overdue"
  if (elapsed > slaMs * 0.7) return "warning"
  return "ok"
}

export default function WorkflowRunDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [run, setRun] = useState<WorkflowRunDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflow/runs?id=${id}`)
      if (!res.ok) throw new Error("Run not found")
      const data = await res.json()
      setRun(data.run)
    } catch {
      toast.error("Failed to load workflow run")
      router.push("/workflow")
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => { fetchRun() }, [fetchRun])

  const handleStepAction = useCallback(async (stepId: string, action: string) => {
    try {
      const statusMap: Record<string, string> = {
        start: "IN_PROGRESS",
        complete: "COMPLETED",
        block: "BLOCKED",
        skip: "SKIPPED",
      }
      const res = await fetch("/api/workflow/steps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: stepId, status: statusMap[action] }),
      })
      if (res.ok) {
        toast.success(`Step ${action}ed`)
        fetchRun()
      } else {
        toast.error("Failed to update step")
      }
    } catch {
      toast.error("Network error")
    }
  }, [fetchRun])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!run) return null

  const progress = run.totalSteps > 0 ? Math.round((run.completedSteps / run.totalSteps) * 100) : 0
  const overdueCount = run.steps.filter((s) => getSlaStatus(s) === "overdue").length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/workflow")} className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{run.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{run.category}</span>
              {run.templateName && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">Template: {run.templateName}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {overdueCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800">
            <AlertTriangle className="h-3 w-3" />
            {overdueCount} overdue
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Progress Bar */}
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Overall Progress</h2>
              <span className="text-sm font-bold">{progress}%</span>
            </div>
            <div className="h-3 rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  progress === 100 ? "bg-green-500" : "bg-primary"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>{run.completedSteps} of {run.totalSteps} steps completed</span>
              <span>
                <Clock className="inline h-3 w-3 mr-1" />
                Created {formatDate(run.createdAt)}
              </span>
            </div>
          </div>

          {/* Target Person Info */}
          {run.targetPerson && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <User className="h-4 w-4" />
                Target Person
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(run.targetPerson).map(([key, value]) => (
                  <div key={key}>
                    <span className="text-xs text-muted-foreground capitalize">{key}: </span>
                    <span className="font-medium">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Steps */}
          <div>
            <h2 className="text-sm font-semibold mb-3">Workflow Steps</h2>
            <div className="space-y-0">
              {run.steps.map((step, i) => {
                const slaStatus = getSlaStatus(step)
                return (
                  <div key={step.id} className="relative flex gap-4">
                    {/* Connector Line */}
                    {i < run.steps.length - 1 && (
                      <div
                        className={cn(
                          "absolute left-[19px] top-10 w-0.5 h-[calc(100%-4px)]",
                          step.status === "COMPLETED" ? "bg-green-300" : "bg-muted-foreground/20"
                        )}
                      />
                    )}

                    {/* Step Circle */}
                    <div className="shrink-0 relative z-10 mt-1">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-full border-2",
                          step.status === "COMPLETED" && "border-green-500 bg-green-50",
                          step.status === "IN_PROGRESS" && "border-blue-500 bg-blue-50",
                          step.status === "BLOCKED" && "border-red-500 bg-red-50",
                          step.status === "PENDING" && "border-muted-foreground/30 bg-background",
                          step.status === "SKIPPED" && "border-gray-300 bg-gray-50"
                        )}
                      >
                        {STEP_STATUS_ICONS[step.status] || <Clock className="h-4 w-4" />}
                      </div>
                    </div>

                    {/* Step Content */}
                    <div className="flex-1 pb-6">
                      <div
                        className={cn(
                          "rounded-lg border p-4",
                          step.status === "COMPLETED" && "border-green-200 bg-green-50/50",
                          step.status === "IN_PROGRESS" && "border-blue-200 bg-blue-50/50",
                          step.status === "BLOCKED" && "border-red-200 bg-red-50/50"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-muted-foreground">
                                Step {step.stepIndex}
                              </span>
                              <h3 className="text-sm font-semibold">{step.title}</h3>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                step.department === "HR" && "bg-pink-100 text-pink-800",
                                step.department === "IT" && "bg-blue-100 text-blue-800",
                                step.department === "ADMIN" && "bg-gray-100 text-gray-800",
                                step.department === "FINANCE" && "bg-green-100 text-green-800",
                                step.department === "MANAGER" && "bg-purple-100 text-purple-800"
                              )}>
                                {step.department}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {STEP_STATUS_LABELS[step.status]}
                              </span>
                              {step.slaHours && (
                                <>
                                  <span className="text-xs text-muted-foreground">·</span>
                                  <span
                                    className={cn(
                                      "text-xs flex items-center gap-1",
                                      slaStatus === "overdue" && "text-red-600 font-semibold",
                                      slaStatus === "warning" && "text-amber-600"
                                    )}
                                  >
                                    <Calendar className="h-3 w-3" />
                                    {step.slaHours}h SLA
                                    {slaStatus === "overdue" && " — OVERDUE"}
                                    {slaStatus === "warning" && " — Due soon"}
                                  </span>
                                </>
                              )}
                              {step.assignedToName && (
                                <>
                                  <span className="text-xs text-muted-foreground">·</span>
                                  <span className="text-xs flex items-center gap-1">
                                    <User className="h-3 w-3" />
                                    {step.assignedToName}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Step Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            {step.status === "PENDING" && (
                              <button
                                onClick={() => handleStepAction(step.id, "start")}
                                className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                Start
                              </button>
                            )}
                            {step.status === "IN_PROGRESS" && (
                              <>
                                <button
                                  onClick={() => handleStepAction(step.id, "complete")}
                                  className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
                                >
                                  Complete
                                </button>
                                <button
                                  onClick={() => handleStepAction(step.id, "block")}
                                  className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                >
                                  Block
                                </button>
                              </>
                            )}
                            {step.status === "BLOCKED" && (
                              <button
                                onClick={() => handleStepAction(step.id, "start")}
                                className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                Resume
                              </button>
                            )}
                            {step.status === "COMPLETED" && step.completedAt && (
                              <span className="text-xs text-muted-foreground">
                                <CheckCircle className="inline h-3 w-3 mr-1 text-green-500" />
                                {formatDate(step.completedAt)}
                              </span>
                            )}
                          </div>
                        </div>

                        {step.notes && (
                          <p className="mt-2 text-xs text-muted-foreground border-t pt-2">
                            {step.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
