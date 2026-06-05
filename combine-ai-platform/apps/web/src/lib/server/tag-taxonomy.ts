// Tag Taxonomy — predefined tags with descriptions for AI auto-classification.
// Custom tags can be added by users in the Knowledge Base Management UI.

export interface TagDefinition {
  tag: string
  description: string
  category: string
}

export const PREDEFINED_TAGS: TagDefinition[] = [
  // ── HR ──────────────────────────────────────────────
  { tag: "leave", description: "Leave policies, annual leave, sick leave, maternity leave", category: "HR" },
  { tag: "onboarding", description: "New employee onboarding, orientation, first-day procedures", category: "HR" },
  { tag: "offboarding", description: "Resignation, termination, exit interviews, handover", category: "HR" },
  { tag: "benefits", description: "Employee benefits, medical insurance, MPF, allowances", category: "HR" },
  { tag: "performance", description: "Performance reviews, appraisals, KPI, disciplinary actions", category: "HR" },
  { tag: "training", description: "Training programs, course reimbursement, certifications", category: "HR" },
  { tag: "recruitment", description: "Job postings, interviews, hiring process, headcount approval", category: "HR" },

  // ── IT ──────────────────────────────────────────────
  { tag: "equipment", description: "IT equipment requests, hardware, laptop, monitor, peripherals", category: "IT" },
  { tag: "software", description: "Software installation, licenses, SaaS subscriptions, approvals", category: "IT" },
  { tag: "vpn", description: "VPN setup, remote access, network connectivity", category: "IT" },
  { tag: "security", description: "Cybersecurity, phishing, password policies, access control, data protection", category: "IT" },
  { tag: "email-systems", description: "Email setup, distribution lists, shared mailboxes, email policies", category: "IT" },
  { tag: "it-support", description: "Help desk tickets, technical issues, troubleshooting, service requests", category: "IT" },

  // ── Admin & Facilities ──────────────────────────────
  { tag: "access-card", description: "Access cards, badges, security clearance, door access", category: "ADMIN" },
  { tag: "facilities", description: "Office facilities, meeting rooms, parking, canteen, maintenance", category: "ADMIN" },
  { tag: "travel", description: "Business travel booking, travel policy, flight and hotel arrangements", category: "ADMIN" },
  { tag: "visitor", description: "Visitor registration, guest passes, visitor policies", category: "ADMIN" },
  { tag: "office-supplies", description: "Office supplies, stationery, equipment procurement", category: "ADMIN" },

  // ── Finance ─────────────────────────────────────────
  { tag: "expense", description: "Expense claims, reimbursement, receipt submission, travel expenses", category: "FINANCE" },
  { tag: "procurement", description: "Procurement process, purchase orders, vendor management, approval levels", category: "FINANCE" },
  { tag: "budget", description: "Budget planning, budget approval, departmental budgets, cost centers", category: "FINANCE" },
  { tag: "invoice", description: "Invoicing, payment processing, three-way matching, accounts payable", category: "FINANCE" },
  { tag: "tax", description: "Tax compliance, VAT, corporate tax, tax filings", category: "FINANCE" },

  // ── Document Categories (cross-cutting) ─────────────
  { tag: "tender", description: "Tender documents, RFP, RFQ, bidding, procurement solicitations", category: "DOC_TYPE" },
  { tag: "report", description: "Reports, analysis, summaries, meeting minutes, audit findings", category: "DOC_TYPE" },
  { tag: "contract", description: "Contracts, agreements, MOUs, NDAs, legal documents", category: "DOC_TYPE" },
  { tag: "invoice-doc", description: "Invoices, receipts, payment records, billing documents", category: "DOC_TYPE" },
  { tag: "policy-doc", description: "Company policies, procedures, guidelines, regulations, handbooks", category: "DOC_TYPE" },
  { tag: "form", description: "Forms, templates, applications, checklists", category: "DOC_TYPE" },
  { tag: "manual", description: "User manuals, technical guides, SOPs, setup instructions", category: "DOC_TYPE" },
  { tag: "email-thread", description: "Email conversations, email archives, correspondence", category: "DOC_TYPE" },

  // ── Cross-Department ─────────────────────────────────
  { tag: "cross-dept", description: "Document involves multiple departments and requires cross-functional review", category: "CROSS" },
  { tag: "procurement-review", description: "Requires procurement team review, vendor evaluation, bid comparison", category: "CROSS" },
  { tag: "budget-approval", description: "Requires budget approval, financial sign-off, cost analysis", category: "CROSS" },
  { tag: "legal-review", description: "Requires legal team review, compliance check, regulatory assessment", category: "CROSS" },
  { tag: "technical-eval", description: "Requires technical evaluation, engineering assessment, feasibility study", category: "CROSS" },

  // ── General ─────────────────────────────────────────
  { tag: "handbook", description: "Company handbook, general policies, code of conduct, working hours, dress code", category: "GENERAL" },
  { tag: "holiday", description: "Public holidays, holiday schedule, office closures", category: "GENERAL" },
  { tag: "remote-work", description: "Remote work policies, work-from-home, hybrid arrangements, flexible hours", category: "GENERAL" },
  { tag: "compliance", description: "Regulatory compliance, data privacy (PDPO), audit requirements, certifications", category: "GENERAL" },
  { tag: "emergency", description: "Emergency procedures, fire safety, first aid, business continuity, crisis management", category: "GENERAL" },
]

// Map tag → description for quick lookup
export const TAG_DESCRIPTIONS: Record<string, string> = {}
for (const t of PREDEFINED_TAGS) {
  TAG_DESCRIPTIONS[t.tag] = t.description
}

// All unique tags as a flat array
export const ALL_PREDEFINED_TAGS = PREDEFINED_TAGS.map((t) => t.tag)

// Tags grouped by category for UI display
export const TAGS_BY_CATEGORY: Record<string, TagDefinition[]> = {}
for (const t of PREDEFINED_TAGS) {
  if (!TAGS_BY_CATEGORY[t.category]) TAGS_BY_CATEGORY[t.category] = []
  TAGS_BY_CATEGORY[t.category].push(t)
}

/**
 * Build a taxonomy description for the AI prompt.
 */
export function buildTaxonomyPrompt(): string {
  const lines: string[] = ["Available tags and their meanings:"]
  for (const cat of Object.keys(TAGS_BY_CATEGORY)) {
    lines.push(`\n## ${cat}`)
    for (const t of TAGS_BY_CATEGORY[cat]) {
      lines.push(`- **${t.tag}**: ${t.description}`)
    }
  }
  return lines.join("\n")
}
