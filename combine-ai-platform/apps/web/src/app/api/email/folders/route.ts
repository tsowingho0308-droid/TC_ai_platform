import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  // TODO: Query from database
  const folders = [
    { id: "inbox", count: 12 },
    { id: "starred", count: 3 },
    { id: "sent", count: 0 },
    { id: "drafts", count: 0 },
    { id: "archive", count: 5 },
    { id: "trash", count: 2 },
  ]

  return NextResponse.json({ folders })
}
