import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const templates = await prisma.workflowTemplate.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { name: "asc" },
  })

  const summaries = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    stepCount: Array.isArray(t.steps) ? (t.steps as unknown[]).length : 0,
    isDefault: t.isDefault,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))

  return NextResponse.json({ templates: summaries })
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      name?: string
      description?: string
      category?: string
      steps?: Array<{ stepIndex: number; title: string; department: string; description: string; slaHours: number }>
    }

    const template = await prisma.workflowTemplate.create({
      data: {
        workspaceId: session.workspaceId,
        name: body.name || "New Template",
        description: body.description || null,
        category: (body.category as "ONBOARDING" | "OFFBOARDING" | "PROCUREMENT" | "LEAVE_APPROVAL" | "CUSTOM") || "CUSTOM",
        steps: body.steps || [],
      },
    })

    return NextResponse.json({ template }, { status: 201 })
  } catch (error) {
    console.error("Template POST error:", error)
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 })
  }
}
