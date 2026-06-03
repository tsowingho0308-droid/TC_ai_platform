import { NextResponse } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import type { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

// ── GET /api/report/sessions ──────────────────────────────────

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const sessions = await prisma.reportSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        rows: true,
        draftNote: true,
      },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Failed to fetch report sessions:", error)
    return NextResponse.json(
      { error: "Failed to fetch sessions", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── POST /api/report/sessions ─────────────────────────────────

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, title, rows, draftNote } = (await request.json().catch(() => ({}))) as {
      id?: string
      title?: string
      rows?: Array<{ field: string; value: string }>
      draftNote?: string
    }

    if (!id || !title) {
      return NextResponse.json({ error: "id and title are required" }, { status: 400 })
    }

    // Check if session already exists
    const existing = await prisma.reportSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (existing) {
      // Return existing session summaries
      const sessions = await prisma.reportSession.findMany({
        where: { workspaceId: session.workspaceId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, status: true, updatedAt: true },
      })
      return NextResponse.json({ sessions })
    }

    // Create new session
    await prisma.reportSession.create({
      data: {
        id,
        workspaceId: session.workspaceId,
        userId: session.sub,
        title,
        rows: (rows || []) as Prisma.InputJsonValue,
        draftNote: draftNote || null,
        status: "active",
      },
    })

    const sessions = await prisma.reportSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, status: true, updatedAt: true },
    })

    return NextResponse.json({ sessions }, { status: 201 })
  } catch (error) {
    console.error("Failed to create report session:", error)
    return NextResponse.json(
      { error: "Failed to create session", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── PATCH /api/report/sessions ────────────────────────────────

export async function PATCH(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, title, rows, draftNote, status: newStatus } = (await request.json()) as {
      id?: string
      title?: string
      rows?: Array<{ field: string; value: string }>
      draftNote?: string
      status?: string
    }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.reportSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (title !== undefined) updateData.title = title
    if (rows !== undefined) updateData.rows = rows as Prisma.InputJsonValue
    if (draftNote !== undefined) updateData.draftNote = draftNote
    if (newStatus !== undefined) updateData.status = newStatus

    await prisma.reportSession.update({
      where: { id },
      data: updateData,
    })

    const sessions = await prisma.reportSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, status: true, updatedAt: true },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Failed to update report session:", error)
    return NextResponse.json(
      { error: "Failed to update session", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── DELETE /api/report/sessions ───────────────────────────────

export async function DELETE(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = (await request.json().catch(() => ({}))) as { id?: string }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.reportSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    // Delete related conversation turns first
    await prisma.reportConversationTurn.deleteMany({
      where: { sessionId: id },
    })

    await prisma.reportSession.delete({
      where: { id },
    })

    const sessions = await prisma.reportSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, status: true, updatedAt: true },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Failed to delete report session:", error)
    return NextResponse.json(
      { error: "Failed to delete session", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
