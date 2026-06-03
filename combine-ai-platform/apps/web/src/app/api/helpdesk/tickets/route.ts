import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const id = url.searchParams.get("id")
  const limit = parseInt(url.searchParams.get("limit") || "50", 10)

  if (id) {
    const ticket = await prisma.helpdeskTicket.findFirst({
      where: { id, workspaceId: session.workspaceId },
      include: {
        user: { select: { name: true, email: true } },
        assignedTo: { select: { name: true, email: true } },
      },
    })

    if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

    return NextResponse.json({
      ticket: {
        ...ticket,
        userName: ticket.user?.name || null,
        assignedToName: ticket.assignedTo?.name || null,
      },
    })
  }

  const tickets = await prisma.helpdeskTicket.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  return NextResponse.json({ tickets })
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      id?: string
      status?: string
      assignedToId?: string
      humanReply?: string
      action?: string
    }

    const { id, status, assignedToId, humanReply, action } = body
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const data: Record<string, unknown> = {}
    if (status) data.status = status
    if (assignedToId !== undefined) data.assignedToId = assignedToId
    if (humanReply !== undefined) data.humanReply = humanReply

    if (action === "claim") {
      data.status = "ANSWERED"
      data.assignedToId = session.sub
    }

    if (status === "CLOSED") {
      data.resolvedAt = new Date()
    }

    await prisma.helpdeskTicket.updateMany({
      where: { id, workspaceId: session.workspaceId },
      data,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Ticket PATCH error:", error)
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 })
  }
}
