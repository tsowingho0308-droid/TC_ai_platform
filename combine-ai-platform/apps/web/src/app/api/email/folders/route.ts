import { NextResponse } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const folderOrder = ["inbox", "starred", "sent", "drafts", "archive", "trash"] as const
  const folders = await Promise.all(
    folderOrder.map(async (folderId) => {
      if (folderId === "starred") {
        const count = await prisma.conversation.count({
          where: {
            workspaceId: session.workspaceId,
            parentConversationId: null,
            starred: true,
          },
        })
        return { id: folderId, count }
      }

      const count = await prisma.conversation.count({
        where: {
          workspaceId: session.workspaceId,
          parentConversationId: null,
          folderId,
        },
      })
      return { id: folderId, count }
    })
  )

  return NextResponse.json({ folders })
}
