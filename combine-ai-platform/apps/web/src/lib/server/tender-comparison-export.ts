import ExcelJS from "exceljs"

export interface ComparisonFieldExport {
  field: string
  values: Array<{ tenderId: string; tenderTitle: string; value: string }>
  match: boolean
  isKey: boolean
}

export interface ComparisonResultExport {
  comparisonFields: ComparisonFieldExport[]
  tenders: Array<{ id: string; title: string }>
}

export interface TenderComparisonExportInput {
  comparisonResult: ComparisonResultExport
  showDiffsOnly?: boolean
  diffCount?: number
  matchCount?: number
}

const COLORS = {
  mutedBg: "FFF4F4F5",
  amberBg: "FFFFFBEB",
  greenBg: "FFF0FDF4",
  greenText: "FF166534",
  amberText: "FF92400E",
  border: "FFE4E4E7",
  white: "FFFFFFFF",
} as const

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
}

function filterForDisplay(fields: ComparisonFieldExport[], showDiffsOnly: boolean) {
  return showDiffsOnly ? fields.filter((f) => !f.match) : fields
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = THIN_BORDER
}

function applyHeaderStyle(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 11 }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mutedBg } }
  cell.alignment = { vertical: "middle", wrapText: true }
  applyBorder(cell)
}

function applySectionStyle(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 10, color: { argb: "FF71717A" } }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.mutedBg } }
  cell.alignment = { vertical: "middle", horizontal: "left" }
  applyBorder(cell)
}

function applyFieldCellStyle(cell: ExcelJS.Cell, isKey: boolean) {
  cell.font = { bold: isKey, size: 11 }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } }
  cell.alignment = { vertical: "top", wrapText: true }
  applyBorder(cell)
}

function applyValueCellStyle(cell: ExcelJS.Cell, isDiff: boolean) {
  cell.font = { size: 11, color: { argb: isDiff ? COLORS.amberText : "FF18181B" } }
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: isDiff ? COLORS.amberBg : COLORS.white },
  }
  cell.alignment = { vertical: "top", wrapText: true }
  applyBorder(cell)
}

function applyMatchCellStyle(cell: ExcelJS.Cell, match: boolean) {
  cell.value = match ? "Match" : "Diff"
  cell.font = { bold: true, size: 10, color: { argb: match ? COLORS.greenText : COLORS.amberText } }
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: match ? COLORS.greenBg : COLORS.amberBg },
  }
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  applyBorder(cell)
}

function addSectionRow(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  label: string,
  colCount: number
) {
  const row = sheet.getRow(rowIndex)
  const cell = row.getCell(1)
  cell.value = label.toUpperCase()
  applySectionStyle(cell)
  if (colCount > 1) {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount)
    for (let col = 2; col <= colCount; col++) {
      applySectionStyle(row.getCell(col))
    }
  }
  row.height = 22
  return rowIndex + 1
}

function addFieldRow(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  field: ComparisonFieldExport
) {
  const row = sheet.getRow(rowIndex)
  const fieldLabel = field.isKey ? `${field.field} (Key)` : field.field

  const fieldCell = row.getCell(1)
  fieldCell.value = fieldLabel
  applyFieldCellStyle(fieldCell, field.isKey)

  field.values.forEach((v, idx) => {
    const valueCell = row.getCell(idx + 2)
    valueCell.value = v.value
    applyValueCellStyle(valueCell, !field.match)
  })

  const matchCol = field.values.length + 2
  applyMatchCellStyle(row.getCell(matchCol), field.match)

  row.height = 28
  return rowIndex + 1
}

export async function buildTenderComparisonWorkbook(
  input: TenderComparisonExportInput
): Promise<ExcelJS.Workbook> {
  const { comparisonResult, showDiffsOnly = false } = input
  const { tenders } = comparisonResult
  const colCount = tenders.length + 2

  const keyFieldCount = comparisonResult.comparisonFields.filter((f) => f.isKey).length
  const keyFields = filterForDisplay(
    comparisonResult.comparisonFields.filter((f) => f.isKey),
    showDiffsOnly
  )
  const otherFields = filterForDisplay(
    comparisonResult.comparisonFields.filter((f) => !f.isKey),
    showDiffsOnly
  )

  const diffCount =
    input.diffCount ??
    comparisonResult.comparisonFields.filter((f) => !f.match).length
  const matchCount =
    input.matchCount ??
    comparisonResult.comparisonFields.length - diffCount

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Combine AI Platform"
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Comparison", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
  })

  sheet.getColumn(1).width = 28
  for (let i = 0; i < tenders.length; i++) {
    sheet.getColumn(i + 2).width = 36
  }
  sheet.getColumn(tenders.length + 2).width = 12

  let rowIndex = 1

  const overviewRow = sheet.getRow(rowIndex)
  overviewRow.getCell(1).value = "Tender Comparison"
  overviewRow.getCell(1).font = { bold: true, size: 14 }
  if (colCount > 1) {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount)
  }
  overviewRow.height = 24
  rowIndex++

  const statsRow = sheet.getRow(rowIndex)
  statsRow.getCell(1).value =
    `Tenders: ${tenders.length}  |  Differences: ${diffCount}  |  Matches: ${matchCount}  |  Key fields: ${keyFieldCount}`
  statsRow.getCell(1).font = { size: 10, color: { argb: "FF71717A" } }
  if (colCount > 1) {
    sheet.mergeCells(rowIndex, 1, rowIndex, colCount)
  }
  statsRow.height = 18
  rowIndex++

  const headerRow = sheet.getRow(rowIndex)
  headerRow.getCell(1).value = "Field"
  applyHeaderStyle(headerRow.getCell(1))
  headerRow.getCell(1).alignment = { vertical: "middle", horizontal: "left", wrapText: true }

  tenders.forEach((tender, idx) => {
    const cell = headerRow.getCell(idx + 2)
    cell.value = tender.title
    applyHeaderStyle(cell)
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
  })

  const matchHeaderCell = headerRow.getCell(tenders.length + 2)
  matchHeaderCell.value = "Match"
  applyHeaderStyle(matchHeaderCell)
  matchHeaderCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }

  headerRow.height = 32
  rowIndex++

  if (keyFields.length > 0) {
    rowIndex = addSectionRow(sheet, rowIndex, "Key Information", colCount)
    for (const field of keyFields) {
      rowIndex = addFieldRow(sheet, rowIndex, field)
    }
  }

  if (otherFields.length > 0) {
    rowIndex = addSectionRow(sheet, rowIndex, "Other Fields", colCount)
    for (const field of otherFields) {
      rowIndex = addFieldRow(sheet, rowIndex, field)
    }
  }

  if (keyFields.length === 0 && otherFields.length === 0) {
    const emptyRow = sheet.getRow(rowIndex)
    emptyRow.getCell(1).value = showDiffsOnly
      ? "All compared fields match across tenders."
      : "No comparison fields to export."
    emptyRow.getCell(1).font = { italic: true, color: { argb: "FF71717A" } }
    if (colCount > 1) {
      sheet.mergeCells(rowIndex, 1, rowIndex, colCount)
    }
  }

  return workbook
}

export async function buildTenderComparisonXlsxBuffer(
  input: TenderComparisonExportInput
): Promise<Buffer> {
  const workbook = await buildTenderComparisonWorkbook(input)
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
