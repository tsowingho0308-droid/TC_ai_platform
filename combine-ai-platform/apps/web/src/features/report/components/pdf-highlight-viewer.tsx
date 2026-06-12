"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  AlertTriangle,
  Search,
  X,
  Palette,
  FileText,
} from "lucide-react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"
import { cn } from "@combine-ai/shared-ui"
import {
  findFieldValueMatch,
  findSearchTermMatches,
  highlightTargetsMatch,
  HIGHLIGHT_BLUE,
  SEARCH_COLORS,
  type TextLayerBox,
  type HighlightTarget,
} from "@/features/report/lib/report-text-layer-highlights"

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

export interface Highlight extends HighlightTarget {}

export interface PreviewDocument {
  id: string
  name: string
  url: string
}

interface PdfHighlightViewerProps {
  fileUrl: string
  fileName: string
  documents?: PreviewDocument[]
  activeDocumentId?: string
  onDocumentChange?: (id: string) => void
  highlights?: Highlight[]
  highlightEnabled?: boolean
  onHighlightEnabledChange?: (enabled: boolean) => void
  showAllHighlights?: boolean
  onShowAllHighlightsChange?: (show: boolean) => void
  focusTarget?: { page?: number; field: string; value: string } | null
  className?: string
}

const EMPTY_HIGHLIGHTS: Highlight[] = []

interface OverlayRect extends TextLayerBox {
  color: string
  label?: string
  flash?: boolean
}

const SHOW_ALL_CAP = 12

function shouldShowHighlightOnPage(
  hl: HighlightTarget,
  page: number,
  totalPages: number
): boolean {
  if (totalPages <= 1) return true
  if (!hl.page) return true
  return hl.page === page
}

function highlightMatchScore(hl: HighlightTarget): number {
  let score = 0
  if (hl.page && hl.page >= 1) score += 100
  score -= Math.min(hl.value.trim().length, 80)
  return score
}

