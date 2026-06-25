"use client"

import type { ChangeEvent, ReactNode, RefObject } from "react"
import { Upload } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

interface AgentUploadPanelProps {
  accept: string
  disabled?: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  hasFiles: boolean
  emptyTitle?: string
  emptyDescription?: string
  summarySlot?: ReactNode
  children?: ReactNode
  onAddMore: () => void
  onClearAll: () => void
  className?: string
}

export function AgentUploadPanel({
  accept,
  disabled = false,
  fileInputRef,
  onFileChange,
  hasFiles,
  emptyTitle = "Upload document(s)",
  emptyDescription,
  summarySlot,
  children,
  onAddMore,
  onClearAll,
  className,
}: AgentUploadPanelProps) {
  return (
    <div className={cn(disabled && "pointer-events-none opacity-50", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        onChange={onFileChange}
        className="hidden"
      />
      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          "hover:border-primary/50 hover:bg-accent/50",
          hasFiles && "border-solid"
        )}
      >
        {hasFiles ? (
          <div className="space-y-4">
            {summarySlot}
            {children}
            <button
              type="button"
              onClick={onAddMore}
              className="text-sm text-primary hover:underline"
            >
              Add more files
            </button>
            <button
              type="button"
              onClick={onClearAll}
              className="block w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer space-y-3"
          >
            <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">{emptyTitle}</p>
            {emptyDescription ? (
              <p className="text-xs text-muted-foreground">{emptyDescription}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
