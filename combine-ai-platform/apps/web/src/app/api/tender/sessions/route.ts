import { NextResponse } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import type { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

// ── GET /api/tender/sessions ──────────────────────────────────

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const sessions = await prisma.tenderSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        templateId: true,
        tenderType: true,
        fieldInputs: true,
        status: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Failed to fetch tender sessions:", error)
    return NextResponse.json(
      { error: "Failed to fetch sessions", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── POST /api/tender/sessions ─────────────────────────────────

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, title, templateId, tenderType, fieldInputs } = (await request.json().catch(() => ({}))) as {
      id?: string
      title?: string
      templateId?: string
      tenderType?: string
      fieldInputs?: Record<string, string>
    }

    if (!id || !title) {
      return NextResponse.json({ error: "id and title are required" }, { status: 400 })
    }

    const existing = await prisma.tenderSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (existing) {
      const sessions = await prisma.tenderSession.findMany({
        where: { workspaceId: session.workspaceId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, templateId: true, tenderType: true, status: true, updatedAt: true },
      })
      return NextResponse.json({ sessions })
    }

    await prisma.tenderSession.create({
      data: {
        id,
        workspaceId: session.workspaceId,
        userId: session.sub,
        title,
        templateId: templateId || null,
        tenderType: tenderType || null,
        fieldInputs: (fieldInputs || {}) as Prisma.InputJsonValue,
        status: "active",
      },
    })

    const sessions = await prisma.tenderSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, templateId: true, tenderType: true, status: true, updatedAt: true },
    })

    return NextResponse.json({ sessions }, { status: 201 })
  } catch (error) {
    console.error("Failed to create tender session:", error)
    return NextResponse.json(
      { error: "Failed to create session", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── PATCH /api/tender/sessions ────────────────────────────────

export async function PATCH(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, title, templateId, tenderType, fieldInputs, status: newStatus } = (await request.json()) as {
      id?: string
      title?: string
      templateId?: string
      tenderType?: string
      fieldInputs?: Record<string, string>
      status?: string
    }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.tenderSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    if (title !== undefined) updateData.title = title
    if (templateId !== undefined) updateData.templateId = templateId
    if (tenderType !== undefined) updateData.tenderType = tenderType
    if (fieldInputs !== undefined) updateData.fieldInputs = fieldInputs as Prisma.InputJsonValue
    if (newStatus !== undefined) updateData.status = newStatus

    await prisma.tenderSession.update({
      where: { id },
      data: updateData,
    })

    const sessions = await prisma.tenderSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, templateId: true, tenderType: true, status: true, updatedAt: true },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Failed to update tender session:", error)
    return NextResponse.json(
      { error: "Failed to update session", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── DELETE /api/tender/sessions ───────────────────────────────

export async function DELETE(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = (await request.json().catch(() => ({}))) as { id?: string }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.tenderSession.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    await prisma.tenderSession.delete({
      where: { id },
    })

    const sessions = await prisma.tenderSession.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, templateId: true, tenderType: true, status: true, updatedAt: true },
    })

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error("Failed to delete tender session:", error)
    return NextResponse.json(
      { error: "Failed to delete session", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
