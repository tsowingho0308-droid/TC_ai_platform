import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildValueOnlyNeedles,
  findValueMatch,
  readTextLayerSpans,
} from "./report-text-layer-highlights.ts"

function mockSpan(text: string, left: number): HTMLSpanElement {
  const width = Math.max(text.length * 8, 4)
  return {
    textContent: text,
    getBoundingClientRect: () => ({
      left,
      top: 0,
      width,
      height: 14,
      right: left + width,
      bottom: 14,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }),
  } as HTMLSpanElement
}

function mockPageWrapper(spans: HTMLSpanElement[]): HTMLElement {
  const textLayer = {
    querySelectorAll: () => spans,
  }
  return {
    querySelector: (sel: string) =>
      sel.includes("textContent") ? (textLayer as unknown as Element) : null,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 600,
      height: 800,
      right: 600,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  } as HTMLElement
}

describe("buildValueOnlyNeedles", () => {
  it("generates HK$ variants for currency values", () => {
    const needles = buildValueOnlyNeedles("$150,000 HKD")
    assert.ok(needles.some((n) => n.includes("150,000")))
    assert.ok(needles.some((n) => n.includes("HK$")))
  })
})

describe("findValueMatch", () => {
  it("matches currency split across spans (HK$ + amount)", () => {
    const spans = [mockSpan("HK$", 10), mockSpan("150,000", 50)]
    const wrapper = mockPageWrapper(spans)
    const boxes = findValueMatch(wrapper, "$150,000 HKD", {
      allowAmbiguous: true,
      spanEls: spans,
    })
    assert.ok(boxes.length > 0)
  })

  it("matches value embedded in a long bullet line", () => {
    const line =
      "• The estimated contract value is HK$150,000 for the initial term."
    const spans = [mockSpan(line, 0)]
    const wrapper = mockPageWrapper(spans)
    const boxes = findValueMatch(wrapper, "HK$150,000", {
      allowAmbiguous: true,
      spanEls: spans,
    })
    assert.ok(boxes.length > 0)
  })

  it("returns empty when text layer has no spans", () => {
    const wrapper = mockPageWrapper([])
    const boxes = findValueMatch(wrapper, "test value", { spanEls: [] })
    assert.equal(boxes.length, 0)
  })

  it("readTextLayerSpans reads spans from mock wrapper", () => {
    const spans = [mockSpan("hello", 0)]
    const wrapper = mockPageWrapper(spans)
    assert.equal(readTextLayerSpans(wrapper).length, 1)
  })

  it("matches via full-page span scan using value-only needle variants", () => {
    const padding = "z".repeat(140)
    const spans = [mockSpan(`${padding} prefix `, 0), mockSpan("net thirty days", 400)]
    const wrapper = mockPageWrapper(spans)
    const boxes = findValueMatch(wrapper, `preamble; net thirty days`, {
      allowAmbiguous: true,
      spanEls: spans,
    })
    assert.ok(boxes.length > 0)
  })
})
