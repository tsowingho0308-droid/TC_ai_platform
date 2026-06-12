export interface ExtractedRow {
  field: string
  value: string
}

export interface ParsedExtractedRow extends ExtractedRow {
  originalIndex: number
  source: string | null
  receiptLabel: string | null
  displayField: string
}

export interface ExtractedRowGroup {
  id: string
  source: string | null
  receiptLabel: string | null
  title: string
  subtitle: string | null
  rows: ParsedExtractedRow[]
}

const RECEIPT_NUMBERED_PREFIX = /^Receipt (\d+) - (.+)$/i
const RECEIPT_SINGLE_PREFIX = /^Receipt - (.+)$/i

export function parseExtractedRowField(field: string): {
  source: string | null
  receiptLabel: string | null
  displayField: string
} {
  let source: string | null = null
  let remainder = field

  const separator = " · "
  const separatorIndex = field.indexOf(separator)
  if (separatorIndex >= 0) {
    source = field.slice(0, separatorIndex).trim()
    remainder = field.slice(separatorIndex + separator.length).trim()
  }

  const numberedMatch = remainder.match(RECEIPT_NUMBERED_PREFIX)
  if (numberedMatch) {
    return {
      source,
      receiptLabel: `Receipt ${numberedMatch[1]}`,
      displayField: numberedMatch[2].trim(),
    }
  }

  const singleMatch = remainder.match(RECEIPT_SINGLE_PREFIX)
  if (singleMatch) {
    return {
      source,
      receiptLabel: "Receipt",
      displayField: singleMatch[1].trim(),
    }
  }

  return {
    source,
    receiptLabel: null,
    displayField: remainder,
  }
}

function receiptSortValue(receiptLabel: string | null) {
  const match = receiptLabel?.match(/(\d+)/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

export function groupExtractedRows(rows: ExtractedRow[]): ExtractedRowGroup[] {
  const groups = new Map<string, ExtractedRowGroup>()

  rows.forEach((row, originalIndex) => {
    const parsed = parseExtractedRowField(row.field)
    const groupKey = `${parsed.source || "default"}|${parsed.receiptLabel || "default"}`

    if (!groups.has(groupKey)) {
      const title = parsed.receiptLabel || "Extracted Details"
      groups.set(groupKey, {
        id: groupKey,
        source: parsed.source,
        receiptLabel: parsed.receiptLabel,
        title,
        subtitle: null,
        rows: [],
      })
    }

    groups.get(groupKey)!.rows.push({
      ...row,
      originalIndex,
      source: parsed.source,
      receiptLabel: parsed.receiptLabel,
      displayField: parsed.displayField,
    })
  })

  return [...groups.values()].sort((a, b) => {
    const receiptDiff = receiptSortValue(a.receiptLabel) - receiptSortValue(b.receiptLabel)
    if (receiptDiff !== 0) return receiptDiff
    return a.title.localeCompare(b.title)
  })
}

export function getMaxReceiptNumber(rows: ExtractedRow[]): number {
  let max = 0
  for (const row of rows) {
    const { receiptLabel } = parseExtractedRowField(row.field)
    const match = receiptLabel?.match(/(\d+)/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  if (max > 0) return max

  const legacyGroups = new Set(
    rows.map((row) => {
      const parsed = parseExtractedRowField(row.field)
      return `${parsed.source || "default"}|${parsed.receiptLabel || "default"}`
    })
  )
  return legacyGroups.size
}

export function offsetReceiptRowNumbers(rows: ExtractedRow[], offset: number): ExtractedRow[] {
  if (offset <= 0) return rows

  return rows.map((row) => {
    const separator = " · "
    const separatorIndex = row.field.indexOf(separator)
    const prefix = separatorIndex >= 0 ? row.field.slice(0, separatorIndex + separator.length) : ""
    let remainder = separatorIndex >= 0 ? row.field.slice(separatorIndex + separator.length) : row.field

    remainder = remainder.replace(/^Receipt (\d+) - /i, (_, receiptNumber) => {
      return `Receipt ${Number(receiptNumber) + offset} - `
    })

    if (/^Receipt - /i.test(remainder)) {
      remainder = remainder.replace(/^Receipt - /i, `Receipt ${offset + 1} - `)
    }

    return {
      field: `${prefix}${remainder}`,
      value: row.value,
    }
  })
}

export function collectReceiptLabels(rows: ExtractedRow[]): string[] {
  const labels = new Set<string>()
  for (const row of rows) {
    const { receiptLabel } = parseExtractedRowField(row.field)
    if (receiptLabel) labels.add(receiptLabel)
  }

  return [...labels].sort((a, b) => receiptSortValue(a) - receiptSortValue(b))
}

export function formatReceiptLabelsDisplay(labels: string[]): string {
  if (labels.length === 0) return "Receipt"
  if (labels.length === 1) return labels[0]

  const numbers = labels
    .map((label) => label.match(/(\d+)/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)

  if (numbers.length === labels.length && numbers.length > 1) {
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    if (max - min + 1 === numbers.length) {
      return min === max ? `Receipt ${min}` : `Receipt ${min}–${max}`
    }
  }

  return labels.join(", ")
}

export function getFinanceDocumentDisplayName(
  doc: { fileName: string; extractedData?: unknown }
): string {
  const extractedData = doc.extractedData as {
    displayName?: string
    receiptLabels?: string[]
  } | null

  if (extractedData?.displayName) return extractedData.displayName
  if (extractedData?.receiptLabels?.length) {
    return formatReceiptLabelsDisplay(extractedData.receiptLabels)
  }

  return doc.fileName
}

export function assignReceiptNumbers(rows: ExtractedRow[], startNumber: number): ExtractedRow[] {
  if (rows.length === 0) return rows

  const start = Math.max(1, startNumber)
  const maxInBatch = getMaxReceiptNumber(rows)

  if (maxInBatch > 0) {
    return offsetReceiptRowNumbers(rows, start - 1)
  }

  const hasSingleReceiptPrefix = rows.some((row) => parseExtractedRowField(row.field).receiptLabel === "Receipt")
  if (hasSingleReceiptPrefix) {
    return offsetReceiptRowNumbers(rows, start - 1)
  }

  return rows.map((row) => ({
    field: `Receipt ${start} - ${parseExtractedRowField(row.field).displayField}`,
    value: row.value,
  }))
}

export function normalizeExtractedRows(value: unknown): ExtractedRow[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value
      .filter(
        (row): row is ExtractedRow =>
          row !== null &&
          typeof row === "object" &&
          typeof (row as ExtractedRow).field === "string" &&
          typeof (row as ExtractedRow).value === "string"
      )
      .map((row) => ({
        field: row.field,
        value: row.value,
      }))
  }

  if (typeof value === "object" && value !== null && "rows" in value) {
    return normalizeExtractedRows((value as { rows: unknown }).rows)
  }

  return []
}
