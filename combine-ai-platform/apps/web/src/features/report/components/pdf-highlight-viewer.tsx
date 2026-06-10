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
} from "lucide-react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"
import { cn } from "@combine-ai/shared-ui"

// ── pdfjs worker (local — avoid CDN / mixed-content failures) ──
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

// ── Types ────────────────────────────────────────────────────

export interface Highlight {
  field: string
  value: string
  page?: number
  color?: string
}

interface Rect {
  /** x position in PDF points, from left */
  left: number
  /** Bottom edge in PDF points, from bottom (larger y value) */
  pdfYBottom: number
  /** Top edge in PDF points, from bottom (smaller y value) */
  pdfYTop: number
  width: number
  height: number
  field: string
  value: string
  color: string
  source: "ai" | "search" | "kb"
}

interface PdfHighlightViewerProps {
  fileUrl: string
  fileName: string
  highlights?: Highlight[]
  kbPhrases?: string[]
  className?: string
}

// ── Color palette ────────────────────────────────────────────

const SEARCH_COLORS = [
  "rgba(255, 80, 80, 0.4)",    // red
  "rgba(80, 160, 255, 0.4)",   // blue
  "rgba(80, 220, 120, 0.4)",   // green
  "rgba(255, 130, 180, 0.4)",  // pink
  "rgba(180, 140, 255, 0.4)",  // purple
  "rgba(255, 170, 70, 0.4)",   // orange
  "rgba(70, 210, 210, 0.4)",   // teal
  "rgba(220, 180, 40, 0.4)",   // gold
]

const AI_COLORS = [
  "rgba(255, 240, 80, 0.28)",
  "rgba(120, 210, 255, 0.28)",
  "rgba(120, 255, 170, 0.28)",
  "rgba(255, 160, 200, 0.28)",
  "rgba(210, 180, 255, 0.28)",
  "rgba(255, 200, 130, 0.28)",
  "rgba(100, 230, 200, 0.28)",
  "rgba(240, 200, 80, 0.28)",
]

function getSearchColor(index: number): string {
  return SEARCH_COLORS[index % SEARCH_COLORS.length]
}

function getAIColor(index: number): string {
  return AI_COLORS[index % AI_COLORS.length]
}

function getKbColor(index: number): string {
  return AI_COLORS[index % AI_COLORS.length]
}

const HIGHLIGHT_VALUE_MIN = 2
const HIGHLIGHT_VALUE_MAX = 80

function isHighlightableValue(value: string): boolean {
  const len = value.trim().length
  return len >= HIGHLIGHT_VALUE_MIN && len <= HIGHLIGHT_VALUE_MAX
}