export default function PdfHighlightViewer({
  fileUrl,
  fileName,
  documents = [],
  activeDocumentId,
  onDocumentChange,
  highlights = EMPTY_HIGHLIGHTS,
  highlightEnabled: highlightEnabledProp,
  onHighlightEnabledChange,
  showAllHighlights: showAllHighlightsProp,
  onShowAllHighlightsChange,
  focusTarget,
  className,
}: PdfHighlightViewerProps) {
  const [internalHighlightEnabled, setInternalHighlightEnabled] = useState(false)
  const [internalShowAll, setInternalShowAll] = useState(false)
  const highlightEnabled = highlightEnabledProp ?? internalHighlightEnabled
  const showAllHighlights = showAllHighlightsProp ?? internalShowAll

  const setHighlightEnabled = (enabled: boolean) => {
    if (onHighlightEnabledChange) onHighlightEnabledChange(enabled)
    else setInternalHighlightEnabled(enabled)
  }
  const setShowAllHighlights = (show: boolean) => {
    if (onShowAllHighlightsChange) onShowAllHighlightsChange(show)
    else setInternalShowAll(show)
  }

  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [overlayRects, setOverlayRects] = useState<OverlayRect[]>([])
  const [searchTerms, setSearchTerms] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [retryKey, setRetryKey] = useState(0)
  const [layerSize, setLayerSize] = useState<{ width: number; height: number } | null>(null)

  const pageWrapperRef = useRef<HTMLDivElement>(null)

  const activeHighlights = useMemo(() => {
    if (!highlightEnabled || showAllHighlights) return []
    if (!focusTarget) return []
    const matched = highlights.filter((h) => highlightTargetsMatch(h, focusTarget))
    if (matched.length > 0) return matched
    return [{ field: focusTarget.field, value: focusTarget.value, page: focusTarget.page }]
  }, [highlightEnabled, showAllHighlights, highlights, focusTarget])

  const isFocusedHighlight = useCallback(
    (hl: HighlightTarget) => Boolean(focusTarget && highlightTargetsMatch(hl, focusTarget)),
    [focusTarget]
  )

  const recomputeOverlays = useCallback(() => {
    const wrapper = pageWrapperRef.current
    if (!wrapper || pdfLoading) {
      setOverlayRects([])
      return
    }

    const w = wrapper.offsetWidth
    const h = wrapper.offsetHeight
    if (w > 0 && h > 0) {
      setLayerSize((prev) => (prev?.width === w && prev?.height === h ? prev : { width: w, height: h }))
    }

    const rects: OverlayRect[] = []

    if (highlightEnabled) {
      if (showAllHighlights) {
        const matched: Array<{ hl: HighlightTarget; boxes: TextLayerBox[] }> = []
        for (const hl of highlights) {
          if (!shouldShowHighlightOnPage(hl, pageNumber, numPages)) continue
          const boxes = findFieldValueMatch(wrapper, hl.field, hl.value, {
            allowAmbiguous: true,
          })
          if (boxes.length > 0) matched.push({ hl, boxes })
        }
        matched.sort((a, b) => highlightMatchScore(b.hl) - highlightMatchScore(a.hl))
        for (const { hl, boxes } of matched.slice(0, SHOW_ALL_CAP)) {
          for (const box of boxes) {
            rects.push({
              ...box,
              color: HIGHLIGHT_BLUE,
              label: hl.field,
              flash: false,
            })
          }
        }
      } else {
        for (const hl of activeHighlights) {
          if (!shouldShowHighlightOnPage(hl, pageNumber, numPages)) continue
          const focused = isFocusedHighlight(hl)
          const boxes = findFieldValueMatch(wrapper, hl.field, hl.value, {
            allowAmbiguous: focused,
          })
          for (const box of boxes) {
            rects.push({
              ...box,
              color: HIGHLIGHT_BLUE,
              label: hl.field,
              flash: focused,
            })
          }
        }
      }
    }

    searchTerms.forEach((term, i) => {
      const boxes = findSearchTermMatches(wrapper, term)
      for (const box of boxes) {
        rects.push({
          ...box,
          color: SEARCH_COLORS[i % SEARCH_COLORS.length],
          label: term,
        })
      }
    })

    setOverlayRects(rects)
  }, [
    activeHighlights,
    highlights,
    isFocusedHighlight,
    highlightEnabled,
    showAllHighlights,
    numPages,
    pageNumber,
    pdfLoading,
    searchTerms,
  ])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(recomputeOverlays)
    })
    return () => cancelAnimationFrame(id)
  }, [recomputeOverlays, scale, pageNumber, fileUrl])

  useEffect(() => {
    if (focusTarget?.page && focusTarget.page >= 1) {
      setPageNumber(focusTarget.page)
    }
  }, [focusTarget?.page, focusTarget?.value])

  useEffect(() => {
    setPdfLoading(true)
    setPdfError(null)
    setPageNumber(1)
    setScale(1.0)
    setOverlayRects([])
    setSearchTerms([])
    setSearchInput("")
    setLayerSize(null)
  }, [fileUrl])

  function handleDocumentLoadSuccess(doc: { numPages: number }) {
    setNumPages(doc.numPages)
    setPdfLoading(false)
    setPdfError(null)
  }

  function handleDocumentLoadError(error: Error) {
    setPdfLoading(false)
    setPdfError(error.message || "Failed to load PDF")
  }

  function handlePageRenderSuccess() {
    requestAnimationFrame(recomputeOverlays)
  }

  const goToPrev = useCallback(() => setPageNumber((p) => Math.max(1, p - 1)), [])
  const goToNext = useCallback(() => setPageNumber((p) => Math.min(numPages, p + 1)), [numPages])
  const zoomIn = useCallback(() => setScale((s) => Math.min(3.0, s + 0.25)), [])
  const zoomOut = useCallback(() => setScale((s) => Math.max(0.5, s - 0.25)), [])

  function addSearchTerm() {
    const term = searchInput.trim()
    if (!term || searchTerms.includes(term)) return
    setSearchTerms([...searchTerms, term])
    setSearchInput("")
  }

  function removeSearchTerm(term: string) {
    setSearchTerms(searchTerms.filter((t) => t !== term))
  }

  const showDocPicker = documents.length > 1

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex flex-col gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 min-w-0">
            {showDocPicker ? (
              <select
                value={activeDocumentId || documents[0]?.id || ""}
                onChange={(e) => onDocumentChange?.(e.target.value)}
                className="max-w-[180px] truncate rounded-md border bg-background px-2 py-1 text-xs"
                title="Select document to preview"
              >
                {documents.map((doc, i) => (
                  <option key={doc.id} value={doc.id}>
                    {i + 1}. {doc.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[160px]" title={fileName}>
                <FileText className="h-3.5 w-3.5 shrink-0" />
                {fileName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={goToPrev} disabled={pageNumber <= 1 || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums min-w-[80px] text-center">
              Page {numPages > 0 ? pageNumber : "-"} of {numPages || "-"}
            </span>
            <button type="button" onClick={goToNext} disabled={pageNumber >= numPages || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Next page">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={zoomOut} disabled={scale <= 0.5 || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums w-[40px] text-center">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={zoomIn} disabled={scale >= 3.0 || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setHighlightEnabled(false)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                !highlightEnabled ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => setHighlightEnabled(true)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                highlightEnabled ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              )}
            >
              Highlights
            </button>
          </div>
          {highlightEnabled && highlights.length > 0 && (
            <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={showAllHighlights}
                onChange={(e) => setShowAllHighlights(e.target.checked)}
                className="h-3 w-3 accent-primary"
              />
              Show all (max 12)
            </label>
          )}
          <div className="flex flex-1 items-center gap-1 rounded-md border bg-background px-2 py-1 min-w-0">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSearchTerm() }}
              placeholder="Search keywords..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 min-w-0"
            />
            {searchInput && (
              <button type="button" onClick={addSearchTerm} className="text-xs text-primary hover:underline shrink-0">
                Add
              </button>
            )}
          </div>
        </div>

        {searchTerms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <Palette className="h-3 w-3 text-muted-foreground shrink-0" />
            {searchTerms.map((term, i) => (
              <span
                key={term}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border"
                style={{
                  borderColor: SEARCH_COLORS[i % SEARCH_COLORS.length].replace(/[\d.]+\)$/, "0.8)"),
                  backgroundColor: SEARCH_COLORS[i % SEARCH_COLORS.length],
                }}
              >
                {term}
                <button type="button" onClick={() => removeSearchTerm(term)} className="ml-0.5 hover:opacity-70">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto bg-muted/10 rounded-b-lg">
        {pdfLoading && (
          <div className="flex items-center justify-center h-full min-h-[400px]">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">Loading document...</p>
            </div>
          </div>
        )}

        {pdfError && !pdfLoading && (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8 text-center">
            <AlertTriangle className="h-10 w-10 text-red-400/50" />
            <p className="mt-3 text-sm font-medium text-red-600">Failed to load PDF</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">{pdfError}</p>
            <button
              type="button"
              onClick={() => {
                setPdfLoading(true)
                setPdfError(null)
                setRetryKey((k) => k + 1)
              }}
              className="mt-4 text-xs text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!pdfError && (
          <div className={cn(pdfLoading ? "hidden" : "block")}>
            <Document
              key={`${retryKey}-${fileUrl}`}
              file={fileUrl}
              onLoadSuccess={handleDocumentLoadSuccess}
              onLoadError={handleDocumentLoadError}
              loading={null}
              className="flex flex-col items-center"
            >
              <div ref={pageWrapperRef} className="relative inline-block">
                <Page
                  pageNumber={pageNumber}
                  scale={scale}
                  onRenderSuccess={handlePageRenderSuccess}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                  className="shadow-sm"
                />
                {layerSize && overlayRects.length > 0 && (
                  <div
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ width: layerSize.width, height: layerSize.height }}
                  >
                    {overlayRects.map((rect, i) => (
                      <div
                        key={i}
                        className={cn(
                          "absolute rounded-[2px]",
                          rect.flash && "animate-pulse ring-2 ring-primary/70"
                        )}
                        style={{
                          left: rect.left,
                          top: rect.top,
                          width: Math.max(rect.width, 4),
                          height: Math.max(rect.height, 4),
                          backgroundColor: rect.color,
                        }}
                        title={rect.label}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Document>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/20 rounded-b-lg text-xs text-muted-foreground">
        <span>{numPages > 0 && `${numPages} page${numPages > 1 ? "s" : ""}`}</span>
        <span>
          {highlightEnabled
            ? `${overlayRects.filter((r) => r.color === HIGHLIGHT_BLUE).length > 0 ? "Highlighted" : "Click a field row to highlight"}`
            : searchTerms.length > 0
              ? "Search active"
              : "Highlights off"}
        </span>
      </div>
    </div>
  )
}
