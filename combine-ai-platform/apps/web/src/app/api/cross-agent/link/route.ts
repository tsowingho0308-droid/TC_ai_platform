import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

interface CrossAgentLinkBody {
  sourceType: "email" | "report" | "tender"
  sourceId: string
  targetType: "email" | "report" | "tender"
  targetId: string
  linkType: "attachment" | "reference" | "export"
  metadata?: Record<string, unknown>
}

// In-memory store (TODO: Replace with Prisma CrossAgentLink)
const links: Array<CrossAgentLinkBody & { id: string; createdAt: string }> = []

export async function POST(request: Request) {
  try {
    const body = await request.json() as CrossAgentLinkBody
    const { sourceType, sourceId, targetType, targetId, linkType } = body

    if (!sourceType || !sourceId || !targetType || !targetId || !linkType) {
      return NextResponse.json(
        { error: "sourceType, sourceId, targetType, targetId, and linkType are required" },
        { status: 400 }
      )
    }

    const link = {
      id: `link-${Date.now()}`,
      sourceType,
      sourceId,
      targetType,
      targetId,
      linkType,
      metadata: body.metadata || undefined,
      createdAt: new Date().toISOString(),
    }

    links.push(link)

    return NextResponse.json({ link }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sourceType = url.searchParams.get("sourceType")
  const sourceId = url.searchParams.get("sourceId")
  const targetType = url.searchParams.get("targetType")
  const targetId = url.searchParams.get("targetId")

  let filtered = links

  if (sourceType && sourceId) {
    filtered = filtered.filter((l) => l.sourceType === sourceType && l.sourceId === sourceId)
  }
  if (targetType && targetId) {
    filtered = filtered.filter((l) => l.targetType === targetType && l.targetId === targetId)
  }

  return NextResponse.json({ links: filtered })
}
