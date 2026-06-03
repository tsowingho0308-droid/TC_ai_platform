import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  // TODO: Query from database TenderTemplate table
  const templates = [
    {
      id: "template-it-tender",
      locale: "zh_hk",
      title: "IT Services Tender Analysis",
      scenario: "tender-analysis",
      description: "Standard IT services tender with services, budget, and requirements",
    },
    {
      id: "template-consulting-tender",
      locale: "zh_hk",
      title: "Consulting Services Tender",
      scenario: "tender-analysis",
      description: "Consulting services tender with scope, deliverables, timeline",
    },
    {
      id: "template-bid-comparison",
      locale: "zh_hk",
      title: "Bid Comparison Template",
      scenario: "bid-comparison",
      description: "Compare company bid against competitor bids",
    },
  ]

  return NextResponse.json({ templates })
}
