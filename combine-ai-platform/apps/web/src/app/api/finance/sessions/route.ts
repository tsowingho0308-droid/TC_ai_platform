import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const id = url.searchParams.get("id")

  if (id) {
    const financeSession = await prisma.financeSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
      include: {
        documents: { orderBy: { createdAt: "asc" } },
        turns: { orderBy: { createdAt: "asc" } },
      },
    })

    if (!financeSession) return NextResponse.json({ error: "Session not found" }, { status: 404 })

    return NextResponse.json({ session: financeSession })
  }

  const sessions = await prisma.financeSession.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, sessionType: true, status: true, updatedAt: true,
    },
    take: 50,
  })

  return NextResponse.json({ sessions })
}

export async function POST(request: NextRequest) {
  const authSession = await requireSession().catch(() => null)
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      title?: string
      sessionType?: string
    }

    const session = await prisma.financeSession.create({
      data: {
        workspaceId: authSession.workspaceId,
        userId: authSession.sub,
        title: body.title || "New Finance Session",
        sessionType: (body.sessionType as "EXPENSE_REVIEW" | "THREE_WAY_MATCH") || "EXPENSE_REVIEW",
      },
    })

    const sessions = await prisma.financeSession.findMany({
      where: { workspaceId: authSession.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, title: true, sessionType: true, status: true, updatedAt: true,
      },
      take: 50,
    })

    return NextResponse.json({ session, sessions }, { status: 201 })
  } catch (error) {
    console.error("Finance sessions POST error:", error)
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authSession = await requireSession().catch(() => null)
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await request.json() as { id?: string }
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    await prisma.financeSession.deleteMany({
      where: { id, workspaceId: authSession.workspaceId },
    })

    const sessions = await prisma.financeSession.findMany({
      where: { workspaceId: authSession.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, title: true, sessionType: true, status: true, updatedAt: true,
      },
      take: 50,
    })

    return NextResponse.json({ sessions })
  } catch {
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authSession = await requireSession().catch(() => null)
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, extractedRows, policyResults, draftNote } = await request.json() as {
      id?: string
      extractedRows?: Record<string, unknown>[]
      policyResults?: Record<string, unknown>[]
      draftNote?: string
    }
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const updated = await prisma.financeSession.updateMany({
      where: { id, workspaceId: authSession.workspaceId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...(extractedRows !== undefined && { extractedRows: extractedRows as any }),
        ...(policyResults !== undefined && { policyResults: policyResults as any }),
        ...(draftNote !== undefined && { draftNote }),
      } as any,
    })

    if (updated.count === 0) return NextResponse.json({ error: "Session not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 })
  }
}
