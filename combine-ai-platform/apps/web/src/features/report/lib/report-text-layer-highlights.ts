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
    .replace(/[.,;:!?，。；：！？、]/g, "")
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
  containerRect: DOMRect
): TextLayerBox[] {
  const boxes: TextLayerBox[] = []
  for (let k = startIdx; k <= endIdx; k++) {
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

function findSpanRangeMatches(spanEls: HTMLSpanElement[], target: string): { startIdx: number; endIdx: number }[] {
  const matches: { startIdx: number; endIdx: number }[] = []
  const targetCompact = target.replace(/\s/g, "")

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
      if (norm.includes(target) && norm.length <= target.length + 4) {
        matches.push({ startIdx: i, endIdx: j })
        break
      }
      if (targetCompact.length >= 2 && compact.includes(targetCompact) && compact.length <= targetCompact.length + 4) {
        matches.push({ startIdx: i, endIdx: j })
        break
      }
      if (norm.length > target.length + 40) break
    }
  }

  return matches
}

function compactForMatch(text: string): string {
  return normalizeText(text)
    .replace(/\bhkd\b|\bhk\b/g, "")
    .replace(/[\s$¥€£,]/g, "")
}

/** Build search needles from field/value for PDF text layer matching. */
export function buildValueNeedles(field: string, value: string): string[] {
  const cleanField = stripSourcePrefix(field).trim()
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
  for (const match of cleanField.matchAll(/\(([^)]+)\)/g)) add(match[1])

  const dashIdx = cleanField.lastIndexOf(" - ")
  if (dashIdx >= 0) add(cleanField.slice(dashIdx + 3))

  for (const part of cleanValue.split(/[,;·]/)) add(part)
  for (const part of cleanField.split(/[,;·]/)) add(part)

  const digits = cleanValue.replace(/[^\d.]/g, "")
  if (digits.length >= 3) add(digits)

  return needles
}

function findSubstringMatch(
  spanEls: HTMLSpanElement[],
  targetValue: string,
  containerRect: DOMRect,
  opts?: { allowAmbiguous?: boolean }
): TextLayerBox[] {
  const normTarget = normalizeText(targetValue)
  if (normTarget.length < 2) return []

  const compactTarget = compactForMatch(targetValue)
  const needles: Array<{ haystack: "norm" | "compact"; value: string }> = [
    { haystack: "norm", value: normTarget },
  ]
  if (compactTarget.length >= 3 && compactTarget !== normTarget.replace(/\s/g, "")) {
    needles.push({ haystack: "compact", value: compactTarget })
  }

  const matches: { startIdx: number; endIdx: number; spanCount: number }[] = []

  for (const needle of needles) {
    for (let i = 0; i < spanEls.length; i++) {
      let combined = ""
      for (let j = i; j < spanEls.length; j++) {
        combined += spanEls[j].textContent || ""
        const haystack =
          needle.haystack === "compact" ? compactForMatch(combined) : normalizeText(combined)

        if (haystack.includes(needle.value)) {
          matches.push({ startIdx: i, endIdx: j, spanCount: j - i })
          break
        }
        if (normalizeText(combined).length > normTarget.length + 120) break
      }
    }
  }

  if (matches.length === 0) return []
  if (matches.length > 3 && !opts?.allowAmbiguous) return []

  const best = [...matches].sort((a, b) => a.spanCount - b.spanCount)[0]
  return boxesFromSpanRange(spanEls, best.startIdx, best.endIdx, containerRect)
}

/**
 * Locate highlight boxes for a target string using the rendered PDF text layer DOM.
 * Returns at most one merged box group (best / shortest match).
 */
