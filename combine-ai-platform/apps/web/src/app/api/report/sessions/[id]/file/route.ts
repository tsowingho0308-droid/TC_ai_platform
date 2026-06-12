import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { prisma } from "@/lib/server/prisma"
import path from "path"
import fs from "fs"

export const dynamic = "force-dynamic"

const REPORTS_DATA_DIR = path.resolve(process.cwd(), "data", "reports")

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  // Verify the session belongs to this workspace
  const reportSession = await prisma.reportSession.findFirst({
    where: { id, workspaceId: session.workspaceId },
    select: { id: true, title: true },
  })

  if (!reportSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // Find the stored file
  const dir = path.join(REPORTS_DATA_DIR, id)
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: "No file stored for this session" }, { status: 404 })
  }

  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    const filePath = path.join(dir, entry)
    if (fs.statSync(filePath).isFile()) {
      const buffer = fs.readFileSync(filePath)
      const ext = path.extname(entry).toLowerCase()

      const mimeTypes: Record<string, string> = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".txt": "text/plain",
      }

      const mimeType = mimeTypes[ext] || "application/octet-stream"

      return new NextResponse(buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(buffer.length),
          "Cache-Control": "private, max-age=3600",
        },
      })
    }
  }

  return NextResponse.json({ error: "File not found" }, { status: 404 })
}
