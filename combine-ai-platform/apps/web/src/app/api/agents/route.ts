import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const agents = [
  {
    id: "agent-email",
    slug: "email",
    name: "Email Agent",
    nameZh: "電郵代理",
    description: "Intelligent email triage, work classification, and auto-reply management",
    descriptionZh: "智能郵件分類、工作類型識別及自動回覆管理",
    icon: "Mail",
    enabled: true,
    sortOrder: 1,
  },
  {
    id: "agent-report",
    slug: "report",
    name: "Report Agent",
    nameZh: "報告代理",
    description: "AI-powered document processing, key point extraction, and multi-format export",
    descriptionZh: "AI驅動文件處理、重點提取及多格式匯出",
    icon: "FileSpreadsheet",
    enabled: true,
    sortOrder: 2,
  },
  {
    id: "agent-tender",
    slug: "tender",
    name: "Tender Agent",
    nameZh: "標書代理",
    description: "Bidding document analysis, service comparison, and competitive intelligence",
    descriptionZh: "標書分析、服務對比及競爭情報",
    icon: "FileText",
    enabled: true,
    sortOrder: 3,
  },
]

export async function GET() {
  // TODO: Query from database Agent table
  return NextResponse.json({ agents })
}
