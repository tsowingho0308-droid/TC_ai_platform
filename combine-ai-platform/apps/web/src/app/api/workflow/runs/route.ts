import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

function countOverdueSteps(
  steps: Array<{ status: string; slaHours: number | null; createdAt: Date }>
) {
  return steps.filter((step) => {
    if (step.status === "COMPLETED" || step.status === "SKIPPED" || !step.slaHours) {
      return false
    }
    const elapsed = Date.now() - step.createdAt.getTime()
    return elapsed > step.slaHours * 60 * 60 * 1000
  }).length
}

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const id = url.searchParams.get("id")

  if (id) {
    const run = await prisma.workflowRun.findFirst({
      where: { id, workspaceId: session.workspaceId },
      include: {
        steps: { orderBy: { stepIndex: "asc" } },
        template: { select: { name: true } },
      },
    })

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })

    return NextResponse.json({
      run: {
        ...run,
        templateName: run.template?.name || null,
        completedSteps: run.steps.filter(s => s.status === "COMPLETED").length,
        totalSteps: run.steps.length,
      },
    })
  }

  const runs = await prisma.workflowRun.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { select: { status: true, slaHours: true, createdAt: true } },
    },
    take: 50,
  })

  const summaries = runs.map((run) => ({
    id: run.id,
    title: run.title,
    category: run.category,
    status: run.status,
    targetPerson: run.targetPerson,
    completedSteps: run.steps.filter(s => s.status === "COMPLETED").length,
    totalSteps: run.steps.length,
    overdueSteps: countOverdueSteps(run.steps),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }))

  return NextResponse.json({ runs: summaries })
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      title?: string
      category?: string
      templateId?: string
      targetPerson?: Record<string, unknown>
    }

    // If a template is specified, copy its steps
    let stepsData: Array<{
      stepIndex: number
      title: string
      department: string
      slaHours: number
    }> = []

    if (body.templateId) {
      const template = await prisma.workflowTemplate.findFirst({
        where: { id: body.templateId, workspaceId: session.workspaceId },
      })
      if (template?.steps) {
        stepsData = template.steps as typeof stepsData
      }
    }

    const run = await prisma.workflowRun.create({
      data: {
        workspaceId: session.workspaceId,
        userId: session.sub,
        title: body.title || "New Workflow Run",
        category: (body.category as "ONBOARDING" | "OFFBOARDING" | "PROCUREMENT" | "LEAVE_APPROVAL" | "CUSTOM") || "ONBOARDING",
        templateId: body.templateId || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        targetPerson: (body.targetPerson || undefined) as any,
        steps: {
          create: stepsData.map((s) => ({
            stepIndex: s.stepIndex,
            title: s.title,
            department: s.department,
            slaHours: s.slaHours || null,
          })),
        },
      },
      include: { steps: true },
    })

    return NextResponse.json({
      run: {
        ...run,
        completedSteps: 0,
        totalSteps: run.steps.length,
      },
    }, { status: 201 })
  } catch (error) {
    console.error("Workflow run POST error:", error)
    return NextResponse.json({ error: "Failed to create run" }, { status: 500 })
  }
}
