import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    where: { workspaceId: session.workspaceId },
    include: { _count: { select: { articles: true } } },
    orderBy: { name: "asc" },
  })

  const mapped = knowledgeBases.map((kb) => ({
    id: kb.id,
    name: kb.name,
    slug: kb.slug,
    department: kb.department,
    description: kb.description,
    articleCount: kb._count.articles,
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  }))

  return NextResponse.json({ knowledgeBases: mapped })
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      name?: string
      slug?: string
      department?: string
      description?: string
    }

    const kb = await prisma.knowledgeBase.create({
      data: {
        workspaceId: session.workspaceId,
        name: body.name || "New Knowledge Base",
        slug: body.slug || `kb-${Date.now()}`,
        department: (body.department as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL") || "GENERAL",
        description: body.description || null,
      },
    })

    return NextResponse.json({ knowledgeBase: kb }, { status: 201 })
  } catch (error) {
    console.error("Knowledge base POST error:", error)
    return NextResponse.json({ error: "Failed to create knowledge base" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await request.json() as { id?: string }
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    await prisma.knowledgeBase.deleteMany({
      where: { id, workspaceId: session.workspaceId },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete knowledge base" }, { status: 500 })
  }
}
