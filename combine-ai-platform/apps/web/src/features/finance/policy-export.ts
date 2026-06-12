export interface PolicyResult {
  rule: string
  passed: boolean
  detail: string
}

export interface ExpenseExportSubmitterInfo {
  fullName: string
  email: string
  personInChargeName: string
  personInChargeEmail: string
  additionalNotes?: string
}

export function getPolicyExportBlockers(results: PolicyResult[] | null | undefined): string[] {
  if (!results || results.length === 0) {
    return ["Please run Check Policy before exporting."]
  }

  const failed = results.filter((policy) => !policy.passed)
  if (failed.length === 0) return []

  return failed.map((policy) => `${policy.rule}: ${policy.detail}`)
}

export function validateSubmitterInfo(info: Partial<ExpenseExportSubmitterInfo>): string[] {
  const errors: string[] = []
  if (!info.fullName?.trim()) errors.push("Full name is required.")
  if (!info.email?.trim()) errors.push("Email is required.")
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email.trim())) {
    errors.push("Please enter a valid email address.")
  }
  if (!info.personInChargeName?.trim()) errors.push("Person in charge name is required.")
  if (!info.personInChargeEmail?.trim()) errors.push("Person in charge email is required.")
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.personInChargeEmail.trim())) {
    errors.push("Please enter a valid person in charge email address.")
  }
  return errors
}