export function findTextLayerMatch(
  pageWrapper: HTMLElement,
  targetValue: string,
  opts?: { allowAmbiguous?: boolean }
): TextLayerBox[] {
  const textLayer = pageWrapper.querySelector(".react-pdf__Page__textContent") as HTMLElement | null
  if (!textLayer) return []

  const target = normalizeText(targetValue)
  if (target.length < 2) return []

  const spanEls = Array.from(textLayer.querySelectorAll("span")) as HTMLSpanElement[]
  if (spanEls.length === 0) return []

  const matches = findSpanRangeMatches(spanEls, target)
  if (matches.length === 0) return []
  if (matches.length > 3 && !opts?.allowAmbiguous) return []

  const best = [...matches].sort(
    (a, b) => a.endIdx - a.startIdx - (b.endIdx - b.startIdx)
  )[0]

  const containerRect = pageWrapper.getBoundingClientRect()
  return boxesFromSpanRange(spanEls, best.startIdx, best.endIdx, containerRect)
}

export function findSearchTermMatches(
  pageWrapper: HTMLElement,
  searchTerm: string
): TextLayerBox[] {
  return findTextLayerMatch(pageWrapper, searchTerm, { allowAmbiguous: true })
}

function mergeAdjacentBoxes(fieldBox: TextLayerBox, valueBox: TextLayerBox): TextLayerBox | null {
  const lineThreshold = 8
  if (Math.abs(fieldBox.top - valueBox.top) >= lineThreshold) return null
  if (fieldBox.left + fieldBox.width > valueBox.left + 4) return null
  const left = Math.min(fieldBox.left, valueBox.left)
  const right = Math.max(fieldBox.left + fieldBox.width, valueBox.left + valueBox.width)
  return {
    left,
    top: Math.min(fieldBox.top, valueBox.top),
    width: right - left,
    height: Math.max(fieldBox.height, valueBox.height),
  }
}

/**
 * Locate highlight boxes for a field-value pair. Tries combined strings first,
 * then separate field + value boxes on the same line, then value-only fallback.
 */
export function findFieldValueMatch(
  pageWrapper: HTMLElement,
  field: string,
  value: string,
  opts?: { allowAmbiguous?: boolean }
): TextLayerBox[] {
  const cleanField = stripSourcePrefix(field).trim()
  const cleanValue = value.trim()
  if (cleanValue.length < 1) return []

  const needles = buildValueNeedles(field, value)

  for (const needle of needles) {
    const candidates = [
      `${cleanField}: ${needle}`,
      `${cleanField} ${needle}`,
      `${cleanField}：${needle}`,
      needle,
    ].filter((c, i, arr) => c.length >= 2 && arr.indexOf(c) === i)

    for (const candidate of candidates) {
      const boxes = findTextLayerMatch(pageWrapper, candidate, opts)
      if (boxes.length > 0) return boxes
    }
  }

  if (cleanField.length >= 2) {
    const fieldBoxes = findTextLayerMatch(pageWrapper, cleanField, opts)
    const valueBoxes = findTextLayerMatch(pageWrapper, cleanValue, opts)
    if (fieldBoxes.length > 0 && valueBoxes.length > 0) {
      const merged = mergeAdjacentBoxes(fieldBoxes[0], valueBoxes[0])
      if (merged) return [merged]
      return [...fieldBoxes, ...valueBoxes]
    }
    if (valueBoxes.length > 0) return valueBoxes
  }

  const textLayer = pageWrapper.querySelector(".react-pdf__Page__textContent") as HTMLElement | null
  if (!textLayer) return []
  const spanEls = Array.from(textLayer.querySelectorAll("span")) as HTMLSpanElement[]
  if (spanEls.length === 0) return []
  const containerRect = pageWrapper.getBoundingClientRect()

  for (const needle of needles) {
    const boxes = findSubstringMatch(spanEls, needle, containerRect, opts)
    if (boxes.length > 0) return boxes
  }

  return []
}

export const HIGHLIGHT_BLUE = "rgba(80, 160, 255, 0.45)"
export const SEARCH_COLORS = [
  "rgba(255, 80, 80, 0.4)",
  "rgba(80, 220, 120, 0.4)",
  "rgba(255, 170, 70, 0.4)",
  "rgba(180, 140, 255, 0.4)",
]
