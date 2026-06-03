"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Shield, Plus, Trash2, ToggleLeft, ToggleRight, ArrowLeft } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { toast } from "sonner"

interface ExpensePolicy {
  id: string
  name: string
  rule: string
  description: string | null
  threshold: number | null
  unit: string | null
  enabled: boolean
}

export default function PoliciesPage() {
  const router = useRouter()
  const [policies, setPolicies] = useState<ExpensePolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: "",
    rule: "",
    description: "",
    threshold: "",
    unit: "HKD",
    enabled: true,
  })

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/policies")
      if (res.ok) {
        const data = await res.json()
        setPolicies(data.policies || [])
      }
    } catch (err) {
      console.error("Failed to fetch policies:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

  const handleCreate = useCallback(async () => {
    if (!form.name.trim() || !form.rule.trim()) {
      toast.error("Name and rule are required")
      return
    }

    try {
      const res = await fetch("/api/finance/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          rule: form.rule,
          description: form.description || null,
          threshold: form.threshold ? parseFloat(form.threshold) : null,
          unit: form.unit || "HKD",
          enabled: form.enabled,
        }),
      })

      if (res.ok) {
        toast.success("Policy created")
        setShowForm(false)
        setForm({ name: "", rule: "", description: "", threshold: "", unit: "HKD", enabled: true })
        fetchPolicies()
      } else {
        toast.error("Failed to create policy")
      }
    } catch {
      toast.error("Network error")
    }
  }, [form, fetchPolicies])

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/finance/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: !enabled }),
      })
      setPolicies((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: !enabled } : p)))
    } catch {
      toast.error("Failed to toggle policy")
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/finance/policies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        setPolicies((prev) => prev.filter((p) => p.id !== id))
        toast.success("Policy deleted")
      }
    } catch {
      toast.error("Failed to delete policy")
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/finance")} className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">Expense Policies</h1>
            <p className="text-xs text-muted-foreground">Configure company expense compliance rules</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Policy
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {showForm && (
          <div className="mb-6 rounded-lg border bg-card p-6">
            <h2 className="text-sm font-semibold mb-4">New Policy</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium mb-1">Policy Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Meal Allowance Cap"
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Rule Key</label>
                <input
                  type="text"
                  value={form.rule}
                  onChange={(e) => setForm((f) => ({ ...f, rule: e.target.value }))}
                  placeholder="e.g., meal_max"
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this policy rule"
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Threshold</label>
                <input
                  type="number"
                  value={form.threshold}
                  onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                  placeholder="e.g., 150"
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                >
                  <option value="HKD">HKD</option>
                  <option value="HKD/km">HKD/km</option>
                  <option value="HKD/night">HKD/night</option>
                  <option value="km">km</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleCreate}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
              >
                Create Policy
              </button>
              <button
                onClick={() => setShowForm(false)}
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
        ) : policies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Shield className="h-16 w-16 text-muted-foreground/30" />
            <h2 className="mt-4 text-xl font-semibold">No Policies Configured</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add expense policies like meal caps, mileage rates, and hotel budgets for automatic compliance checking.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {policies.map((policy) => (
              <div
                key={policy.id}
                className={cn(
                  "flex items-center gap-4 rounded-lg border p-4 transition-colors",
                  !policy.enabled && "opacity-50"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{policy.name}</h3>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                      {policy.rule}
                    </code>
                  </div>
                  {policy.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{policy.description}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {policy.threshold !== null && (
                      <span>
                        Threshold: <strong>{policy.threshold} {policy.unit}</strong>
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(policy.id, policy.enabled)}
                  className="rounded p-1 hover:bg-accent"
                  title={policy.enabled ? "Disable policy" : "Enable policy"}
                >
                  {policy.enabled ? (
                    <ToggleRight className="h-6 w-6 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(policy.id)}
                  className="rounded p-1.5 hover:bg-destructive/10 hover:text-destructive"
                  title="Delete policy"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
