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

export const HIGHLIGHT_BLUE = "rgba(80, 160, 255, 0.45)"
export const SEARCH_COLORS = [
  "rgba(255, 80, 80, 0.4)",
  "rgba(80, 220, 120, 0.4)",
  "rgba(255, 170, 70, 0.4)",
  "rgba(180, 140, 255, 0.4)",
]
