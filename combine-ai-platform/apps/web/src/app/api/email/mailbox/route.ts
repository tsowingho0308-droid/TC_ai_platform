import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { FolderId } from "@prisma/client"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const folder = (url.searchParams.get("folder") || "inbox") as FolderId
  const inboxId = url.searchParams.get("inboxId")
  const department = url.searchParams.get("department")
  const q = url.searchParams.get("q")
  const conversationId = url.searchParams.get("conversationId")

  // Return single conversation detail
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId: session.workspaceId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        attachments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            messageId: true,
            createdAt: true,
          },
        },
        inquiryTasks: {
          orderBy: { sortOrder: "asc" },
          include: { childConversation: { select: { id: true, subject: true, status: true } } },
        },
        parentConversation: { select: { id: true, subject: true } },
        childConversations: {
          select: { id: true, subject: true, status: true, departmentReviewStatus: true },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    return NextResponse.json({ conversation })
  }

  // List conversations
  const inboxCondition = inboxId ? { inboxId } : {}
  const departmentCondition = department ? { inbox: { slug: department } } : {}
  const searchCondition = q
    ? { OR: [{ subject: { contains: q, mode: "insensitive" as const } }, { senderName: { contains: q, mode: "insensitive" as const } }, { senderEmail: { contains: q, mode: "insensitive" as const } }] }
    : {}

  const conversations = await prisma.conversation.findMany({
    where: {
      workspaceId: session.workspaceId,
      folderId: folder,
      parentConversationId: null, // only root conversations
      ...inboxCondition,
      ...departmentCondition,
      ...searchCondition,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      inboxId: true,
      subject: true,
      senderName: true,
      senderEmail: true,
      preview: true,
      read: true,
      starred: true,
      labels: true,
      status: true,
      workType: true,
      aiTriagedAt: true,
      aiRouteConfidence: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ conversations })
}
