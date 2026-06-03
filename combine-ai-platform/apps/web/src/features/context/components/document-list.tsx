"use client"

import { cn } from "@combine-ai/shared-ui"
import { FileText, Trash2, MoreVertical, BadgeCheck } from "lucide-react"
import { useState } from "react"
import type { ContextDocument } from "../api/context-client"

interface DocumentListProps {
  documents: ContextDocument[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelect: (doc: ContextDocument) => void
  onDelete: (id: string) => void
  selectedId?: string
}

const DEPARTMENT_COLORS: Record<string, string> = {
  HR: "bg-pink-100 text-pink-800",
  IT: "bg-blue-100 text-blue-800",
  ADMIN: "bg-gray-100 text-gray-800",
  FINANCE: "bg-green-100 text-green-800",
  GENERAL: "bg-yellow-100 text-yellow-800",
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function DocumentList({
  documents,
  loading,
  error,
  onRetry,
  onSelect,
  onDelete,
  selectedId,
}: DocumentListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border p-4"
          >
            <div className="h-10 w-10 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-destructive/10 p-4">
          <svg className="h-8 w-8 text-destructive" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-medium">Failed to Load Documents</h3>
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        <button
          onClick={onRetry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-muted/50 p-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-lg font-medium">No Documents Yet</h3>
        <p className="text-sm text-muted-foreground">
          Upload your first document to build the knowledge base.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => {
        const [menuOpen, setMenuOpen] = useState(false)
        return (
          <div
            key={doc.id}
            className={cn(
              "flex items-center gap-4 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent/50",
              selectedId === doc.id && "border-primary bg-accent/50"
            )}
            onClick={() => onSelect(doc)}
          >
            {/* Icon */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h4 className="truncate text-sm font-medium">{doc.title}</h4>
                {doc.chunkCount > 0 && (
                  <BadgeCheck className="h-3.5 w-3.5 text-green-500" aria-label="Vector search enabled" />
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", DEPARTMENT_COLORS[doc.knowledgeBase.department] || DEPARTMENT_COLORS.GENERAL)}>
                  {doc.knowledgeBase.department}
                </span>
                <span>{doc.knowledgeBase.name}</span>
                <span>·</span>
                <span>{doc.chunkCount} chunks</span>
                <span>·</span>
                <span>{doc.language}</span>
                <span>·</span>
                <span>{formatDate(doc.updatedAt)}</span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {doc.content.slice(0, 150)}
              </p>
            </div>

            {/* Actions */}
            <div className="relative shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(!menuOpen)
                }}
                className="rounded-md p-1 hover:bg-muted"
              >
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-md border bg-popover shadow-md">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(doc.id)
                      setMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
