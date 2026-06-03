// ── Mock Extraction Templates ──────────────────────────────────
// Returns realistic sample data when LLM API key is not configured.
// Detection is based on file name keywords.

export interface MockReportResult {
  documentType: string
  title: string
  rows: Array<{ field: string; value: string }>
  metadata: {
    date: string | null
    referenceNumber: string | null
    totalAmount: number | null
    currency: string | null
    parties: string[]
    pageCount: number | null
  }
  confidence: number
  model: string
}

export interface MockTenderResult {
  tenderTitle: string
  tenderType: string
  fields: Array<{ field: string; value: string }>
  keyRequirements: string[]
  deadlines: Array<{ label: string; date: string | null }>
  confidence: number
  model: string
}

export interface MockTenderCompareResult {
  keyDifferences: string[]
  risksA: string[]
  risksB: string[]
  recommendation: { preferred: string; reason: string }
  model: string
}

// ── Detect document category from file name ────────────────────

type DocCategory = "invoice" | "receipt" | "report" | "contract" | "letter" | "tender" | "form" | "general"

function detectCategory(fileName?: string): DocCategory {
  if (!fileName) return "general"
  const name = fileName.toLowerCase()
  if (name.includes("invoice") || name.includes("發票") || name.includes("账单")) return "invoice"
  if (name.includes("receipt") || name.includes("收據") || name.includes("收据")) return "receipt"
  if (name.includes("report") || name.includes("報告") || name.includes("报告")) return "report"
  if (name.includes("contract") || name.includes("合約") || name.includes("合同") || name.includes("agreement")) return "contract"
  if (name.includes("letter") || name.includes("信") || name.includes("函")) return "letter"
  if (name.includes("tender") || name.includes("標書") || name.includes("标书") || name.includes("bid") || name.includes("投標")) return "tender"
  if (name.includes("form") || name.includes("表格") || name.includes("申請")) return "form"
  return "general"
}

// ── Report Mock Templates ──────────────────────────────────────

function mockInvoiceData(fileName?: string): MockReportResult {
  return {
    documentType: "invoice",
    title: fileName || "Commercial Invoice",
    rows: [
      { field: "Invoice Number", value: "INV-2026-05821" },
      { field: "Invoice Date", value: "2026-05-28" },
      { field: "Due Date", value: "2026-06-28" },
      { field: "Seller Name", value: "TechPro Solutions Ltd." },
      { field: "Seller Address", value: "15/F, Tower A, 88 Queen's Road Central, Hong Kong" },
      { field: "Seller Tax ID", value: "BR-12345678" },
      { field: "Buyer Name", value: "Pacific Enterprise Group" },
      { field: "Buyer Address", value: "Unit 1205, 12/F, Harbour View Centre, Wan Chai, Hong Kong" },
      { field: "PO Number", value: "PO-2026-00421" },
      { field: "Item 1 - Description", value: "Enterprise Software License (Annual) - 50 seats" },
      { field: "Item 1 - Quantity", value: "1" },
      { field: "Item 1 - Unit Price", value: "HKD 48,000.00" },
      { field: "Item 1 - Amount", value: "HKD 48,000.00" },
      { field: "Item 2 - Description", value: "Cloud Storage Add-on - 2TB" },
      { field: "Item 2 - Quantity", value: "1" },
      { field: "Item 2 - Unit Price", value: "HKD 12,500.00" },
      { field: "Item 2 - Amount", value: "HKD 12,500.00" },
      { field: "Subtotal", value: "HKD 60,500.00" },
      { field: "Discount (10%)", value: "HKD -6,050.00" },
      { field: "Tax (VAT 0%)", value: "HKD 0.00" },
      { field: "Total Amount", value: "HKD 54,450.00" },
      { field: "Payment Terms", value: "Net 30 Days" },
      { field: "Bank Name", value: "HSBC Hong Kong" },
      { field: "Bank Account", value: "123-456789-833" },
      { field: "SWIFT Code", value: "HSBCHKHH" },
      { field: "Notes", value: "Please include invoice number in payment reference" },
    ],
    metadata: {
      date: "2026-05-28",
      referenceNumber: "INV-2026-05821",
      totalAmount: 54450.0,
      currency: "HKD",
      parties: ["TechPro Solutions Ltd.", "Pacific Enterprise Group"],
      pageCount: 1,
    },
    confidence: 0.92,
    model: "mock-template",
  }
}

