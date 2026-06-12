"use client"

import { useEffect, useState } from "react"
import { BookOpen, Loader2, X } from "lucide-react"
import {
  ingestText,
  listKnowledgeBases,
  type KnowledgeBase,
} from "@/features/context/api/context-client"

interface TenderKbImportDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
  defaultTitle: string
  text: string
}

export function TenderKbImportDialog({
  open,
  onClose,
  onSuccess,
  onError,
  defaultTitle,
  text,
}: TenderKbImportDialogProps) {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [loadingKbs, setLoadingKbs] = useState(false)
  const [selectedKb, setSelectedKb] = useState("")
  const [title, setTitle] = useState(defaultTitle)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(defaultTitle)
    setLocalError(null)
    setLoadingKbs(true)
    listKnowledgeBases()
      .then((data) => {
        setKnowledgeBases(data.knowledgeBases)
        if (data.knowledgeBases.length > 0) {
          setSelectedKb(data.knowledgeBases[0].id)
        }
      })
      .catch((err) => {
        setLocalError(err instanceof Error ? err.message : "Failed to load knowledge bases")
      })
      .finally(() => setLoadingKbs(false))
  }, [open, defaultTitle])

  if (!open) return null

  async function handleConfirm() {
    if (!selectedKb) {
      setLocalError("Please select a knowledge base")
      return
    }
    if (!text.trim()) {
      setLocalError("No comparison content to save")
      return
    }

    setSaving(true)
    setLocalError(null)
    try {
      const result = await ingestText({
        text,
        title: title.trim() || defaultTitle,
        knowledgeBaseId: selectedKb,
        tags: ["tender", "comparison"],
        language: "zh-HK",
      })
      onSuccess(
        `Saved to knowledge base (${result.chunksCreated} chunks indexed)`
      )
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save to knowledge base"
      setLocalError(message)
      onError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl border bg-background p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-import-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 id="kb-import-title" className="text-lg font-semibold">
              Save to Knowledge Base
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          Import the comparison table and AI summary as a searchable knowledge article.
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Knowledge Base
            </label>
            {loadingKbs ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading knowledge bases...
              </div>
            ) : knowledgeBases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No knowledge bases found. Create one in Context Management first.
              </p>
            ) : (
              <select
                value={selectedKb}
                onChange={(e) => setSelectedKb(e.target.value)}
                disabled={saving}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              >
                {knowledgeBases.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name} ({kb.department})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {localError && (
          <p className="mt-3 text-sm text-destructive">{localError}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || loadingKbs || knowledgeBases.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
