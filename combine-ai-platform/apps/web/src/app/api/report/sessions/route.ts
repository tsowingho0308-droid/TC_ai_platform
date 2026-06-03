import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// In-memory store (TODO: Replace with Prisma)
let sessions: Array<{
  id: string
  title: string
  status: string
  rows: Array<{ field: string; value: string }>
  draftNote: string | null
  createdAt: string
  updatedAt: string
}> = [
  {
    id: "report-demo-1",
    title: "Sales Report May 2026",
    status: "active",
    rows: [
      { field: "Total Revenue", value: "HK$ 12,500,000" },
      { field: "Growth", value: "+15% YoY" },
    ],
    draftNote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

export async function GET() {
  const summaries = sessions.map(({ id, title, status, updatedAt }) => ({
    id,
    title,
    status,
    updatedAt,
  }))
  return NextResponse.json({ sessions: summaries })
}

export async function POST(request: Request) {
  try {
    const { id, title } = await request.json() as { id?: string; title?: string }
    if (!id || !title) {
      return NextResponse.json({ error: "id and title are required" }, { status: 400 })
    }

    const existing = sessions.find((s) => s.id === id)
    if (existing) {
      return NextResponse.json({ sessions: sessions.map(s => ({ id: s.id, title: s.title, status: s.status, updatedAt: s.updatedAt })) })
    }

    const now = new Date().toISOString()
    sessions.unshift({ id, title, status: "active", rows: [], draftNote: null, createdAt: now, updatedAt: now })

    const summaries = sessions.map(({ id, title, status, updatedAt }) => ({
      id, title, status, updatedAt,
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
    const summaries = sessions.map(({ id, title, status, updatedAt }) => ({
      id, title, status, updatedAt,
    }))
    return NextResponse.json({ sessions: summaries })
  } catch {
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 })
  }
}
