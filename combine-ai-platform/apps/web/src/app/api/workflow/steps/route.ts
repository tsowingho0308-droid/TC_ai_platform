import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

/**
 * PATCH - Update a workflow step's status
 */
export async function PATCH(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json() as {
      id?: string
      status?: string
      assignedToId?: string
      notes?: string
    }

    if (!body.id) {
      return NextResponse.json({ error: "Step id is required" }, { status: 400 })
    }

    // Verify step belongs to workspace via its workflow run
    const step = await prisma.workflowStepRun.findFirst({
      where: {
        id: body.id,
        workflowRun: { workspaceId: session.workspaceId },
      },
    })

    if (!step) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 })
    }

    const data: Record<string, unknown> = {}

    if (body.status) {
      data.status = body.status
      if (body.status === "COMPLETED") {
        data.completedAt = new Date()
      }
    }
    if (body.assignedToId !== undefined) {
      data.assignedToId = body.assignedToId
    }
    if (body.notes !== undefined) {
      data.notes = body.notes
    }

    await prisma.workflowStepRun.update({
      where: { id: body.id },
      data,
    })

    // Check if all steps are completed, update workflow run status
    const workflowRun = await prisma.workflowRun.findUnique({
      where: { id: step.workflowRunId },
      include: { steps: true },
    })

    if (workflowRun) {
      const allDone = workflowRun.steps.every(
        (s) => s.status === "COMPLETED" || s.status === "SKIPPED"
      )
      if (allDone && workflowRun.status !== "completed") {
        await prisma.workflowRun.update({
          where: { id: workflowRun.id },
          data: { status: "completed" },
        })
      }
    }

    // Create AgentRun trace
    await prisma.agentRun.create({
      data: {
        workspaceId: session.workspaceId,
        kind: "WORKFLOW_EXECUTION",
        status: "COMPLETED",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: { stepId: body.id, previousStatus: step.status } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output: { newStatus: body.status || step.status } as any,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Workflow steps PATCH error:", error)
    return NextResponse.json({ error: "Failed to update step" }, { status: 500 })
  }
}
