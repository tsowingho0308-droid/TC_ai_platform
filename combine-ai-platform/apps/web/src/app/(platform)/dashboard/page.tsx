"use client"

import Link from "next/link"
import { Mail, FileSpreadsheet, FileText, Receipt, MessageCircleQuestion, GitBranch } from "lucide-react"

const agents = [
  {
    slug: "email",
    name: "Email Agent",
    nameZh: "電郵代理",
    description: "Intelligent email triage, work classification, and auto-reply management",
    descriptionZh: "智能郵件分類、工作類型識別及自動回覆管理",
    icon: Mail,
    href: "/email",
  },
  {
    slug: "report",
    name: "Report Agent",
    nameZh: "報告代理",
    description: "AI-powered document processing, key point extraction, and multi-format export",
    descriptionZh: "AI驅動文件處理、重點提取及多格式匯出",
    icon: FileSpreadsheet,
    href: "/report",
  },
  {
    slug: "tender",
    name: "Tender Agent",
    nameZh: "標書代理",
    description: "Bidding document analysis, service comparison, and competitive intelligence",
    descriptionZh: "標書分析、服務對比及競爭情報",
    icon: FileText,
    href: "/tender",
  },
  {
    slug: "finance",
    name: "Finance Agent",
    nameZh: "財務代理",
    description: "Receipt/invoice OCR extraction, expense policy compliance, and 3-way PO/GRN/Invoice matching",
    descriptionZh: "收據發票AI提取、報銷政策合規檢查、三單匹配對帳",
    icon: Receipt,
    href: "/finance",
  },
  {
    slug: "helpdesk",
    name: "Helpdesk Agent",
    nameZh: "知識問答代理",
    description: "Internal knowledge base Q&A, policy lookup, and intelligent ticket escalation",
    descriptionZh: "內部知識庫問答、政策查詢、智能工單升級",
    icon: MessageCircleQuestion,
    href: "/helpdesk",
  },
  {
    slug: "workflow",
    name: "Workflow Agent",
    nameZh: "流程管理代理",
    description: "Cross-department workflow automation with onboarding, offboarding, and approval orchestration",
    descriptionZh: "跨部門流程自動化、入職離職管理、審批流程編排",
    icon: GitBranch,
    href: "/workflow",
  },
]

export default function DashboardPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Select an AI agent to get started
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Link
            key={agent.slug}
            href={agent.href}
            className="group rounded-xl border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-md"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <agent.icon className="h-6 w-6" />
            </div>
            <h2 className="mb-1 text-lg font-semibold group-hover:text-primary">
              {agent.name}
            </h2>
            <p className="mb-1 text-sm text-muted-foreground">{agent.nameZh}</p>
            <p className="text-sm text-muted-foreground">{agent.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
