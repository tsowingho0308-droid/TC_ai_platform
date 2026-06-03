import { NextResponse } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const folders = ["inbox", "starred", "sent", "drafts", "archive", "trash"] as const

  const counts = await Promise.all(
    folders.map(async (folderId) => {
      const count = await prisma.conversation.count({
        where: {
          workspaceId: session.workspaceId,
          folderId,
          parentConversationId: null,
        },
      })
      return { id: folderId, count }
    })
  )

  return NextResponse.json({ folders: counts })
}