// ── Text normalization ───────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s  - 　]+/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[・·]/g, "・")
    .replace(/[.,;:!?，。；：！？、]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenOverlapRatio(lineText: string, phrase: string): number {
  const lineTokens = lineText.split(/\s+/).filter((t) => t.length >= 2)
  const phraseTokens = phrase.split(/\s+/).filter((t) => t.length >= 2)
  if (phraseTokens.length < 2) return 0
  const overlap = phraseTokens.filter((t) =>
    lineTokens.some((lt) => lt.includes(t) || t.includes(lt))
  ).length
  return overlap / phraseTokens.length
}

function kbLineFuzzyMatch(lineText: string, phrase: string): boolean {
  const line = normalizeText(lineText)
  const p = normalizeText(phrase)
  if (p.length < 6) return false
  if (line.includes(p)) return true
  const compactLine = line.replace(/\s/g, "")
  const compactPhrase = p.replace(/\s/g, "")
  if (compactPhrase.length >= 6 && compactLine.includes(compactPhrase)) return true
  return tokenOverlapRatio(line, p) >= 0.4
}

function fuzzyMatch(text: string, pattern: string): boolean {
  // Try exact match
  if (text.includes(pattern)) return true

  // Try without spaces
  if (text.replace(/\s/g, "").includes(pattern.replace(/\s/g, ""))) return true

  // Try word-by-word: each word of pattern must appear in text
  const patternWords = pattern.split(/\s+/).filter((w) => w.length >= 2)
  if (patternWords.length > 1) {
    const allFound = patternWords.every((w) => text.includes(w))
    if (allFound) return true
  }

  return false
}

// ── Text extraction helpers ──────────────────────────────────

interface TextItem {
  str: string
  normalized: string
  x: number
  y: number       // baseline y in PDF coords (from bottom)
  width: number
  height: number  // font height in PDF points
  fontSize: number
}

interface PdfViewport {
  width: number
  height: number
  convertToViewportRectangle: (rect: number[]) => number[]
}

function fontSizeFromTransform(transform: number[]): number {
  return Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || 12
}

function itemBounds(item: Pick<TextItem, "x" | "y" | "width" | "height" | "fontSize">) {
  const h = item.height || item.fontSize
  return {
    left: item.x,
    pdfYTop: item.y - h,
    pdfYBottom: item.y,
    width: item.width,
    height: h,
  }
}

function extractTextItems(
  textContent: {
    items: Array<{
      str: string
      transform: number[]
      width: number
      height?: number
    }>
  }
): TextItem[] {
  return textContent.items
    .filter((item) => item.str && item.str.trim().length > 0)
    .map((item) => {
      const fontSize = fontSizeFromTransform(item.transform)
      return {
        str: item.str,
        normalized: normalizeText(item.str),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || fontSize,
        fontSize,
      }
    })
}

type LineRect = {
  left: number
  pdfYTop: number
  pdfYBottom: number
  width: number
  height: number
}

function median(nums: number[]): number {
  if (nums.length === 0) return 12
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function clampBoxHeight(box: LineRect, maxHeight: number): LineRect {
  if (box.height <= maxHeight) return box
  const center = (box.pdfYTop + box.pdfYBottom) / 2
  const half = maxHeight / 2
  return {
    ...box,
    pdfYTop: center - half,
    pdfYBottom: center + half,
    height: maxHeight,
  }
}

function isOversizedRect(box: LineRect, pageWidthPts: number, lineFontSize: number): boolean {
  return box.height > lineFontSize * 1.8 || box.width > pageWidthPts * 0.7
}

function toLineRects(items: TextItem[], pageWidthPts?: number): LineRect[] {
  if (items.length === 0) return []
  return groupByLine(items)
    .map((line) => {
      const box = mergeBoxes(line)
      const lineFontSize = median(line.map((i) => i.fontSize))
      const lineHeight = lineFontSize * 1.15
      const clamped = clampBoxHeight(box, lineHeight)
      if (pageWidthPts && isOversizedRect(clamped, pageWidthPts, lineFontSize)) {
        return null
      }
      return clamped
    })
    .filter((r): r is LineRect => r !== null)
}

function itemsForCharRange(lineItems: TextItem[], start: number, end: number): TextItem[] {
  const result: TextItem[] = []
  let charCount = 0
  for (const item of lineItems) {
    const len = item.normalized.length
    const itemStart = charCount
    const itemEnd = charCount + len
    if (itemEnd > start && itemStart < end) {
      result.push(item)
    }
    charCount += len
  }
  return result
}

function findMatchingItemsContiguous(lineItems: TextItem[], target: string): TextItem[] {
  const compact = lineItems.map((i) => i.normalized).join("")
  const spaced = lineItems.map((i) => i.normalized).join(" ")
  const noSpaceTarget = target.replace(/\s/g, "")

  const compactIdx = compact.indexOf(noSpaceTarget)
  if (compactIdx >= 0) {
    return itemsForCharRange(lineItems, compactIdx, compactIdx + noSpaceTarget.length)
  }

  const spacedIdx = spaced.indexOf(target)
  if (spacedIdx < 0) return []

  const result: TextItem[] = []
  let pos = 0
  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i]
    const itemStart = pos
    const itemEnd = pos + item.normalized.length
    if (itemEnd > spacedIdx && itemStart < spacedIdx + target.length) {
      result.push(item)
    }
    pos = itemEnd + (i < lineItems.length - 1 ? 1 : 0)
  }
  return result
}

