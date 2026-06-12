export interface TenderFieldSection {
  id: string
  label: string
  patterns: RegExp[]
  defaultFieldLabel: string
}

export const TENDER_FIELD_SECTIONS: TenderFieldSection[] = [
  {
    id: "scope",
    label: "服務範圍 / Scope",
    patterns: [/scope|services included|deliverables|服務|範圍/i],
    defaultFieldLabel: "Services Included",
  },
  {
    id: "exclusions",
    label: "排除項目 / Exclusions",
    patterns: [/excluded|exclusion|排除|不包括/i],
    defaultFieldLabel: "Services Excluded",
  },
  {
    id: "budget",
    label: "預算金額 / Budget",
    patterns: [/budget|value|amount|預算|金額|payment terms/i],
    defaultFieldLabel: "Estimated Budget",
  },
  {
    id: "deadlines",
    label: "期限 / Deadlines",
    patterns: [/deadline|submission|截標|截止|closing|validity/i],
    defaultFieldLabel: "Submission Deadline",
  },
  {
    id: "other",
    label: "Other Fields",
    patterns: [],
    defaultFieldLabel: "",
  },
]

export function getFieldSectionId(fieldName: string): string {
  const normalized = fieldName.trim()
  for (const section of TENDER_FIELD_SECTIONS) {
    if (section.id === "other") continue
    if (section.patterns.some((p) => p.test(normalized))) return section.id
  }
  return "other"
}

export function getSectionById(sectionId: string): TenderFieldSection {
  return TENDER_FIELD_SECTIONS.find((s) => s.id === sectionId) ?? TENDER_FIELD_SECTIONS[TENDER_FIELD_SECTIONS.length - 1]
}

export interface IndexedField {
  field: string
  value: string
  index: number
}

export function groupFieldsBySection(fields: Array<{ field: string; value: string }>): Map<string, IndexedField[]> {
  const grouped = new Map<string, IndexedField[]>()
  for (const section of TENDER_FIELD_SECTIONS) {
    grouped.set(section.id, [])
  }

  fields.forEach((field, index) => {
    const sectionId = getFieldSectionId(field.field)
    grouped.get(sectionId)!.push({ ...field, index })
  })

  return grouped
}
