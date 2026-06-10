"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, ClipboardList, Plus, GitBranch, UserPlus,
  UserMinus, ShoppingCart, FileCheck, Wrench, Trash2
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { toast } from "sonner"

interface WorkflowTemplate {
  id: string
  name: string
  description: string | null
  category: string
  stepCount: number
  isDefault: boolean
  createdAt: string
}

interface TemplateStep {
  stepIndex: number
  title: string
  department: string
  description: string
  slaHours: number
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  ONBOARDING: <UserPlus className="h-5 w-5" />,
  OFFBOARDING: <UserMinus className="h-5 w-5" />,
  PROCUREMENT: <ShoppingCart className="h-5 w-5" />,
  LEAVE_APPROVAL: <FileCheck className="h-5 w-5" />,
  CUSTOM: <Wrench className="h-5 w-5" />,
}

const CATEGORY_LABELS: Record<string, string> = {
  ONBOARDING: "Onboarding",
  OFFBOARDING: "Offboarding",
  PROCUREMENT: "Procurement",
  LEAVE_APPROVAL: "Leave Approval",
  CUSTOM: "Custom",
}

const CATEGORY_OPTIONS = [
  { value: "ONBOARDING", label: "Onboarding" },
  { value: "OFFBOARDING", label: "Offboarding" },
  { value: "PROCUREMENT", label: "Procurement" },
  { value: "LEAVE_APPROVAL", label: "Leave Approval" },
  { value: "CUSTOM", label: "Custom" },
]

const DEPARTMENTS = ["ADMIN", "IT", "HR", "FINANCE", "MANAGER"]

export default function TemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "ONBOARDING",
  })
  const [steps, setSteps] = useState<TemplateStep[]>([])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/workflow/templates")
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || [])
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        stepIndex: prev.length + 1,
        title: "",
        department: "IT",
        description: "",
        slaHours: 24,
      },
    ])
  }

  const updateStep = (index: number, field: string, value: string | number) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    )
  }

  const removeStep = (index: number) => {
    setSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepIndex: i + 1 }))
    )
  }

  const handleCreate = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error("Template name is required")
      return
    }

    try {
      const res = await fetch("/api/workflow/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          category: form.category,
          steps: steps.filter((s) => s.title.trim()),
        }),
      })

      if (res.ok) {
        toast.success("Template created")
        setShowForm(false)
        setForm({ name: "", description: "", category: "ONBOARDING" })
        setSteps([])
        fetchTemplates()
      } else {
        toast.error("Failed to create template")
      }
    } catch {
      toast.error("Network error")
    }
  }, [form, steps, fetchTemplates])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/workflow/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id))
        toast.success("Template deleted")
      }
    } catch {
      toast.error("Failed to delete template")
    }
  }, [])

  const handleStartRun = useCallback(async (templateId: string, templateName: string) => {
    try {
      const res = await fetch("/api/workflow/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${templateName} - ${new Date().toLocaleDateString()}`,
          templateId,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success("Workflow started")
        window.dispatchEvent(new Event("workflow:data-updated"))
        router.push(`/workflow/runs/${data.run.id}`)
      }
    } catch {
      toast.error("Failed to start workflow")
    }
  }, [router])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/workflow")} className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Workflow Templates</h1>
            <p className="text-xs text-muted-foreground">Manage reusable workflow templates for cross-department processes</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {showForm && (
          <div className="mb-6 rounded-lg border bg-card p-6">
            <h2 className="text-sm font-semibold mb-4">Create Template</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Template Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Standard Employee Onboarding"
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this workflow"
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Steps Editor */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Steps ({steps.length})</h3>
                <button
                  onClick={addStep}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                  Add Step
                </button>
              </div>
              {steps.length > 0 ? (
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border p-3">
                      <span className="text-xs font-mono text-muted-foreground w-6">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => updateStep(i, "title", e.target.value)}
                        placeholder="Step title"
                        className="flex-1 rounded border px-2 py-1 text-xs"
                      />
                      <select
                        value={step.department}
                        onChange={(e) => updateStep(i, "department", e.target.value)}
                        className="w-24 rounded border px-2 py-1 text-xs"
                      >
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={step.description}
                        onChange={(e) => updateStep(i, "description", e.target.value)}
                        placeholder="Description"
                        className="w-40 rounded border px-2 py-1 text-xs"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={step.slaHours}
                          onChange={(e) => updateStep(i, "slaHours", parseInt(e.target.value) || 0)}
                          className="w-16 rounded border px-2 py-1 text-xs"
                          min={0}
                        />
                        <span className="text-xs text-muted-foreground">h SLA</span>
                      </div>
                      <button
                        onClick={() => removeStep(i)}
                        className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No steps added yet. Click &quot;Add Step&quot; to define the workflow stages.
                </p>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleCreate}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
              >
                Create Template
              </button>
              <button
                onClick={() => { setShowForm(false); setSteps([]) }}
                className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ClipboardList className="h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">No Templates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create workflow templates to standardize cross-department processes like onboarding, offboarding, and approvals.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="group rounded-xl border bg-card p-5 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    {CATEGORY_ICONS[template.category] || <Wrench className="h-5 w-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{template.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[template.category]} · {template.stepCount} steps
                    </p>
                  </div>
                  {template.isDefault && (
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">
                      Default
                    </span>
                  )}
                </div>
                {template.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
                    {template.description}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleStartRun(template.id, template.name)}
                    className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <GitBranch className="inline h-3 w-3 mr-1" />
                    Start Run
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="rounded-md border border-destructive/20 p-1.5 text-destructive/60 hover:bg-destructive/10 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
