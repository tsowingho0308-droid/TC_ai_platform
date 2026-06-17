import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { prisma } from "@/lib/server/prisma"
import {
  findStoredReportFile,
  previewKindFromMime,
} from "@/lib/server/report-session-file"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const reportSession = await prisma.reportSession.findFirst({
    where: { id, workspaceId: session.workspaceId },
    select: { id: true, title: true },
  })

  if (!reportSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const stored = findStoredReportFile(id)
  if (!stored) {
    return NextResponse.json({
      available: false,
      fileName: reportSession.title,
      mimeType: null,
      extension: null,
      previewKind: null,
    })
  }

  const previewKind = previewKindFromMime(stored.mimeType, stored.extension)

  return NextResponse.json({
    available: true,
    fileName: reportSession.title || stored.storedName,
    storedFileName: stored.storedName,
    mimeType: stored.mimeType,
    extension: stored.extension,
    previewKind,
  })
}
