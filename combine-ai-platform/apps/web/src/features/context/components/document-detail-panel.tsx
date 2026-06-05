"use client"

import { useState } from "react"
import { X, Trash2, FileText, RefreshCw, Tag } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import { reprocessDocument } from "../api/context-client"
import type { ContextDocument } from "../api/context-client"
import { toast } from "sonner"

interface DocumentDetailPanelProps {
  document: ContextDocument
  onClose: () => void
  onDelete: () => void
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-HK", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function DocumentDetailPanel({
  document,
  onClose,
  onDelete,
}: DocumentDetailPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)

  const handleReprocess = async () => {
    setReprocessing(true)
    try {
      const result = await reprocessDocument(document.id)
      toast.success(`Reprocessed ${result.chunksReprocessed} chunks`)
      window.dispatchEvent(new Event("context:data-updated"))
    } catch (err) {
      toast.error(
        `Reprocess failed: ${err instanceof Error ? err.message : "Unknown error"}`
      )
    } finally {
      setReprocessing(false)
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg border-l bg-background shadow-xl overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="text-lg font-semibold">Document Details</h2>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-6 py-4 space-y-6">
        {/* Title */}
        <div>
          <h3 className="text-xl font-bold">{document.title}</h3>
          {document.sourceDocName && (
            <p className="mt-1 text-sm text-muted-foreground">
              Source: {document.sourceDocName}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Knowledge Base
            </label>
            <p className="mt-1 text-sm">{document.knowledgeBase.name}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Department
            </label>
            <p className="mt-1 text-sm">{document.knowledgeBase.department}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Language
            </label>
            <p className="mt-1 text-sm">{document.language}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Chunks
            </label>
            <p className="mt-1 text-sm">{document.chunkCount}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Created
            </label>
            <p className="mt-1 text-sm">{formatDate(document.createdAt)}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Updated
            </label>
            <p className="mt-1 text-sm">{formatDate(document.updatedAt)}</p>
          </div>
        </div>

        {/* Tags */}
        {document.tags.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1">
              <Tag className="h-3 w-3" /> Tags
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {document.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Document Type */}
        {document.documentType && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Document Type
            </label>
            <p className="mt-1">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {document.documentType.replace(/_/g, " ")}
              </span>
            </p>
          </div>
        )}

        {/* Target Audience */}
        {document.targetAudience && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Target Audience
            </label>
            <p className="mt-1 text-sm capitalize">
              {document.targetAudience.replace(/_/g, " ").toLowerCase()}
            </p>
          </div>
        )}

        {/* Business Processes */}
        {document.businessProcesses && document.businessProcesses.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Business Processes
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {document.businessProcesses.map((bp) => (
                <span
                  key={bp}
                  className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium"
                >
                  {bp}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Linked Articles */}
        {document.linkedArticleIds && document.linkedArticleIds.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase">
              Linked Articles
            </label>
            <p className="mt-1 text-sm text-muted-foreground">
              {document.linkedArticleIds.length} referenced document{document.linkedArticleIds.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}

        {/* Content Preview */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1">
            <FileText className="h-3 w-3" /> Content Preview
          </label>
          <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-3">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {document.content.slice(0, 2000)}
              {document.content.length > 2000 && (
                <span className="mt-2 block text-xs italic">
                  ... {document.content.length - 2000} more characters
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t pt-4 space-y-2">
          <button
            onClick={handleReprocess}
            disabled={reprocessing}
            className="flex w-full items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-4 w-4", reprocessing && "animate-spin")}
            />
            {reprocessing ? "Reprocessing..." : "Reprocess Embeddings"}
          </button>

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center gap-2 rounded-md border border-destructive/30 px-4 py-2 text-sm text-destructive hover:bg-destructive/5"
            >
              <Trash2 className="h-4 w-4" />
              Delete Document
            </button>
          ) : (
            <div className="rounded-md border border-destructive bg-destructive/5 p-3">
              <p className="mb-2 text-sm font-medium text-destructive">
                Are you sure? This will delete all chunks and embeddings.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={onDelete}
                  className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
