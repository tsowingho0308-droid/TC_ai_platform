import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const kind = url.searchParams.get("kind")

  const inboxes = await prisma.inbox.findMany({
    where: {
      workspaceId: session.workspaceId,
      ...(kind ? { kind: kind.toUpperCase() as "PRIMARY" | "DEPARTMENT" } : {}),
    },
    orderBy: [
      { kind: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
    },
  })

  return NextResponse.json({ inboxes })
}
