import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function PATCH(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")
    const action = url.searchParams.get("action")

    if (!id) return NextResponse.json({ error: "Conversation id required" }, { status: 400 })

    const conversation = await prisma.conversation.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>

    switch (action) {
      case "read": {
        const read = body.read !== false
        await prisma.conversation.update({ where: { id }, data: { read } })
        return NextResponse.json({ success: true, read })
      }
      case "star": {
        const starred = body.starred !== false
        await prisma.conversation.update({ where: { id }, data: { starred } })
        return NextResponse.json({ success: true, starred })
      }
      case "archive": {
        await prisma.conversation.update({ where: { id }, data: { folderId: "archive" } })
        return NextResponse.json({ success: true })
      }
      case "labels": {
        const labels = Array.isArray(body.labels) ? body.labels as string[] : []
        await prisma.conversation.update({ where: { id }, data: { labels } })
        return NextResponse.json({ success: true, labels })
      }
      case "assign": {
        const assignedToId = typeof body.assignedToId === "string" ? body.assignedToId : null
        await prisma.conversation.update({ where: { id }, data: { assignedToId } })
        return NextResponse.json({ success: true })
      }
      case "status": {
        const status = typeof body.status === "string" ? body.status : "OPEN"
        await prisma.conversation.update({ where: { id }, data: { status: status as never } })
        return NextResponse.json({ success: true })
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ error: "Update failed", detail: String(error) }, { status: 500 })
  }
}
