import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { getDashScopeProvider, DEFAULT_MODELS } from "@combine-ai/ai-provider"

export const dynamic = "force-dynamic"

const MAX_CHAT_ROOMS = 5

// ── GET: List conversations or get single with messages ──────────

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const id = url.searchParams.get("id")

    // Fetch single conversation with full messages
    if (id) {
      const conv = await prisma.helpdeskConversation.findFirst({
        where: { id, workspaceId: session.workspaceId },
        select: {
          id: true,
          title: true,
          status: true,
          department: true,
          messages: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      if (!conv) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
      }
      return NextResponse.json({ conversation: conv })
    }

    // List all conversations
    const conversations = await prisma.helpdeskConversation.findMany({
      where: {
        workspaceId: session.workspaceId,
        userId: session.sub,
        status: "ACTIVE",
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_CHAT_ROOMS,
      select: {
        id: true,
        title: true,
        status: true,
        department: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error("Failed to fetch helpdesk conversations:", error)
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    )
  }
}

// ── POST: Create new conversation (with auto-title, FIFO enforcement) ─

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { title, department } = (await request.json().catch(() => ({}))) as {
      title?: string
      department?: string
    }

    // Enforce max 5 — delete oldest if at limit
    const existing = await prisma.helpdeskConversation.findMany({
      where: {
        workspaceId: session.workspaceId,
        userId: session.sub,
        status: "ACTIVE",
      },
      orderBy: { updatedAt: "asc" }, // oldest first
      select: { id: true },
    })

    if (existing.length >= MAX_CHAT_ROOMS) {
      const toDelete = existing.slice(0, existing.length - MAX_CHAT_ROOMS + 1)
      await prisma.helpdeskConversation.deleteMany({
        where: { id: { in: toDelete.map((c) => c.id) } },
      })
    }

    const dep = ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"].includes(department || "")
      ? (department as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL")
      : "GENERAL"

    const conversation = await prisma.helpdeskConversation.create({
      data: {
        workspaceId: session.workspaceId,
        userId: session.sub,
        title: title || "New Chat",
        department: dep,
      },
    })

    return NextResponse.json({ conversation }, { status: 201 })
  } catch (error) {
    console.error("Failed to create helpdesk conversation:", error)
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    )
  }
}

// ── PATCH: Update conversation (title, status) ─────────────────────

export async function PATCH(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, title, status, messages } = (await request.json()) as {
      id?: string
      title?: string
      status?: string
      messages?: Array<{ role: string; content: string; thinking?: string; sources?: unknown; needsEscalation?: boolean; suggestedDepartment?: string }>
    }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.helpdeskConversation.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (status !== undefined) data.status = status
    if (messages !== undefined) data.messages = messages

    const updated = await prisma.helpdeskConversation.update({
      where: { id },
      data,
    })

    return NextResponse.json({ conversation: updated })
  } catch (error) {
    console.error("Failed to update helpdesk conversation:", error)
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    )
  }
}

// ── DELETE: Remove a conversation ──────────────────────────────────

export async function DELETE(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = (await request.json()) as { id?: string }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.helpdeskConversation.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    await prisma.helpdeskConversation.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete helpdesk conversation:", error)
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    )
  }
}

// ── Helper: Auto-generate conversation title from first question ───

const TITLE_GEN_PROMPT = `You are a title generator. Given a user's first question to a helpdesk agent, generate a VERY SHORT title (max 8 words, Traditional Chinese or English matching the question language). Only return the title text, no quotes, no JSON, no explanation.`

export async function generateConversationTitle(question: string): Promise<string> {
  try {
    const provider = getDashScopeProvider()
    const result = await provider.createCompletion({
      model: DEFAULT_MODELS.email,
      temperature: 0.3,
      maxTokens: 50,
      responseFormat: "text",
      messages: [
        { role: "system", content: TITLE_GEN_PROMPT },
        { role: "user", content: question.slice(0, 500) },
      ],
    })
    const title = result.messageContent.trim().replace(/^["']|["']$/g, "").slice(0, 80)
    return title || question.slice(0, 50)
  } catch {
    return question.slice(0, 50)
  }
}
