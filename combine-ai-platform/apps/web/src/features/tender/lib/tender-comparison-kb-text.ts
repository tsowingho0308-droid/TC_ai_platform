import type {
  AiCompareResult,
  ComparisonField,
  ComparisonResult,
} from "@/features/tender/components/tender-comparison-panel"

export function formatPreferredTender(
  preferred: string | undefined,
  tenderNames: string[]
): string {
  if (!preferred?.trim()) return "—"
  const normalized = preferred.trim()
  const lower = normalized.toLowerCase()
  if (lower === "a") return tenderNames[0] || normalized
  if (lower === "b") return tenderNames[1] || normalized
  if (lower === "neither") return "Neither"
  return normalized
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function buildFieldTable(
  fields: ComparisonField[],
  tenders: ComparisonResult["tenders"]
): string[] {
  if (fields.length === 0) return ["（無欄位）", ""]

  const headers = ["Field", ...tenders.map((t) => t.title), "Match"]
  const separator = headers.map(() => "---")
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
  ]

  for (const field of fields) {
    const fieldLabel = field.isKey ? `${field.field} (Key)` : field.field
    const values = field.values.map((v) => escapeMdCell(v.value || "—"))
    const matchLabel = field.match ? "Match" : "Diff"
    lines.push(`| ${escapeMdCell(fieldLabel)} | ${values.join(" | ")} | ${matchLabel} |`)
  }

  lines.push("")
  return lines
}

export interface BuildComparisonKbTextInput {
  comparisonResult: ComparisonResult
  tenderNames: string[]
  diffCount: number
  matchCount: number
  showDiffsOnly?: boolean
  aiCompareResult?: AiCompareResult | null
}

export function buildComparisonKbText(input: BuildComparisonKbTextInput): string {
  const {
    comparisonResult,
    tenderNames,
    diffCount,
    matchCount,
    showDiffsOnly = false,
    aiCompareResult,
  } = input

  const keyFieldCount = comparisonResult.comparisonFields.filter((f) => f.isKey).length
  const filterFields = (fields: ComparisonField[]) =>
    showDiffsOnly ? fields.filter((f) => !f.match) : fields

  const keyFields = filterFields(
    comparisonResult.comparisonFields.filter((f) => f.isKey)
  )
  const otherFields = filterFields(
    comparisonResult.comparisonFields.filter((f) => !f.isKey)
  )

  const lines: string[] = [
    "# Tender Comparison",
    "",
    "## Overview",
    "",
    `- Tenders compared: ${comparisonResult.tenders.length}`,
    `- Differences: ${diffCount}`,
    `- Matches: ${matchCount}`,
    `- Key fields: ${keyFieldCount}`,
    "",
    "### Documents",
    "",
    ...comparisonResult.tenders.map(
      (t, i) => `- ${i + 1}. ${tenderNames[i] || t.title}`
    ),
    "",
    "## Comparison Table",
    "",
  ]

  if (keyFields.length > 0) {
    lines.push("### Key Information", "")
    lines.push(...buildFieldTable(keyFields, comparisonResult.tenders))
  }

  if (otherFields.length > 0) {
    lines.push("### Other Fields", "")
    lines.push(...buildFieldTable(otherFields, comparisonResult.tenders))
  }

  if (keyFields.length === 0 && otherFields.length === 0) {
    lines.push(
      showDiffsOnly
        ? "All compared fields match across tenders."
        : "No comparison fields to export.",
      ""
    )
  }

  if (aiCompareResult) {
    lines.push("## AI Comparison Summary", "")

    if (aiCompareResult.recommendation) {
      lines.push("### Recommendation", "")
      lines.push(
        `**Preferred:** ${formatPreferredTender(aiCompareResult.recommendation.preferred, tenderNames)}`
      )
      if (aiCompareResult.recommendation.reason) {
        lines.push("", aiCompareResult.recommendation.reason)
      }
      lines.push("")
    }

    if (aiCompareResult.keyDifferences?.length) {
      lines.push("### Key Differences", "")
      for (const diff of aiCompareResult.keyDifferences) {
        lines.push(`- ${diff}`)
      }
      lines.push("")
    }

    if (aiCompareResult.risksA?.length) {
      lines.push(`### ${tenderNames[0] || "Tender A"} — Risks`, "")
      for (const risk of aiCompareResult.risksA) {
        lines.push(`- ${risk}`)
      }
      lines.push("")
    }

    if (aiCompareResult.risksB?.length) {
      lines.push(`### ${tenderNames[1] || "Tender B"} — Risks`, "")
      for (const risk of aiCompareResult.risksB) {
        lines.push(`- ${risk}`)
      }
      lines.push("")
    }
  }

  return lines.join("\n").trim()
}

export function defaultComparisonKbTitle(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `Tender Comparison — ${date}`
}
