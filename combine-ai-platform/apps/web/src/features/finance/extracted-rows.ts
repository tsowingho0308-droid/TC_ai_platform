export interface ExtractedRow {
  field: string
  value: string
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
