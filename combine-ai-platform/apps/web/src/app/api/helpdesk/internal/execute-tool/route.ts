// POST /api/helpdesk/internal/execute-tool
// Internal endpoint called by the Python worker to execute tool calls.
// Authenticated via X-Internal-Secret header (not session cookie).
import { NextResponse, type NextRequest } from "next/server"
import { executeToolCall, type SessionContext } from "@/features/helpdesk/api/helpdesk-tools"

export const dynamic = "force-dynamic"

const INTERNAL_API_SECRET =
  process.env.INTERNAL_API_SECRET || "dev-secret-change-me"

export async function POST(request: NextRequest) {
  // ── Shared-secret authentication ─────────────────────────────────
  const secret = request.headers.get("x-internal-secret")
  if (!secret || secret !== INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json() as {
      taskId?: string
      toolCall?: {
        id: string
        type: string
        function: {
          name: string
          arguments: string
        }
      }
      session?: SessionContext
    }

    if (!body.toolCall || !body.session) {
      return NextResponse.json(
        { error: "toolCall and session are required" },
        { status: 400 }
      )
    }

    // Normalize toolCall type for the shared executor
    const normalizedToolCall = {
      id: body.toolCall.id,
      type: "function" as const,
      function: body.toolCall.function,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { messages } = await executeToolCall(normalizedToolCall as any, body.session)

    // Extract a human-readable summary from the tool result
    let summary = "Done"
    if (messages[0]?.content) {
      try {
        const parsed = JSON.parse(messages[0].content as string)
        if (parsed.error) {
          summary = `Error: ${parsed.error}`
        } else {
          summary =
            (parsed.message as string) ||
            (parsed.totalResults != null
              ? `Found ${parsed.totalResults} results`
              : "Processing complete")
        }
      } catch {
        // Non-JSON content — use as-is (truncated)
        const contentStr = messages[0].content as string
        summary = contentStr.length > 200 ? contentStr.slice(0, 200) + "…" : contentStr
      }
    }

    return NextResponse.json({
      messages,
      summary,
      taskId: body.taskId,
    })
  } catch (error) {
    console.error("Internal tool execution error:", error)
    return NextResponse.json(
      {
        error: "Tool execution failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