function mockReportData(fileName?: string): MockReportResult {
  return {
    documentType: "report",
    title: fileName || "Monthly Operations Report",
    rows: [
      { field: "Report Title", value: "Q1 2026 Operations Summary" },
      { field: "Report Date", value: "2026-04-05" },
      { field: "Department", value: "Operations" },
      { field: "Prepared By", value: "Chan Tai Man" },
      { field: "Reviewed By", value: "Lee Siu Ming" },
      { field: "Period Covered", value: "2026-01-01 to 2026-03-31" },
      { field: "Total Revenue (Q1)", value: "HKD 8,320,000" },
      { field: "Total Expenses (Q1)", value: "HKD 5,140,000" },
      { field: "Net Profit (Q1)", value: "HKD 3,180,000" },
      { field: "Headcount (End of Q1)", value: "142" },
      { field: "New Clients Acquired", value: "23" },
      { field: "Customer Satisfaction Score", value: "4.6 / 5.0" },
      { field: "Key Milestone 1", value: "Completed data center migration - March 15" },
      { field: "Key Milestone 2", value: "Launched mobile app v3.0 - February 28" },
      { field: "Risk 1", value: "⚠️ Supply chain delay risk for Q2 hardware orders" },
      { field: "Recommendation 1", value: "Diversify suppliers for critical components" },
      { field: "Next Review Date", value: "2026-04-15" },
    ],
    metadata: {
      date: "2026-04-05",
      referenceNumber: "RPT-Q1-2026-OP",
      totalAmount: 3180000.0,
      currency: "HKD",
      parties: ["Operations Department", "Chan Tai Man", "Lee Siu Ming"],
      pageCount: 3,
    },
    confidence: 0.88,
    model: "mock-template",
  }
}

function mockContractData(fileName?: string): MockReportResult {
  return {
    documentType: "contract",
    title: fileName || "Service Agreement",
    rows: [
      { field: "Contract Title", value: "IT Support Services Agreement" },
      { field: "Contract Reference", value: "CTR-2026-0312" },
      { field: "Effective Date", value: "2026-06-01" },
      { field: "Expiry Date", value: "2027-05-31" },
      { field: "Party A (Client)", value: "Pacific Enterprise Group" },
      { field: "Party A Address", value: "Unit 1205, Harbour View Centre, Wan Chai" },
      { field: "Party A Contact", value: "Wong Kar Ming, Procurement Director" },
      { field: "Party B (Vendor)", value: "Dynasty IT Solutions Ltd." },
      { field: "Party B Address", value: "22/F, Cyberport 2, 100 Cyberport Road" },
      { field: "Party B Contact", value: "Cheung Hiu Fung, Account Manager" },
      { field: "Service Scope", value: "24/7 IT helpdesk, server maintenance, network monitoring" },
      { field: "Monthly Fee", value: "HKD 35,000.00" },
      { field: "Annual Contract Value", value: "HKD 420,000.00" },
      { field: "Payment Schedule", value: "Monthly, within 15 days of invoice" },
      { field: "SLA - Response Time", value: "P1: 1 hour, P2: 4 hours, P3: 8 hours" },
      { field: "Termination Notice", value: "30 days written notice" },
      { field: "Governing Law", value: "Hong Kong SAR" },
      { field: "Signatory A", value: "Wong Kar Ming" },
      { field: "Signatory B", value: "Cheung Hiu Fung" },
      { field: "Signing Date", value: "2026-05-15" },
    ],
    metadata: {
      date: "2026-05-15",
      referenceNumber: "CTR-2026-0312",
      totalAmount: 420000.0,
      currency: "HKD",
      parties: ["Pacific Enterprise Group", "Dynasty IT Solutions Ltd."],
      pageCount: 5,
    },
    confidence: 0.9,
    model: "mock-template",
  }
}

