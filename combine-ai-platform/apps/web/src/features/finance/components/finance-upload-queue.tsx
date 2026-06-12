"use client"

import { Loader2, Paperclip, Upload } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

export interface PendingFinanceUpload {
  id: string
  file: File
}

interface FinanceUploadQueueProps {
  pendingFiles: PendingFinanceUpload[]
  selectedFileIds: Set<string>
  analyzing: boolean
  onToggleFile: (fileId: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onRemoveSelected: () => void
  onRemoveFile: (fileId: string) => void
  onPreviewFile?: (fileId: string) => void
  onAnalyzeSelected: () => void
  onAnalyzeSingle?: () => void
  className?: string
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FinanceUploadQueue({
  pendingFiles,
  selectedFileIds,
  analyzing,
  onToggleFile,
  onSelectAll,
  onClearSelection,
  onRemoveSelected,
  onRemoveFile,
  onPreviewFile,
  onAnalyzeSelected,
  onAnalyzeSingle,
  className,
}: FinanceUploadQueueProps) {
  if (pendingFiles.length === 0) return null

  const singleFile = pendingFiles.length === 1 ? pendingFiles[0] : null

  return (
    <div className={cn("mt-4 space-y-3", className)}>
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            Uploaded Files ({pendingFiles.length})
          </div>
          {pendingFiles.length > 1 && (
            <div className="flex items-center gap-2 text-[10px]">
              <button type="button" onClick={onSelectAll} className="text-primary hover:underline">
                All
              </button>
              <button type="button" onClick={onClearSelection} className="text-muted-foreground hover:underline">
                Clear
              </button>
              <button
                type="button"
                onClick={onRemoveSelected}
                disabled={selectedFileIds.size === 0}
                className="text-muted-foreground hover:underline disabled:opacity-50"
              >
                Remove selected
              </button>
            </div>
          )}
        </div>

        <div className="max-h-48 space-y-2 overflow-auto pr-1">
          {pendingFiles.map((entry) => {
            const selected = selectedFileIds.has(entry.id)
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2 hover:bg-accent/40",
                  pendingFiles.length > 1 && selected && "border-primary bg-primary/5"
                )}
              >
                {pendingFiles.length > 1 && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleFile(entry.id)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                    aria-label={`Select ${entry.file.name}`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onPreviewFile?.(entry.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-medium">{entry.file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{formatFileSize(entry.file.size)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveFile(entry.id)}
                  className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>

        {pendingFiles.length > 1 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {selectedFileIds.size} selected for analysis
          </p>
        )}
      </div>

      {singleFile && onAnalyzeSingle ? (
        <button
          type="button"
          onClick={onAnalyzeSingle}
          disabled={analyzing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {analyzing ? "Analyzing..." : "Analyze File"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onAnalyzeSelected}
          disabled={analyzing || selectedFileIds.size === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {analyzing
            ? "Analyzing..."
            : selectedFileIds.size > 1
              ? `Analyze Selected (${selectedFileIds.size})`
              : "Analyze Selected"}
        </button>
      )}
    </div>
  )
}

export function buildFinanceUploadId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export { fileToDataUrl }
