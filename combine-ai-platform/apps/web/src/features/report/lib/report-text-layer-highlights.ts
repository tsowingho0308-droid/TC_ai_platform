export interface TextLayerBox {
  left: number
  top: number
  width: number
  height: number
}

export interface HighlightTarget {
  field: string
  value: string
  page?: number
}

export interface ValueMatchOptions {
  allowAmbiguous?: boolean
  /** When true, return boxes for every distinct match on the page (focus mode). */
  allMatches?: boolean
  /** Pre-fetched text layer spans (avoids repeated DOM queries per value). */
  spanEls?: HTMLSpanElement[]
}

/** Strip multi-document prefix "filename · field" for PDF text matching. */
export function stripSourcePrefix(field: string): string {
  const sep = field.indexOf(" · ")
  if (sep <= 0) return field
  return field.slice(sep + 3)
}

export function highlightTargetsMatch(a: HighlightTarget, b: HighlightTarget): boolean {
  if (a.field !== b.field || a.value !== b.value) return false
  if (a.page != null && b.page != null && a.page !== b.page) return false
  return true
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\u00a0 - 　]+/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[;:!?，。；：！？、]/g, "")
    .replace(/(?<!\d)\.(?!\d)/g, "")
    .replace(/,(?!\d)/g, "")
    .replace(/\$\s+/g, "$")
    .replace(/\s+/g, " ")
    .trim()
}

function mergeLineBoxes(boxes: TextLayerBox[]): TextLayerBox[] {
  if (boxes.length === 0) return []
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left)
  const merged: TextLayerBox[] = []
  const lineThreshold = 4

  for (const box of sorted) {
    const last = merged[merged.length - 1]
    if (
      last &&
      Math.abs(last.top - box.top) < lineThreshold &&
      box.left <= last.left + last.width + 8
    ) {
      const right = Math.max(last.left + last.width, box.left + box.width)
      last.left = Math.min(last.left, box.left)
      last.width = right - last.left
      last.top = Math.min(last.top, box.top)
      last.height = Math.max(last.height, box.height)
    } else {
      merged.push({ ...box })
    }
  }
  return merged
}

function boxesFromSpanRange(
  spanEls: HTMLSpanElement[],
  startIdx: number,
  endIdx: number,
  containerRect: DOMRect,
  charStart?: number,
  charEnd?: number
): TextLayerBox[] {
  const boxes: TextLayerBox[] = []
  let offset = 0

  for (let k = startIdx; k <= endIdx; k++) {
    const text = spanEls[k].textContent || ""
    const spanStart = offset
    const spanEnd = offset + text.length
    offset = spanEnd

    if (charStart != null && charEnd != null) {
      if (spanEnd <= charStart || spanStart >= charEnd) continue
    }

    const rect = spanEls[k].getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    boxes.push({
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
      width: rect.width,
      height: rect.height,
    })
  }
  return mergeLineBoxes(boxes)
}

/** Read PDF.js text layer spans from a rendered page wrapper. */
export function readTextLayerSpans(pageWrapper: HTMLElement): HTMLSpanElement[] {
  const textLayer = pageWrapper.querySelector(".react-pdf__Page__textContent")
  if (!textLayer) return []
  return Array.from(textLayer.querySelectorAll('span[role="presentation"], span')) as HTMLSpanElement[]
}

function compactForMatch(text: string): string {
  return normalizeText(text)
    .replace(/\b(hkd|hk\$|usd|cnh|cny|rmb)\b/gi, "")
    .replace(/[$¥€£]/g, "")
    .replace(/[\s,]/g, "")
}

type MatchNeedle = { mode: "norm" | "compact" | "loose"; value: string }

function buildMatchNeedles(targetValue: string): MatchNeedle[] {
  const normTarget = normalizeText(targetValue)
  const compactTarget = compactForMatch(targetValue)
  const looseTarget = normTarget.replace(/\$\s+/g, "$")
  const needles: MatchNeedle[] = []

  if (normTarget.length >= 2) needles.push({ mode: "norm", value: normTarget })
  if (looseTarget.length >= 2 && looseTarget !== normTarget) {
    needles.push({ mode: "loose", value: looseTarget })
  }
  if (compactTarget.length >= 3) needles.push({ mode: "compact", value: compactTarget })

  return needles
}

function haystackForMode(combined: string, mode: MatchNeedle["mode"]): string {
  if (mode === "compact") return compactForMatch(combined)
  const norm = normalizeText(combined)
  return mode === "loose" ? norm.replace(/\$\s+/g, "$") : norm
}

interface SpanRangeMatch {
  startIdx: number
  endIdx: number
  spanCount: number
  charStart: number
  charEnd: number
}

