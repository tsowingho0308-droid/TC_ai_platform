"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { Download, FileText, Loader2 } from "lucide-react"
import { cn } from "@combine-ai/shared-ui"
import type { PreviewDocument } from "@/features/report/components/pdf-highlight-viewer"
import type { ReportPreviewKind } from "@/features/report/lib/report-preview-kind"

const PdfHighlightViewer = dynamic(
  () => import("@/features/report/components/pdf-highlight-viewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center min-h-[300px] bg-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
      </div>
    ),
  }
)

export interface ReportDocumentPreviewProps {
  previewKind: ReportPreviewKind | null
  fileName: string
  fileUrl?: string | null
  mimeType?: string | null
  localFile?: File | null
  sessionId?: string | null
  htmlContent?: string | null
  textContent?: string | null
  documents?: PreviewDocument[]
  activeDocumentId?: string
  onDocumentChange?: (id: string) => void
  focusTarget?: { page?: number; field: string; value: string } | null
  highlightEnabled?: boolean
  onHighlightEnabledChange?: (enabled: boolean) => void
  kbHighlightPhrases?: string[]
  className?: string
}

export function ReportDocumentPreview({
  previewKind,
  fileName,
  fileUrl,
  mimeType,
  localFile,
  sessionId,
  htmlContent: htmlContentProp,
  textContent: textContentProp,
  documents = [],
  activeDocumentId,
  onDocumentChange,
  focusTarget,
  highlightEnabled,
  onHighlightEnabledChange,
  kbHighlightPhrases,
  className,
}: ReportDocumentPreviewProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(htmlContentProp ?? null)
  const [textContent, setTextContent] = useState<string | null>(textContentProp ?? null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    setHtmlContent(htmlContentProp ?? null)
  }, [htmlContentProp])

  useEffect(() => {
    setTextContent(textContentProp ?? null)
  }, [textContentProp])

  useEffect(() => {
    if (previewKind !== "word" && previewKind !== "text") return
    if (htmlContentProp || textContentProp) return

    let cancelled = false

    async function loadPreview() {
      setLoading(true)
      setFetchError(null)

      try {
        if (localFile) {
          const formData = new FormData()
          formData.append("file", localFile)
          const res = await fetch("/api/report/preview", { method: "POST", body: formData })
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(err.error || "Preview failed")
          }
          const data = (await res.json()) as { html?: string; text?: string }
          if (cancelled) return
          if (previewKind === "word") setHtmlContent(data.html ?? null)
          if (previewKind === "text") setTextContent(data.text ?? null)
          return
        }

        if (sessionId) {
          const res = await fetch(
            `/api/report/sessions/${encodeURIComponent(sessionId)}/preview`
          )
          if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(err.error || "Preview failed")
          }
          const data = (await res.json()) as { html?: string; text?: string }
          if (cancelled) return
          if (previewKind === "word") setHtmlContent(data.html ?? null)
          if (previewKind === "text") setTextContent(data.text ?? null)
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Preview failed")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [previewKind, localFile, sessionId, htmlContentProp, textContentProp])

  if (!previewKind || previewKind === "other") {
    if (!fileUrl) {
      return (
        <div className={cn("flex h-full flex-col items-center justify-center gap-4 bg-muted/20 text-center", className)}>
          <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-10">
            <FileText className="mx-auto h-14 w-14 text-muted-foreground/30" />
            <p className="mt-4 text-sm font-medium text-muted-foreground">Document Preview</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Upload a document on the left to preview it here.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-4 bg-muted/20 text-center", className)}>
        <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-10">
          <FileText className="mx-auto h-14 w-14 text-muted-foreground/30" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">Preview not available</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            {fileName || "Document"} cannot be previewed in the browser.
          </p>
          <a
            href={fileUrl}
            download={fileName || "document"}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </div>
      </div>
    )
  }

  if (previewKind === "pdf" && fileUrl) {
    return (
      <PdfHighlightViewer
        fileUrl={fileUrl}
        fileName={fileName}
        documents={documents}
        activeDocumentId={activeDocumentId}
        onDocumentChange={onDocumentChange}
        highlights={[]}
        highlightEnabled={highlightEnabled}
        onHighlightEnabledChange={onHighlightEnabledChange}
        focusTarget={focusTarget}
        kbHighlightPhrases={kbHighlightPhrases}
        className={className}
      />
    )
  }

  if (previewKind === "image" && fileUrl) {
    return (
      <div className={cn("flex h-full flex-col overflow-hidden bg-muted/10", className)}>
        <div className="border-b bg-background px-4 py-2">
          <p className="truncate text-sm font-medium">{fileName}</p>
          {mimeType && <p className="text-xs text-muted-foreground">{mimeType}</p>}
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={fileUrl}
            alt={fileName}
            className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
          />
        </div>
      </div>
    )
  }

  if (previewKind === "word") {
    return (
      <div className={cn("flex h-full flex-col overflow-hidden bg-background", className)}>
        <div className="border-b px-4 py-2">
          <p className="truncate text-sm font-medium">{fileName}</p>
          <p className="text-xs text-muted-foreground">Word document preview</p>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
            </div>
          ) : fetchError ? (
            <p className="text-sm text-destructive">{fetchError}</p>
          ) : (
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: htmlContent || "<p>(Empty document)</p>" }}
            />
          )}
        </div>
      </div>
    )
  }

  if (previewKind === "text") {
    return (
      <div className={cn("flex h-full flex-col overflow-hidden bg-background", className)}>
        <div className="border-b px-4 py-2">
          <p className="truncate text-sm font-medium">{fileName}</p>
          <p className="text-xs text-muted-foreground">Plain text</p>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
            </div>
          ) : fetchError ? (
            <p className="text-sm text-destructive">{fetchError}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
              {textContent ?? ""}
            </pre>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex h-full flex-col items-center justify-center gap-4 bg-muted/20 text-center", className)}>
      <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-10">
        <FileText className="mx-auto h-14 w-14 text-muted-foreground/30" />
        <p className="mt-4 text-sm font-medium text-muted-foreground">Document Preview</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Upload a document on the left to preview it here.
        </p>
      </div>
    </div>
  )
}
