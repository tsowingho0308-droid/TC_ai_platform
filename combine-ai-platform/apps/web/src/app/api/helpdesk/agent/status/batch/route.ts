// GET /api/helpdesk/agent/status/batch?ids=id1,id2,id3
// Batch polling endpoint — queries multiple task statuses in one Redis MGET.
// Reduces N HTTP requests to 1, preventing polling DDoS at scale.
import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { ensureRedisConnected, redis } from "@/lib/server/redis"

export const dynamic = "force-dynamic"

const STATUS_PREFIX = "helpdesk:status:"
const RESULT_PREFIX = "helpdesk:result:"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const idsParam = url.searchParams.get("ids")
    if (!idsParam) {
      return NextResponse.json({ error: "ids query param required (comma-separated)" }, { status: 400 })
    }

    const taskIds = idsParam.split(",").filter(Boolean)
    if (taskIds.length === 0) return NextResponse.json({})
    if (taskIds.length > 50) {
      return NextResponse.json({ error: "Maximum 50 task IDs per batch" }, { status: 400 })
    }

    await ensureRedisConnected()

    // MGET all statuses in one Redis round-trip
    const statusKeys = taskIds.map((id) => `${STATUS_PREFIX}${id}`)
    const statuses = await redis.mget(...statusKeys)

    const result: Record<string, unknown> = {}

    // For completed/error tasks, also fetch the result
    const resultKeys: string[] = []
    const resultIndices: number[] = []

    for (let i = 0; i < taskIds.length; i++) {
      const status = statuses[i]
      if (!status) {
        result[taskIds[i]] = { status: "expired" }
      } else if (status === "completed" || status === "error") {
        resultKeys.push(`${RESULT_PREFIX}${taskIds[i]}`)
        resultIndices.push(i)
        result[taskIds[i]] = { status } // placeholder, will be enriched
      } else {
        result[taskIds[i]] = { status }
      }
    }

    // MGET all results for completed/error tasks
    if (resultKeys.length > 0) {
      const results = await redis.mget(...resultKeys)
      for (let j = 0; j < resultKeys.length; j++) {
        const idx = resultIndices[j]
        const raw = results[j]
        const entry = result[taskIds[idx]] as Record<string, unknown>

        if (raw) {
          try {
            entry.result = JSON.parse(raw)
          } catch {
            // ignore parse errors
          }
        }
        if (entry.status === "error") {
          entry.error = (entry.result as Record<string, unknown> | null)?.error || "Task failed"
        }
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Batch status API error:", error)
    return NextResponse.json(
      { error: "Failed to check batch status" },
      { status: 500 }
    )
  }
}
