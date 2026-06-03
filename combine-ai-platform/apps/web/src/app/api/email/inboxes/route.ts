import { NextResponse, type NextRequest } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const kind = url.searchParams.get("kind")

  // TODO: Query from database
  const inboxes = [
    { id: "inbox-primary", name: "Primary Inbox", slug: "primary", kind: "PRIMARY" },
    { id: "inbox-it", name: "IT Support", slug: "it-support", kind: "DEPARTMENT" },
    { id: "inbox-hr", name: "Human Resources", slug: "hr", kind: "DEPARTMENT" },
    { id: "inbox-commercial", name: "Commercial", slug: "commercial", kind: "DEPARTMENT" },
  ]

  const filtered = kind
    ? inboxes.filter((i) => i.kind.toLowerCase() === kind.toLowerCase())
    : inboxes

  return NextResponse.json({ inboxes: filtered })
}