function mockReceiptData(fileName?: string): MockReportResult {
  return {
    documentType: "receipt",
    title: fileName || "Payment Receipt",
    rows: [
      { field: "Receipt Number", value: "RCP-2026-10472" },
      { field: "Receipt Date", value: "2026-05-20" },
      { field: "Paid By", value: "Chan Siu Ling" },
      { field: "Received From", value: "Hong Kong Logistics Co." },
      { field: "Amount Paid", value: "HKD 12,800.00" },
      { field: "Payment Method", value: "Bank Transfer" },
      { field: "Description", value: "Warehouse storage fee - May 2026" },
      { field: "Transaction Reference", value: "TXN-FPS-8847291" },
      { field: "Issued By", value: "Finance Department" },
    ],
    metadata: {
      date: "2026-05-20",
      referenceNumber: "RCP-2026-10472",
      totalAmount: 12800.0,
      currency: "HKD",
      parties: ["Chan Siu Ling", "Hong Kong Logistics Co."],
      pageCount: 1,
    },
    confidence: 0.95,
    model: "mock-template",
  }
}

function mockGeneralData(fileName?: string): MockReportResult {
  return {
    documentType: "general",
    title: fileName || "Scanned Document",
    rows: [
      { field: "Document Title", value: fileName || "Scanned Document" },
      { field: "Document Date", value: "2026-05-15" },
      { field: "Reference Number", value: "DOC-2026-05001" },
      { field: "Author / Sender", value: "Corporate Services Department" },
      { field: "Recipient", value: "All Staff" },
      { field: "Subject", value: "Office Renovation Notice" },
      { field: "Summary", value: "Office renovation scheduled for June 2026. Floors 5-8 will be temporarily relocated." },
      { field: "Key Date 1", value: "2026-06-01 - Renovation begins" },
      { field: "Key Date 2", value: "2026-06-30 - Expected completion" },
      { field: "Contact Person", value: "Lam Ka Wai, Facilities Manager" },
      { field: "Contact Email", value: "kalam@company.com" },
      { field: "Notes", value: "Staff to collect temporary access cards from reception" },
    ],
    metadata: {
      date: "2026-05-15",
      referenceNumber: "DOC-2026-05001",
      totalAmount: null,
      currency: null,
      parties: ["Corporate Services Department", "All Staff"],
      pageCount: 2,
    },
    confidence: 0.85,
    model: "mock-template",
  }
}

// ── Tender Mock Templates ──────────────────────────────────────