function findTextLineRects(
  items: TextItem[],
  target: string,
  opts?: { fuzzy?: boolean; pageWidthPts?: number }
): LineRect[] {
  if (!target || target.length < 2 || items.length === 0) return []

  const fuzzy = opts?.fuzzy ?? false
  const pageWidthPts = opts?.pageWidthPts

  // Strategy 1: single text item — tight substring box
  for (const item of items) {
    const idx = item.normalized.indexOf(target)
    if (idx >= 0) {
      const bounds = itemBounds(item)
      let box: LineRect
      if (item.normalized.length === target.length || item.width <= 0) {
        box = bounds
      } else {
        const startRatio = idx / item.normalized.length
        const widthRatio = target.length / item.normalized.length
        box = {
          ...bounds,
          left: item.x + item.width * startRatio,
          width: Math.max(item.width * widthRatio, 8),
        }
      }
      const clamped = clampBoxHeight(box, item.fontSize * 1.15)
      if (pageWidthPts && isOversizedRect(clamped, pageWidthPts, item.fontSize)) {
        continue
      }
      return [clamped]
    }
  }

  // Strategy 2: multi-item match on the same line — one rect per line
  const lines = groupByLine(items)
  const noSpaceTarget = target.replace(/\s/g, "")

  for (const line of lines) {
    const fullTextSpaced = line.map((i) => i.normalized).join(" ")
    const fullTextCompact = line.map((i) => i.normalized).join("")

    const lineMatches = fuzzy
      ? fuzzyMatch(fullTextSpaced, target) || fullTextCompact.includes(noSpaceTarget)
      : fullTextSpaced.includes(target) || fullTextCompact.includes(noSpaceTarget)

    if (!lineMatches) continue

    let matched = findMatchingItemsContiguous(line, target)
    if (matched.length === 0 && noSpaceTarget !== target) {
      matched = findMatchingItemsContiguous(line, noSpaceTarget)
    }
    if (matched.length > 0) {
      const rects = toLineRects(matched, pageWidthPts)
      if (rects.length > 0) return rects
    }
  }

  return []
}

