import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("Seeding database...")

  // Create demo account
  const account = await prisma.account.upsert({
    where: { id: "demo-account" },
    update: {},
    create: {
      id: "demo-account",
      name: "Demo Account",
    },
  })

  // Create demo workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: "demo-workspace" },
    update: {},
    create: {
      id: "demo-workspace",
      accountId: account.id,
      name: "Demo Workspace",
    },
  })

  // Create demo user
  const user = await prisma.user.upsert({
    where: { email: "admin@combine.ai" },
    update: {},
    create: {
      id: "demo-user-1",
      accountId: account.id,
      workspaceId: workspace.id,
      email: "admin@combine.ai",
      name: "Admin User",
      role: "ADMIN",
    },
  })

  // Create default inboxes
  const primaryInbox = await prisma.inbox.upsert({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: "primary" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "Primary Inbox",
      slug: "primary",
      kind: "PRIMARY",
      aiTriageEnabled: true,
      defaultAssigneeId: user.id,
    },
  })

  for (const dept of [
    { name: "IT Support", slug: "it-support" },
    { name: "Human Resources", slug: "hr" },
    { name: "Commercial", slug: "commercial" },
  ]) {
    const deptInbox = await prisma.inbox.upsert({
      where: { workspaceId_slug: { workspaceId: workspace.id, slug: dept.slug } },
      update: {},
      create: {
        workspaceId: workspace.id,
        name: dept.name,
        slug: dept.slug,
        kind: "DEPARTMENT",
        defaultAssigneeId: user.id,
      },
    })

    await prisma.inboxMembership.upsert({
      where: { userId_inboxId: { userId: user.id, inboxId: deptInbox.id } },
      update: {},
      create: {
        workspaceId: workspace.id,
        userId: user.id,
        inboxId: deptInbox.id,
      },
    })
  }

  // Seed Agent registry
  const agents = [
    { slug: "email", name: "Email Agent", nameZh: "電郵代理", description: "Intelligent email triage, work classification, and auto-reply management", descriptionZh: "智能郵件分類、工作類型識別及自動回覆管理", icon: "Mail", sortOrder: 1 },
    { slug: "report", name: "Report Agent", nameZh: "報告代理", description: "AI-powered document processing, key point extraction, and multi-format export", descriptionZh: "AI驅動文件處理、重點提取及多格式匯出", icon: "FileSpreadsheet", sortOrder: 2 },
    { slug: "tender", name: "Tender Agent", nameZh: "標書代理", description: "Bidding document analysis, service comparison, and competitive intelligence", descriptionZh: "標書分析、服務對比及競爭情報", icon: "FileText", sortOrder: 3 },
    { slug: "finance", name: "Finance Agent", nameZh: "財務代理", description: "Receipt/invoice OCR extraction, expense policy compliance, and 3-way PO/GRN/Invoice matching", descriptionZh: "收據發票AI提取、報銷政策合規檢查、三單匹配對帳", icon: "Receipt", sortOrder: 4 },
    { slug: "helpdesk", name: "Helpdesk Agent", nameZh: "知識問答代理", description: "Internal knowledge base Q&A, policy lookup, and intelligent ticket escalation", descriptionZh: "內部知識庫問答、政策查詢、智能工單升級", icon: "MessageCircleQuestion", sortOrder: 5 },
    { slug: "workflow", name: "Workflow Agent", nameZh: "流程管理代理", description: "Cross-department workflow automation with onboarding, offboarding, and approval orchestration", descriptionZh: "跨部門流程自動化、入職離職管理、審批流程編排", icon: "GitBranch", sortOrder: 6 },
  ]

  for (const agent of agents) {
    await prisma.agent.upsert({
      where: { slug: agent.slug },
      update: agent,
      create: agent,
    })
  }

  // Seed sample tender templates
  const templates = [
    {
      id: "template-it-tender",
      workspaceId: workspace.id,
      locale: "zh_hk",
      title: "IT Services Tender Analysis",
      scenario: "tender-analysis",
      description: "Standard IT services tender with sections for services, budget, and requirements",
      docxFile: "templates/it-tender-template.docx",
      docxFields: ["tender_name", "client_org", "services_included", "services_excluded", "budget", "deadline", "contract_duration", "key_requirements"],
    },
    {
      id: "template-consulting-tender",
      workspaceId: workspace.id,
      locale: "zh_hk",
      title: "Consulting Services Tender Analysis",
      scenario: "tender-analysis",
      description: "Consulting services tender with scope, deliverables, and timeline sections",
      docxFile: "templates/consulting-tender-template.docx",
      docxFields: ["project_name", "scope_of_work", "deliverables", "timeline", "budget", "team_requirements"],
    },
  ]

  for (const template of templates) {
    await prisma.tenderTemplate.upsert({
      where: { id: template.id },
      update: template,
      create: template,
    })
  }

  // Seed knowledge bases
  const kbs = [
    { slug: "hr-policies", name: "HR Policies", department: "HR" as const, description: "Human resources policies, leave, benefits, and code of conduct" },
    { slug: "it-support", name: "IT Support", department: "IT" as const, description: "IT equipment, software, accounts, and security policies" },
    { slug: "admin-facilities", name: "Admin & Facilities", department: "ADMIN" as const, description: "Office facilities, access cards, stationery, and travel" },
    { slug: "finance-procurement", name: "Finance & Procurement", department: "FINANCE" as const, description: "Expense claims, procurement process, and budget policies" },
    { slug: "general-faq", name: "General FAQ", department: "GENERAL" as const, description: "Company-wide general information and FAQs" },
  ]

  for (const kb of kbs) {
    const created = await prisma.knowledgeBase.upsert({
      where: { workspaceId_slug: { workspaceId: workspace.id, slug: kb.slug } },
      update: kb,
      create: { ...kb, workspaceId: workspace.id },
    })

    // Seed sample articles for each KB
    const sampleArticles: Record<string, Array<{ title: string; content: string; tags: string[] }>> = {
      "hr-policies": [
        { title: "Annual Leave Policy", content: "Employees are entitled to 14 days of paid annual leave per year. Leave accrues monthly at 1.17 days per month. Unused leave can be carried forward up to 5 days to the next calendar year. Leave requests must be submitted at least 5 working days in advance via the HR system.", tags: ["leave", "annual", "holiday"] },
        { title: "Sick Leave Policy", content: "Employees are entitled to 12 days of paid sick leave per year. A medical certificate is required for sick leave of 2 days or more. Sick leave pay is calculated at 80% of the employee's average daily wage.", tags: ["sick", "medical", "leave"] },
      ],
      "it-support": [
        { title: "How to Request IT Equipment", content: "Submit an IT request ticket via the helpdesk portal. Standard equipment includes: laptop (Dell XPS or MacBook Pro), monitor (27\" 4K), keyboard, mouse, and headset. New equipment requests require manager approval for items over HK$5,000. Expected delivery time is 5-7 working days after approval.", tags: ["equipment", "hardware", "request"] },
        { title: "VPN Setup Guide", content: "Download the company VPN client from the intranet. Install and log in with your company email and the one-time code from the authenticator app. The VPN server address is vpn.company.com. For issues, contact IT support at ext. 888.", tags: ["vpn", "remote", "setup"] },
      ],
      "admin-facilities": [
        { title: "Access Card Application", content: "New access cards are issued by the Admin department. Submit the Access Card Request Form with a passport photo and your employee ID. Processing time is 2 working days. Lost cards must be reported immediately; replacement fee is HK$200.", tags: ["access", "card", "badge", "security"] },
        { title: "Business Travel Booking", content: "All business travel must be approved by your department head. Use the designated travel platform to book flights and hotels. Economy class for flights under 4 hours; premium economy for 4-8 hours; business class for 8+ hours. Hotel budget cap: HK$1,500/night.", tags: ["travel", "booking", "business"] },
      ],
      "finance-procurement": [
        { title: "Expense Claim Procedure", content: "Submit expense claims within 30 days of incurring the expense. Receipts are required for all items over HK$200. Meal allowance is capped at HK$150 per meal. Mileage reimbursement rate is HK$2.50 per km. All claims must be approved by your direct manager.", tags: ["expense", "claim", "reimbursement"] },
        { title: "Procurement Approval Levels", content: "Purchases under HK$5,000: manager approval. HK$5,000 - HK$50,000: department head approval. HK$50,000 - HK$500,000: director approval. Above HK$500,000: requires tender process with minimum 3 quotes.", tags: ["procurement", "approval", "budget"] },
      ],
      "general-faq": [
        { title: "Company Handbook", content: "Working hours: 9:00 AM - 6:00 PM, Monday to Friday. Flexible working arrangements available with manager approval. Dress code: business casual. Parking: available on first-come-first-served basis. Canteen: open 8:00 AM - 3:00 PM.", tags: ["general", "handbook", "hours"] },
        { title: "Public Holiday Schedule 2026", content: "The company observes all Hong Kong General Holidays. Key holidays: Lunar New Year (Feb 17-19), Ching Ming Festival (Apr 5), Easter (Apr 3-6), Labour Day (May 1), Tuen Ng Festival (May 31), HKSAR Establishment Day (Jul 1), Mid-Autumn Festival (Sep 25), National Day (Oct 1), Chung Yeung Festival (Oct 19), Christmas (Dec 25-26).", tags: ["holiday", "calendar", "public"] },
      ],
    }

    const articles = sampleArticles[kb.slug]
    if (articles) {
      for (const article of articles) {
        await prisma.knowledgeArticle.upsert({
          where: { id: `${kb.slug}-${article.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}` },
          update: { ...article, language: "en" },
          create: { ...article, id: `${kb.slug}-${article.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, knowledgeBaseId: created.id, language: "en" },
        })
      }
    }
  }

  // Seed default onboarding workflow template
  const onboardingTemplate = {
    id: "template-onboarding-default",
    workspaceId: workspace.id,
    name: "Standard Employee Onboarding",
    description: "Complete onboarding workflow for new employees covering Admin, IT, HR, and Manager tasks",
    category: "ONBOARDING" as const,
    isDefault: true,
    steps: [
      { stepIndex: 1, title: "Prepare workstation & desk", department: "ADMIN", description: "Set up desk, chair, monitor, stationery", slaHours: 40 },
      { stepIndex: 2, title: "Issue access card / key fob", department: "ADMIN", description: "Create building access card and office key", slaHours: 40 },
      { stepIndex: 3, title: "Create IT accounts", department: "IT", description: "Email, VPN, Slack, Jira, GitHub accounts", slaHours: 24 },
      { stepIndex: 4, title: "Set up laptop & software", department: "IT", description: "Provision laptop, install required software", slaHours: 24 },
      { stepIndex: 5, title: "Create personnel file", department: "HR", description: "Collect ID, bank details, contract, create HRIS record", slaHours: 24 },
      { stepIndex: 6, title: "Enroll in benefits", department: "HR", description: "Medical insurance, MPF enrollment", slaHours: 72 },
      { stepIndex: 7, title: "Schedule orientation", department: "MANAGER", description: "Arrange team intro, company orientation session", slaHours: 40 },
      { stepIndex: 8, title: "Assign buddy/mentor", department: "MANAGER", description: "Assign a buddy for first 2 weeks", slaHours: 40 },
    ],
  }

  await prisma.workflowTemplate.upsert({
    where: { id: onboardingTemplate.id },
    update: onboardingTemplate,
    create: onboardingTemplate,
  })

  // Seed default expense policies
  const policies = [
    { name: "Meal Allowance Cap", rule: "meal_max", description: "Maximum meal expense per person per meal", threshold: 150, unit: "HKD", enabled: true },
    { name: "Mileage Reimbursement Rate", rule: "mileage_rate", description: "Reimbursement rate per kilometer for personal vehicle use", threshold: 2.5, unit: "HKD/km", enabled: true },
    { name: "Hotel Budget Cap", rule: "hotel_cap", description: "Maximum hotel expense per night for business travel", threshold: 1500, unit: "HKD/night", enabled: true },
    { name: "Receipt Threshold", rule: "receipt_threshold", description: "Minimum amount requiring a receipt", threshold: 200, unit: "HKD", enabled: true },
    { name: "Entertainment Budget Cap", rule: "entertainment_cap", description: "Maximum entertainment expense per event", threshold: 3000, unit: "HKD", enabled: true },
  ]

  for (const policy of policies) {
    await prisma.expensePolicy.upsert({
      where: { id: `policy-${policy.rule}` },
      update: policy,
      create: { ...policy, id: `policy-${policy.rule}`, workspaceId: workspace.id },
    })
  }

  console.log("Seed complete!")
  console.log("  Account:", account.id)
  console.log("  Workspace:", workspace.id)
  console.log("  User:", user.email)
  console.log("  Agents:", agents.length)
  console.log("  Templates:", templates.length)
  console.log("  Knowledge Bases:", kbs.length)
  console.log("  Expense Policies:", policies.length)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