function mockTenderExtraction(fileName?: string): MockTenderResult {
  const category = detectCategory(fileName)

  const templates: Record<string, MockTenderResult> = {
    tender: {
      tenderTitle: "Provision of IT Infrastructure Upgrade Services",
      tenderType: "government",
      fields: [
        { field: "Tender Reference", value: "ITT/2026/0045-IT" },
        { field: "Issuing Department", value: "Hong Kong Transport Department" },
        { field: "Tender Title", value: "Provision of IT Infrastructure Upgrade Services" },
        { field: "Project Description", value: "Upgrade and maintenance of network infrastructure for 15 district offices" },
        { field: "Procurement Method", value: "Open Tender" },
        { field: "Tender Issue Date", value: "2026-05-01" },
        { field: "Tender Closing Date", value: "2026-06-14 12:00 HKT" },
        { field: "Site Visit Date", value: "2026-05-12 10:00" },
        { field: "Clarification Deadline", value: "2026-05-25" },
        { field: "Contract Duration", value: "24 months with option for 12-month extension" },
        { field: "Estimated Budget", value: "HKD 15,000,000 - 18,000,000" },
        { field: "Bid Bond Required", value: "HKD 500,000 (1% of estimated value)" },
        { field: "Performance Bond", value: "10% of contract sum" },
        { field: "Evaluation Criteria - Price", value: "40%" },
        { field: "Evaluation Criteria - Technical", value: "40%" },
        { field: "Evaluation Criteria - Past Performance", value: "20%" },
        { field: "Minimum Qualification", value: "ISO 27001 certified, 5+ years in similar projects" },
        { field: "Submission Format", value: "Electronic via e-Tendering System + Hard Copy" },
        { field: "Contact Officer", value: "Wong Ka Ho - Senior Procurement Officer" },
        { field: "Contact Email", value: "khwong@td.gov.hk" },
        { field: "Language", value: "English (Traditional Chinese for supplementary docs)" },
      ],
      keyRequirements: [
        "Minimum 5 years of experience in government IT infrastructure projects",
        "ISO 27001 Information Security Management certification",
        "Must have completed at least 3 projects of similar scale (>HKD 10M) in past 5 years",
        "24/7 on-site support capability with 2-hour response time",
        "CISSP or equivalent certified project manager required",
      ],
      deadlines: [
        { label: "Tender Issue", date: "2026-05-01" },
        { label: "Site Visit", date: "2026-05-12" },
        { label: "Clarification Deadline", date: "2026-05-25" },
        { label: "Tender Closing", date: "2026-06-14" },
        { label: "Evaluation Period", date: "2026-06-15 to 2026-07-15" },
        { label: "Contract Award (Estimated)", date: "2026-08-01" },
      ],
      confidence: 0.91,
      model: "mock-template",
    },
    invoice: {
      tenderTitle: "Supply and Delivery of Medical Equipment",
      tenderType: "procurement",
      fields: [
        { field: "Tender Reference", value: "PROC/MED/2026/0128" },
        { field: "Issuing Department", value: "Hospital Authority" },
        { field: "Tender Title", value: "Supply and Delivery of Medical Equipment" },
        { field: "Tender Closing Date", value: "2026-07-10 12:00 HKT" },
        { field: "Estimated Budget", value: "HKD 25,000,000" },
        { field: "Contract Duration", value: "36 months" },
      ],
      keyRequirements: [
        "Medical device registration with HK Department of Health",
        "ISO 13485 medical device certification required",
      ],
      deadlines: [
        { label: "Tender Closing", date: "2026-07-10" },
      ],
      confidence: 0.87,
      model: "mock-template",
    },
  }

  return templates[category] || templates["tender"]!
}

// ── Tender Comparison Mock ─────────────────────────────────────

export function mockTenderCompare(tenderTitles: string[]): MockTenderCompareResult {
  const a = tenderTitles[0] || "Tender A"
  const b = tenderTitles[1] || "Tender B"

  return {
    keyDifferences: [
      `${a} offers lower total pricing (HKD 14.2M vs HKD 15.8M)`,
      `${b} proposes shorter delivery timeline (12 months vs 14 months)`,
      `${a} includes 3-year maintenance warranty (vs 2 years from ${b})`,
      `${b} has stronger past project references in government sector`,
      `${a} team has more certified professionals (12 vs 8)`,
    ],
    risksA: [
      "⚠️ Limited government project experience — may face compliance challenges",
      "⚠️ Proposed timeline (14 months) slightly exceeds target of 12 months",
    ],
    risksB: [
      "⚠️ Pricing 11% higher than alternative — budget impact",
      "⚠️ Warranty period shorter by 1 year — potential long-term costs",
      "⚠️ Smaller delivery team — capacity risk for large-scale deployment",
    ],
    recommendation: {
      preferred: a,
      reason: `${a} is recommended despite slightly longer timeline due to significantly lower total cost (HKD 1.6M savings), longer warranty (3y vs 2y), and larger certified team. Recommend requesting a revised timeline from ${a} before awarding.`,
    },
    model: "mock-template",
  }
}

// ── Main Entry Points ──────────────────────────────────────────

export function mockReportExtraction(fileName?: string): MockReportResult {
  const category = detectCategory(fileName)
  switch (category) {
    case "invoice":
      return mockInvoiceData(fileName)
    case "receipt":
      return mockReceiptData(fileName)
    case "report":
      return mockReportData(fileName)
    case "contract":
    case "tender":
      return mockContractData(fileName)
    case "letter":
      return mockContractData(fileName)
    default:
      return mockGeneralData(fileName)
  }
}

export function mockTenderResult(fileName?: string): MockTenderResult {
  return mockTenderExtraction(fileName)
}
