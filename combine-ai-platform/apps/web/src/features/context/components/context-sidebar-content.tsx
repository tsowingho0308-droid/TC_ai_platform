"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@combine-ai/shared-ui"
import { FileText, FolderOpen, Database } from "lucide-react"

interface KnowledgeBase {
  id: string
  name: string
  slug: string
  department: string
  articleCount: number
}

const DEPARTMENT_ICONS: Record<string, string> = {
  HR: "👥",
  IT: "💻",
  ADMIN: "🏢",
  FINANCE: "💰",
  GENERAL: "📋",
}

export function ContextSidebarContent() {
  const searchParams = useSearchParams()
  const activeDepartment = searchParams.get("department") || ""

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch("/api/context/knowledge-bases")
      if (res.ok) {
        const data = await res.json()
        setKnowledgeBases(data.knowledgeBases || [])
      } else {
        setError("Failed to load")
      }
    } catch (err) {
      console.error("Failed to load knowledge bases:", err)
      setError("Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const handler = () => fetchData()
    window.addEventListener("context:data-updated", handler)
    return () => window.removeEventListener("context:data-updated", handler)
  }, [fetchData])

  return (
    <div className="px-2">
      {/* Knowledge Bases */}
      <div className="mb-3">
        <h3 className="mb-1 px-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Knowledge Bases
        </h3>

        {/* All Documents */}
        <Link
          href="/context"
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            activeDepartment === ""
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          )}
        >
          <FileText className="h-4 w-4" />
          <span className="truncate">All Documents</span>
        </Link>

        {loading ? (
          <div className="space-y-2 px-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">
            <Database className="mx-auto mb-1 h-5 w-5 opacity-30" />
            {error}
            <button
              onClick={fetchData}
              className="mt-1 block text-xs text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : knowledgeBases.length === 0 ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">
            <FolderOpen className="mx-auto mb-1 h-5 w-5 opacity-30" />
            No knowledge bases yet.
          </div>
        ) : (
          <nav className="space-y-0.5 mt-1">
            {knowledgeBases.map((kb) => {
              const isActive = activeDepartment === kb.department
              return (
                <Link
                  key={kb.id}
                  href={`/context?department=${kb.department}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <span className="text-xs">{DEPARTMENT_ICONS[kb.department] || "📋"}</span>
                  <span className="truncate">{kb.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {kb.articleCount}
                  </span>
                </Link>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}