function groupByLine(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: TextItem[][] = []
  let current: TextItem[] = [sorted[0]]
  let lastY = sorted[0].y
  let lineThreshold = sorted[0].fontSize * 0.5

  for (let i = 1; i < sorted.length; i++) {
    lineThreshold = Math.max(lineThreshold, sorted[i].fontSize * 0.5)
    if (Math.abs(sorted[i].y - lastY) > lineThreshold) {
      lines.push(current)
      current = [sorted[i]]
      lastY = sorted[i].y
      lineThreshold = sorted[i].fontSize * 0.5
    } else {
      current.push(sorted[i])
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

function mergeBoxes(
  items: TextItem[]
): { left: number; pdfYTop: number; pdfYBottom: number; width: number; height: number } {
  let minX = Infinity
  let minYTop = Infinity    // smallest y (closest to bottom)
  let maxX = -Infinity
  let maxYBottom = -Infinity // largest y (furthest from bottom)

  for (const item of items) {
    const bounds = itemBounds(item)
    minX = Math.min(minX, bounds.left)
    minYTop = Math.min(minYTop, bounds.pdfYTop)
    maxX = Math.max(maxX, bounds.left + bounds.width)
    maxYBottom = Math.max(maxYBottom, bounds.pdfYBottom)
  }

  const pad = 1
  return {
    left: minX - pad,
    pdfYTop: minYTop - pad,
    pdfYBottom: maxYBottom + pad,
    width: Math.max(maxX - minX + pad * 2, 12),
    height: Math.max(maxYBottom - minYTop + pad * 2, 10),
  }
}

// ── Convert PDF coords to CSS % via viewport ─────────────────

function pdfRectToPercent(
  rect: { left: number; pdfYTop: number; pdfYBottom: number; width: number; height: number },
  viewport: PdfViewport,
  canvasW: number,
  canvasH: number
): { left: number; top: number; width: number; height: number } {
  const [vx, vy, vw, vh] = viewport.convertToViewportRectangle([
    rect.left,
    rect.pdfYTop,
    rect.left + rect.width,
    rect.pdfYBottom,
  ])
  return {
    left: (vx / canvasW) * 100,
    top: (vy / canvasH) * 100,
    width: (vw / canvasW) * 100,
    height: (vh / canvasH) * 100,
  }
}

// Stable defaults — avoid `prop = []` creating a new reference every render
const EMPTY_HIGHLIGHTS: Highlight[] = []
const EMPTY_KB_PHRASES: string[] = []

// ── Component ─────────────────────────────────────────────────

export default function PdfHighlightViewer({
  fileUrl,
  fileName,
  highlights = EMPTY_HIGHLIGHTS,
  kbPhrases = EMPTY_KB_PHRASES,
  className,
}: PdfHighlightViewerProps) {
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [hasTextLayer, setHasTextLayer] = useState(true)

  // AI highlights (legacy — disabled when kbPhrases provided)
  const [aiRects, setAiRects] = useState<Map<number, Rect[]>>(new Map())
  const [aiMatched, setAiMatched] = useState(0)
  const [computingAi, setComputingAi] = useState(false)

  // KB line highlights
  const [kbRects, setKbRects] = useState<Map<number, Rect[]>>(new Map())
  const [kbMatchedLines, setKbMatchedLines] = useState(0)
  const [kbTotalLines, setKbTotalLines] = useState(0)
  const [computingKb, setComputingKb] = useState(false)

  // Search highlights
  const [searchTerms, setSearchTerms] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [searchRects, setSearchRects] = useState<Map<number, Rect[]>>(new Map())
  const [searchMatched, setSearchMatched] = useState(0)
  const [computingSearch, setComputingSearch] = useState(false)

  const [retryKey, setRetryKey] = useState(0)
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null)
  const pdfRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null)
  const pageDimsRef = useRef<
    Map<number, { width: number; height: number; viewport: PdfViewport; pageWidthPts: number }>
  >(new Map())
  const pageWrapperRef = useRef<HTMLDivElement>(null)
  const pageItemsCacheRef = useRef<Map<number, TextItem[]>>(new Map())
  const highlightsRef = useRef<string>("")
  const kbPhrasesRef = useRef<string>("")
  const searchRef = useRef<string>("")

  // ── Colorize highlights ──────────────────────────────────

  const coloredHighlights = useMemo(() => {
    return highlights
      .filter((h) => isHighlightableValue(h.value))
      .map((h, i) => ({
        ...h,
        color: h.color || getAIColor(i),
      }))
  }, [highlights])

  const normalizedKbPhrases = useMemo(
    () =>
      kbPhrases
        .map((p, index) => ({ raw: p, normalized: normalizeText(p), index }))
        .filter((p) => p.normalized.length >= 6),
    [kbPhrases]
  )

  // ── Compute KB line highlight rects ──────────────────────

  useEffect(() => {
    if (numPages === 0) return
    if (normalizedKbPhrases.length === 0) {
      kbPhrasesRef.current = ""
      if (kbRects.size > 0) setKbRects(new Map())
      if (kbMatchedLines !== 0) setKbMatchedLines(0)
      if (kbTotalLines !== 0) setKbTotalLines(0)
      if (computingKb) setComputingKb(false)
      return
    }

    const key = `${numPages}-${normalizedKbPhrases.map((p) => p.normalized).join("|")}`
    if (key === kbPhrasesRef.current) return
    kbPhrasesRef.current = key

    let cancelled = false

    async function computeKb() {
      setComputingKb(true)
      const rects = new Map<number, Rect[]>()
      let matchedLines = 0
      let totalLines = 0

      try {
        for (let p = 1; p <= (pdfRef.current?.numPages || 0); p++) {
          if (cancelled) break
          const items = await getPageItems(p)
          if (!items) continue

          const lines = groupByLine(items)
          totalLines += lines.length
          const pageRects: Rect[] = []

          for (const line of lines) {
            const lineText = line.map((i) => i.str).join(" ")
            for (const ph of normalizedKbPhrases) {
              if (kbLineFuzzyMatch(lineText, ph.raw)) {
                const box = mergeBoxes(line)
                const lineFontSize = median(line.map((i) => i.fontSize))
                const clamped = clampBoxHeight(box, lineFontSize * 1.15)
                pageRects.push({
                  ...clamped,
                  field: "KB",
                  value: ph.raw,
                  color: getKbColor(ph.index),
                  source: "kb" as const,
                })
                matchedLines++
                break
              }
            }
          }

          if (pageRects.length > 0) rects.set(p, pageRects)
        }
      } catch { /* non-critical */ }

      if (!cancelled) {
        console.log(
          `[PdfHighlight] KB: matched ${matchedLines} lines across ${rects.size} pages (${normalizedKbPhrases.length} phrases)`
        )
        setKbRects(rects)
        setKbMatchedLines(matchedLines)
        setKbTotalLines(totalLines)
        setComputingKb(false)
      }
    }

    computeKb()
    return () => { cancelled = true }
  }, [normalizedKbPhrases, numPages, scale])

  // ── Compute AI highlight rects (legacy — skipped when KB phrases active) ──

  useEffect(() => {
    if (numPages === 0) return
    if (normalizedKbPhrases.length > 0 || coloredHighlights.length === 0) {
      highlightsRef.current = ""
      if (aiRects.size > 0) setAiRects(new Map())
      if (aiMatched !== 0) setAiMatched(0)
      if (computingAi) setComputingAi(false)
      return
    }

    const key = `${numPages}-${JSON.stringify(coloredHighlights)}`
    if (key === highlightsRef.current) return
    highlightsRef.current = key

    let cancelled = false

    async function compute() {
      setComputingAi(true)
      const rects = new Map<number, Rect[]>()
      let matched = 0

      try {
        const byPage = new Map<number, typeof coloredHighlights>()
        const unmatched: typeof coloredHighlights = []
        const totalPages = pdfRef.current?.numPages || 0

        for (const hl of coloredHighlights) {
          if (hl.page && hl.page >= 1 && hl.page <= totalPages) {
            const arr = byPage.get(hl.page) || []
            byPage.set(hl.page, [...arr, hl])
          } else {
            unmatched.push(hl)
          }
        }

        function pushLineRects(
          page: number,
          hl: (typeof coloredHighlights)[number],
          lineRects: LineRect[]
        ) {
          if (lineRects.length === 0) return
          const arr = rects.get(page) || []
          for (const r of lineRects) {
            arr.push({
              ...r,
              field: hl.field,
              value: hl.value,
              color: hl.color!,
              source: "ai" as const,
            })
          }
          rects.set(page, arr)
          matched++
        }

        // Page-hinted highlights: search only on the specified page
        for (const [page, pageHls] of [...byPage.entries()]) {
          if (cancelled) break
          const items = await getPageItems(page)
          if (!items) continue
          const pageWidthPts = pageDimsRef.current.get(page)?.pageWidthPts

          for (const hl of pageHls) {
            const lineRects = findTextLineRects(items, normalizeText(hl.value), {
              fuzzy: false,
              pageWidthPts,
            })
            pushLineRects(page, hl, lineRects)
          }
        }

        // No page hint: strict match across all pages, stop when found
        for (const hl of unmatched) {
          if (cancelled) break
          const target = normalizeText(hl.value)
          let found = false

          for (let p = 1; p <= totalPages; p++) {
            if (cancelled || found) break
            try {
              const items = await getPageItems(p)
              if (!items) continue
              const pageWidthPts = pageDimsRef.current.get(p)?.pageWidthPts
              const lineRects = findTextLineRects(items, target, {
                fuzzy: false,
                pageWidthPts,
              })
              if (lineRects.length > 0) {
                pushLineRects(p, hl, lineRects)
                found = true
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* non-critical */ }

      if (!cancelled) {
        console.log(`[PdfHighlight] AI: matched ${matched}/${coloredHighlights.length} values across ${rects.size} pages`)
        if (matched === 0 && coloredHighlights.length > 0) {
          console.log("[PdfHighlight] Sample target values:", coloredHighlights.slice(0, 3).map(h => h.value))
        }
        setAiRects(rects)
        setAiMatched(matched)
        setComputingAi(false)
      }
    }

    compute()
    return () => { cancelled = true }
  }, [coloredHighlights, numPages, scale])

  // ── Compute search highlight rects ───────────────────────

  useEffect(() => {
    if (numPages === 0) return

    const key = searchTerms.join("|")
    if (key === searchRef.current) return
    searchRef.current = key

    if (searchTerms.length === 0) {
      if (searchRects.size > 0) setSearchRects(new Map())
      if (searchMatched !== 0) setSearchMatched(0)
      if (computingSearch) setComputingSearch(false)
      return
    }

    let cancelled = false

    async function compute() {
      setComputingSearch(true)
      const rects = new Map<number, Rect[]>()
      let matched = 0

      for (let p = 1; p <= (pdfRef.current?.numPages || 0); p++) {
        if (cancelled) break
        try {
          const items = await getPageItems(p)
          if (!items) continue

          for (let i = 0; i < searchTerms.length; i++) {
            const term = searchTerms[i]
            const normalizedTerm = normalizeText(term)
            if (normalizedTerm.length < 2) continue

            const pageWidthPts = pageDimsRef.current.get(p)?.pageWidthPts
            const lineRects = findTextLineRects(items, normalizedTerm, {
              fuzzy: true,
              pageWidthPts,
            })
            if (lineRects.length > 0) {
              const arr = rects.get(p) || []
              for (const r of lineRects) {
                arr.push({
                  ...r,
                  field: term,
                  value: term,
                  color: getSearchColor(i),
                  source: "search" as const,
                })
              }
              rects.set(p, arr)
              matched++
            }
          }
        } catch { /* skip */ }
      }

      if (!cancelled) {
        console.log(`[PdfHighlight] Search: matched ${matched}/${searchTerms.length} terms across ${rects.size} pages`)
        setSearchRects(rects)
        setSearchMatched(matched)
        setComputingSearch(false)
      }
    }

    compute()
    return () => { cancelled = true }
  }, [searchTerms, numPages, scale])

  // ── Helpers ──────────────────────────────────────────────

  async function getPageItems(pageNum: number): Promise<TextItem[] | null> {
    const cached = pageItemsCacheRef.current.get(pageNum)
    if (cached) return cached

    try {
      const pageObj = (await pdfRef.current!.getPage(pageNum)) as {
        getTextContent: () => Promise<{ items: Array<{ str: string; transform: number[]; width: number; height?: number }> }>
        getViewport: (opts: { scale: number }) => PdfViewport
      }
      const viewport = pageObj.getViewport({ scale })
      const viewport1 = pageObj.getViewport({ scale: 1 })
      pageDimsRef.current.set(pageNum, {
        width: viewport.width,
        height: viewport.height,
        viewport,
        pageWidthPts: viewport1.width,
      })
      const textContent = await pageObj.getTextContent()
      if (textContent.items.length === 0) return null
      const items = extractTextItems(textContent)
      pageItemsCacheRef.current.set(pageNum, items)
      return items
    } catch {
      return null
    }
  }

  function addSearchTerm() {
    const term = searchInput.trim()
    if (!term || searchTerms.includes(term)) return
    setSearchTerms([...searchTerms, term])
    setSearchInput("")
  }

  function removeSearchTerm(term: string) {
    setSearchTerms(searchTerms.filter((t) => t !== term))
    // Force recompute: reset then redo
    setSearchRects(new Map())
    setSearchMatched(0)
    searchRef.current = ""
  }

  // ── Document callbacks ───────────────────────────────────

  function handleDocumentLoadSuccess(doc: { numPages: number; getPage: (n: number) => Promise<unknown> }) {
    pdfRef.current = doc
    setNumPages(doc.numPages)
    setPdfLoading(false)
    setPdfError(null)
  }

  function handleDocumentLoadError(error: Error) {
    console.error("PDF load error:", error)
    setPdfLoading(false)
    setPdfError(error.message || "Failed to load PDF")
  }

  async function handlePageRenderSuccess(page: { _transport?: { pageIndex?: number }; pageNumber?: number }) {
    const pn = (page.pageNumber ?? (page._transport?.pageIndex ?? 0) + 1)
    if (!pdfRef.current) return
    try {
      const pageObj = (await pdfRef.current.getPage(pn)) as {
        getViewport: (opts: { scale: number }) => PdfViewport
        getTextContent: () => Promise<{ items: unknown[] }>
      }
      const vp = pageObj.getViewport({ scale })
      const vp1 = pageObj.getViewport({ scale: 1 })
      pageDimsRef.current.set(pn, {
        width: vp.width,
        height: vp.height,
        viewport: vp,
        pageWidthPts: vp1.width,
      })

      const canvas = pageWrapperRef.current?.querySelector("canvas")
      if (canvas) {
        const w = canvas.offsetWidth
        const h = canvas.offsetHeight
        setCanvasSize((prev) => (prev?.width === w && prev?.height === h ? prev : { width: w, height: h }))
      }

      if (aiRects.size === 0 && kbRects.size === 0 && searchRects.size === 0) {
        const tc = await pageObj.getTextContent()
        setHasTextLayer(tc.items.length > 0)
      }
    } catch { /* non-critical */ }
  }

  // ── Navigation ───────────────────────────────────────────

  const goToPrev = useCallback(() => setPageNumber((p) => Math.max(1, p - 1)), [])
  const goToNext = useCallback(() => setPageNumber((p) => Math.min(numPages, p + 1)), [numPages])
  const zoomIn = useCallback(() => setScale((s) => Math.min(3.0, s + 0.25)), [])
  const zoomOut = useCallback(() => setScale((s) => Math.max(0.5, s - 0.25)), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goToNext() }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); goToPrev() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [goToNext, goToPrev])

  // Reset on file change
  useEffect(() => {
    setPdfLoading(true)
    setPdfError(null)
    setPageNumber(1)
    setScale(1.0)
    setAiRects(new Map())
    setAiMatched(0)
    setKbRects(new Map())
    setKbMatchedLines(0)
    setKbTotalLines(0)
    setSearchRects(new Map())
    setSearchMatched(0)
    setSearchTerms([])
    setSearchInput("")
    setComputingAi(false)
    setComputingKb(false)
    setComputingSearch(false)
    setHasTextLayer(true)
    setCanvasSize(null)
    pdfRef.current = null
    pageDimsRef.current = new Map()
    pageItemsCacheRef.current = new Map()
    highlightsRef.current = ""
    kbPhrasesRef.current = ""
    searchRef.current = ""
  }, [fileUrl])

  // Invalidate viewport cache on zoom so overlay coords recompute
  useEffect(() => {
    pageDimsRef.current.clear()
    highlightsRef.current = ""
    kbPhrasesRef.current = ""
    searchRef.current = ""
  }, [scale])

  // Re-measure canvas when scale or page changes
  useEffect(() => {
    const canvas = pageWrapperRef.current?.querySelector("canvas")
    if (canvas) {
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      setCanvasSize({ width: w, height: h })
    }
  }, [scale, pageNumber, pdfLoading])

  // Fallback overlay size from page dims when canvas not yet measured
  useEffect(() => {
    if (aiRects.size === 0 && kbRects.size === 0 && searchRects.size === 0) return
    if (canvasSize) return
    const d = pageDimsRef.current.get(pageNumber)
    if (d) setCanvasSize({ width: d.width, height: d.height })
  }, [aiRects, kbRects, searchRects, pageNumber, canvasSize])

  // ── Highlight rendering helper ───────────────────────────

  function renderRects(
    rects: Rect[],
    dims: { width: number; height: number; viewport: PdfViewport },
    canvas: { width: number; height: number }
  ) {
    return rects.map((rect, i) => {
      const css = pdfRectToPercent(rect, dims.viewport, canvas.width, canvas.height)
      return (
        <div
          key={i}
          className="absolute rounded-[2px] pointer-events-none"
          style={{
            left: `${css.left}%`,
            top: `${css.top}%`,
            width: `${css.width}%`,
            height: `${css.height}%`,
            backgroundColor: rect.color,
            boxShadow: `inset 0 0 0 1px ${rect.color.replace(/[\d.]+\)$/, "0.6)")}`,
          }}
          title={`${rect.field}: ${rect.value}${
            rect.source === "search" ? " (search)" : rect.source === "kb" ? " (KB)" : " (AI)"
          }`}
        />
      )
    })
  }

  // ── Render ───────────────────────────────────────────────

  const dims = pageDimsRef.current.get(pageNumber)
  const overlaySize =
    canvasSize ??
    (dims ? { width: dims.width, height: dims.height } : null)
  const allPageRects: Rect[] = [
    ...(kbRects.get(pageNumber) || []),
    ...(normalizedKbPhrases.length === 0 ? aiRects.get(pageNumber) || [] : []),
    ...(searchRects.get(pageNumber) || []),
  ]
  const totalAi = coloredHighlights.length
  const totalSearch = searchTerms.length
  const totalRects = allPageRects.length
  const isComputing = computingKb || computingAi || computingSearch

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="flex flex-col gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        {/* Row 1: navigation + zoom */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={goToPrev} disabled={pageNumber <= 1 || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums min-w-[80px] text-center">
              Page {numPages > 0 ? pageNumber : "-"} of {numPages || "-"}
            </span>
            <button onClick={goToNext} disabled={pageNumber >= numPages || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Next page">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={zoomOut} disabled={scale <= 0.5 || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums w-[40px] text-center">{Math.round(scale * 100)}%</span>
            <button onClick={zoomIn} disabled={scale >= 3.0 || pdfLoading}
              className="rounded-md p-1 hover:bg-accent disabled:opacity-30" title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Row 2: search bar */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1 rounded-md border bg-background px-2 py-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSearchTerm() }}
              placeholder="Search keywords to highlight..."
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
            {searchInput && (
              <button onClick={addSearchTerm} className="text-xs text-primary hover:underline shrink-0">
                Add
              </button>
            )}
          </div>
        </div>

        {/* Row 3: active search chips */}
        {searchTerms.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <Palette className="h-3 w-3 text-muted-foreground shrink-0" />
            {searchTerms.map((term, i) => (
              <span
                key={term}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border"
                style={{
                  borderColor: getSearchColor(i).replace(/[\d.]+\)$/, "0.8)"),
                  backgroundColor: getSearchColor(i),
                }}
              >
                {term}
                <button onClick={() => removeSearchTerm(term)} className="ml-0.5 hover:opacity-70">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {searchTerms.length > 1 && (
              <button
                onClick={() => { setSearchTerms([]); setSearchRects(new Map()); setSearchMatched(0); searchRef.current = "" }}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* PDF Content */}
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
              onClick={() => {
                setPdfLoading(true)
                setPdfError(null)
                pdfRef.current = null
                setAiRects(new Map())
                setSearchRects(new Map())
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
              key={retryKey}
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
                {/* Highlight overlays — sized to match canvas */}
                {dims && overlaySize && totalRects > 0 && (
                  <div
                    className="absolute top-0 left-0 pointer-events-none"
                    style={{ width: overlaySize.width, height: overlaySize.height }}
                  >
                    {renderRects(allPageRects, dims, overlaySize)}
                  </div>
                )}
              </div>
            </Document>
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t bg-muted/20 rounded-b-lg text-xs text-muted-foreground">
        <span>{numPages > 0 && `${numPages} page${numPages > 1 ? "s" : ""}`}</span>
        <div className="flex items-center gap-3">
          {isComputing && (
            <span className="flex items-center gap-1">
              <Search className="h-3 w-3 animate-pulse" />
              Searching...
            </span>
          )}
          {!isComputing && normalizedKbPhrases.length > 0 && (
            <span title="KB-matched lines">
              KB lines: {kbMatchedLines}
              {kbTotalLines > 0 ? `/${kbTotalLines}` : ""}
            </span>
          )}
          {!isComputing && normalizedKbPhrases.length === 0 && totalAi > 0 && (
            <span title="AI-extracted highlights">
              AI {aiMatched}/{totalAi}
            </span>
          )}
          {!isComputing && totalSearch > 0 && (
            <span title="Search highlights">
              🔍 {searchMatched}/{totalSearch}
            </span>
          )}
          {!hasTextLayer && !pdfLoading && !pdfError && (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              No selectable text
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
