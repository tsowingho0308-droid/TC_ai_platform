// GET /api/helpdesk/agent/status/[taskId]
// Polling endpoint for async chat tasks — returns current status + result when done
import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { getTaskStatus, getTaskResult } from "@/features/helpdesk/api/helpdesk-queue"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { taskId } = await params

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 })
    }

    const status = await getTaskStatus(taskId)

    if (!status) {
      return NextResponse.json(
        { status: "expired", message: "Task not found or expired" },
        { status: 404 }
      )
    }

    if (status === "completed") {
      const result = await getTaskResult(taskId)
      return NextResponse.json({
        status: "completed",
        result: result || undefined,
      })
    }

    if (status === "error") {
      const result = await getTaskResult(taskId)
      return NextResponse.json({
        status: "error",
        error: result?.error || "Task processing failed",
      })
    }

    // "queued" or "processing"
    return NextResponse.json({ status })
  } catch (error) {
    console.error("Task status API error:", error)
    return NextResponse.json(
      { error: "Failed to check task status" },
      { status: 500 }
    )
  }
}
