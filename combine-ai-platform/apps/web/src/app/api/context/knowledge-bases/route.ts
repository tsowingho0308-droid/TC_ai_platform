import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const knowledgeBases = await prisma.knowledgeBase.findMany({
      where: { workspaceId: session.workspaceId },
      include: {
        _count: {
          select: {
            articles: true,
          },
        },
      },
      orderBy: { name: "asc" },
    })

    const result = knowledgeBases.map((kb) => ({
      id: kb.id,
      name: kb.name,
      slug: kb.slug,
      department: kb.department,
      description: kb.description,
      articleCount: kb._count.articles,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    }))

    return NextResponse.json({ knowledgeBases: result })
  } catch (error) {
    console.error("Context knowledge-bases API error:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch knowledge bases",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