function findTightSpanMatches(
  spanEls: HTMLSpanElement[],
  needles: MatchNeedle[],
  normTargetLen: number
): SpanRangeMatch[] {
  const matches: SpanRangeMatch[] = []

  for (const needle of needles) {
    for (let i = 0; i < spanEls.length; i++) {
      let combined = ""
      for (let j = i; j < spanEls.length; j++) {
        combined += spanEls[j].textContent || ""
        const haystack = haystackForMode(combined, needle.mode)
        if (haystack.includes(needle.value)) {
          let charStart = 0
          for (let cut = 0; cut < combined.length; cut++) {
            const tail = combined.slice(cut)
            if (haystackForMode(tail, needle.mode).includes(needle.value)) {
              charStart = cut
              break
            }
          }
          matches.push({
            startIdx: i,
            endIdx: j,
            spanCount: j - i,
            charStart,
            charEnd: combined.length,
          })
          break
        }
        if (normalizeText(combined).length > normTargetLen + 120) break
      }
    }
  }

  return matches
}

function dedupeSpanMatches(matches: SpanRangeMatch[]): SpanRangeMatch[] {
  const seen = new Set<string>()
  const unique: SpanRangeMatch[] = []
  for (const m of matches.sort((a, b) => a.spanCount - b.spanCount || a.startIdx - b.startIdx)) {
    const key = `${m.startIdx}:${m.endIdx}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(m)
  }
  return unique
}

function findSpanRangeMatches(spanEls: HTMLSpanElement[], target: string): { startIdx: number; endIdx: number }[] {
  const matches: { startIdx: number; endIdx: number }[] = []
  const targetCompact = target.replace(/\s/g, "")
  const slack = Math.max(4, Math.floor(target.length * 0.2))

  for (let i = 0; i < spanEls.length; i++) {
    let combined = ""
    for (let j = i; j < spanEls.length; j++) {
      combined += spanEls[j].textContent || ""
      const norm = normalizeText(combined)
      const compact = norm.replace(/\s/g, "")

      if (norm === target || compact === targetCompact) {
        matches.push({ startIdx: i, endIdx: j })
        break
      }
      if (norm.includes(target) && norm.length <= target.length + slack) {
        matches.push({ startIdx: i, endIdx: j })
        break
      }
      if (
        targetCompact.length >= 2 &&
        compact.includes(targetCompact) &&
        compact.length <= targetCompact.length + slack
      ) {
        matches.push({ startIdx: i, endIdx: j })
        break
      }
      if (norm.length > target.length + 80) break
    }
  }

  return matches
}

/** Last-resort: wider tight-span scan (used when substring pass uses stricter window). */
function findFullPageSpanMatch(
  spanEls: HTMLSpanElement[],
  targetValue: string,
  containerRect: DOMRect,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  const needles = buildMatchNeedles(targetValue)
  const normTargetLen = normalizeText(targetValue).length
  const matches: SpanRangeMatch[] = []

  for (const needle of needles) {
    for (let i = 0; i < spanEls.length; i++) {
      let combined = ""
      for (let j = i; j < spanEls.length; j++) {
        combined += spanEls[j].textContent || ""
        const haystack = haystackForMode(combined, needle.mode)
        if (haystack.includes(needle.value)) {
          let charStart = 0
          for (let cut = 0; cut < combined.length; cut++) {
            const tail = combined.slice(cut)
            if (haystackForMode(tail, needle.mode).includes(needle.value)) {
              charStart = cut
              break
            }
          }
          matches.push({
            startIdx: i,
            endIdx: j,
            spanCount: j - i,
            charStart,
            charEnd: combined.length,
          })
          break
        }
        if (normalizeText(combined).length > normTargetLen + 250) break
      }
    }
  }

  if (matches.length === 0) return []
  if (matches.length > 3 && !opts?.allowAmbiguous) return []

  const deduped = dedupeSpanMatches(matches)
  const selected = opts?.allMatches ? deduped : [deduped[0]]
  const allBoxes: TextLayerBox[] = []
  for (const match of selected) {
    allBoxes.push(
      ...boxesFromSpanRange(
        spanEls,
        match.startIdx,
        match.endIdx,
        containerRect,
        match.charStart,
        match.charEnd
      )
    )
  }
  return mergeLineBoxes(allBoxes)
}

/** Build search needles from value text only (no field label). */
export function buildValueOnlyNeedles(value: string): string[] {
  const cleanValue = value.trim()
  const needles: string[] = []

  const add = (raw: string) => {
    const t = raw.trim()
    if (t.length >= 2 && !needles.some((n) => normalizeText(n) === normalizeText(t))) {
      needles.push(t)
    }
  }

  add(cleanValue)

  for (const match of cleanValue.matchAll(/\(([^)]+)\)/g)) add(match[1])

  for (const part of cleanValue.split(/[;·]/)) {
    if (part.trim() !== cleanValue) add(part)
  }

  const pctMatch = cleanValue.match(/[\d.]+%/)
  if (pctMatch) add(pctMatch[0])

  const amountMatch = cleanValue.match(
    /(?:HK\$|HKD\s*[\$]?|\$)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(HKD|USD|CNY|CNH|RMB)/i
  )
  if (amountMatch) {
    const num = (amountMatch[1] || amountMatch[2] || "").trim()
    const currency = (amountMatch[3] || "HKD").toUpperCase()
    if (num) {
      add(num)
      add(num.replace(/,/g, ""))
      add(`$${num}`)
      add(`HK$${num}`)
      add(`HK$ ${num}`)
      add(`$${num} ${currency}`)
      add(`${num} ${currency}`)
      add(`${currency} ${num}`)
    }
  }

  const digits = cleanValue.replace(/[^\d.]/g, "")
  if (digits.length >= 3) add(digits)

  return needles
}

/** @deprecated Use buildValueOnlyNeedles — field needles are no longer used for PDF matching. */
export function buildValueNeedles(field: string, value: string): string[] {
  return buildValueOnlyNeedles(value)
}

function findSubstringMatch(
  spanEls: HTMLSpanElement[],
  targetValue: string,
  containerRect: DOMRect,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  const normTarget = normalizeText(targetValue)
  if (normTarget.length < 2) return []

  const needles = buildMatchNeedles(targetValue)
  const rawMatches = findTightSpanMatches(spanEls, needles, normTarget.length)
  if (rawMatches.length === 0) return []
  if (rawMatches.length > 3 && !opts?.allowAmbiguous) return []

  const matches = dedupeSpanMatches(rawMatches)
  const selected = opts?.allMatches ? matches : [matches[0]]

  const allBoxes: TextLayerBox[] = []
  for (const match of selected) {
    const boxes = boxesFromSpanRange(
      spanEls,
      match.startIdx,
      match.endIdx,
      containerRect,
      match.charStart,
      match.charEnd
    )
    allBoxes.push(...boxes)
  }

  return mergeLineBoxes(allBoxes)
}

function findTextLayerMatchWithSpans(
  pageWrapper: HTMLElement,
  spanEls: HTMLSpanElement[],
  targetValue: string,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  if (spanEls.length === 0) return []

  const target = normalizeText(targetValue)
  if (target.length < 2) return []

  const matches = findSpanRangeMatches(spanEls, target)
  if (matches.length === 0) return []
  if (matches.length > 3 && !opts?.allowAmbiguous) return []

  const best = [...matches].sort(
    (a, b) => a.endIdx - a.startIdx - (b.endIdx - b.startIdx)
  )[0]

  const containerRect = pageWrapper.getBoundingClientRect()
  return boxesFromSpanRange(spanEls, best.startIdx, best.endIdx, containerRect)
}

/**
 * Locate highlight boxes for a target string using the rendered PDF text layer DOM.
 * Returns at most one merged box group (best / shortest match).
 */
export function findTextLayerMatch(
  pageWrapper: HTMLElement,
  targetValue: string,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  const spanEls = opts?.spanEls ?? readTextLayerSpans(pageWrapper)
  return findTextLayerMatchWithSpans(pageWrapper, spanEls, targetValue, opts)
}

export function findSearchTermMatches(
  pageWrapper: HTMLElement,
  searchTerm: string,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  return findTextLayerMatch(pageWrapper, searchTerm, { ...opts, allowAmbiguous: true })
}

/**
 * Locate highlight boxes for an extracted value using PDF text layer only.
 * Substring matching is tried first (embedded values in bullet lines).
 */
export function findValueMatch(
  pageWrapper: HTMLElement,
  value: string,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  const cleanValue = value.trim()
  if (cleanValue.length < 1) return []

  const spanEls = opts?.spanEls ?? readTextLayerSpans(pageWrapper)
  if (spanEls.length === 0) return []

  const containerRect = pageWrapper.getBoundingClientRect()
  const needles = buildValueOnlyNeedles(cleanValue)
  const matchOpts = { ...opts, spanEls }

  for (const needle of needles) {
    const boxes = findSubstringMatch(spanEls, needle, containerRect, matchOpts)
    if (boxes.length > 0) return boxes
  }

  for (const needle of needles) {
    const boxes = findTextLayerMatchWithSpans(pageWrapper, spanEls, needle, matchOpts)
    if (boxes.length > 0) return boxes
  }

  for (const needle of needles) {
    const boxes = findFullPageSpanMatch(spanEls, needle, containerRect, matchOpts)
    if (boxes.length > 0) return boxes
  }

  return []
}

/** @deprecated Use findValueMatch — matching is value-only; field is ignored. */
export function findFieldValueMatch(
  pageWrapper: HTMLElement,
  _field: string,
  value: string,
  opts?: ValueMatchOptions
): TextLayerBox[] {
  return findValueMatch(pageWrapper, value, opts)
}

export const HIGHLIGHT_BLUE = "rgba(80, 160, 255, 0.45)"
export const HIGHLIGHT_YELLOW = "rgba(255, 220, 80, 0.45)"
export const SEARCH_COLORS = [
  "rgba(255, 80, 80, 0.4)",
  "rgba(80, 220, 120, 0.4)",
  "rgba(255, 170, 70, 0.4)",
  "rgba(180, 140, 255, 0.4)",
]
