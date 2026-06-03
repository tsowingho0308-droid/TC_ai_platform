import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// In-memory store (TODO: Replace with Prisma)
let sessions: Array<{
  id: string
  title: string
  templateId: string | null
  tenderType: string | null
  fieldInputs: Record<string, string>
  status: string
  createdAt: string
  updatedAt: string
}> = [
  {
    id: "tender-demo-1",
    title: "ABC Corp RFP Analysis",
    templateId: "template-it-tender",
    tenderType: "client_tender",
    fieldInputs: {
      client_org: "ABC Corporation",
      services_included: "IT Infrastructure, Cloud Migration",
      budget: "HK$ 5,000,000",
    },
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export async function GET() {
  const summaries = sessions.map(({ id, title, templateId, tenderType, status, updatedAt }) => ({
    id, title, templateId, tenderType, status, updatedAt,
  }))
  return NextResponse.json({ sessions: summaries })
}

export async function POST(request: Request) {
  try {
    const { id, title, templateId } = await request.json() as { id?: string; title?: string; templateId?: string }
    if (!id || !title) {
      return NextResponse.json({ error: "id and title are required" }, { status: 400 })
    }

    const existing = sessions.find((s) => s.id === id)
    if (existing) {
      const summaries = sessions.map(({ id, title, templateId, tenderType, status, updatedAt }) => ({
        id, title, templateId, tenderType, status, updatedAt,
      }))
      return NextResponse.json({ sessions: summaries })
    }

    const now = new Date().toISOString()
    sessions.unshift({
      id,
      title,
      templateId: templateId || null,
      tenderType: null,
      fieldInputs: {},
      status: "active",
      createdAt: now,
      updatedAt: now,
    })

    const summaries = sessions.map(({ id, title, templateId, tenderType, status, updatedAt }) => ({
      id, title, templateId, tenderType, status, updatedAt,
    }))
    return NextResponse.json({ sessions: summaries })
  } catch {
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json() as { id?: string }
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    sessions = sessions.filter((s) => s.id !== id)
    const summaries = sessions.map(({ id, title, templateId, tenderType, status, updatedAt }) => ({
      id, title, templateId, tenderType, status, updatedAt,
    }))
    return NextResponse.json({ sessions: summaries })
  } catch {
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 })
  }
}
