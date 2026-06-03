import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const policies = await prisma.expensePolicy.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ policies })
  } catch (error) {
    console.error("Finance policies GET error:", error)
    return NextResponse.json({ error: "Failed to fetch policies" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      name?: string
      rule?: string
      description?: string | null
      threshold?: number | null
      unit?: string | null
      enabled?: boolean
    }

    if (!body.name || !body.rule) {
      return NextResponse.json({ error: "name and rule are required" }, { status: 400 })
    }

    const policy = await prisma.expensePolicy.create({
      data: {
        workspaceId: session.workspaceId,
        name: body.name,
        rule: body.rule,
        description: body.description || null,
        threshold: body.threshold ?? null,
        unit: body.unit || "HKD",
        enabled: body.enabled ?? true,
      },
    })

    return NextResponse.json({ policy }, { status: 201 })
  } catch (error) {
    console.error("Finance policies POST error:", error)
    return NextResponse.json({ error: "Failed to create policy" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id, ...updates } = await request.json() as {
      id?: string
      name?: string
      rule?: string
      description?: string | null
      threshold?: number | null
      unit?: string | null
      enabled?: boolean
    }

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const updated = await prisma.expensePolicy.updateMany({
      where: { id, workspaceId: session.workspaceId },
      data: updates,
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Finance policies PATCH error:", error)
    return NextResponse.json({ error: "Failed to update policy" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await request.json() as { id?: string }
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    await prisma.expensePolicy.deleteMany({
      where: { id, workspaceId: session.workspaceId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Finance policies DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete policy" }, { status: 500 })
  }
}
