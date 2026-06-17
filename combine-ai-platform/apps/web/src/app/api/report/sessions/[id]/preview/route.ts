import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { prisma } from "@/lib/server/prisma"
import {
  buildTextPreview,
  buildWordPreviewHtml,
} from "@/lib/server/report-document-preview"
import {
  previewKindFromMime,
  readStoredReportFile,
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

  const stored = readStoredReportFile(id)
  if (!stored) {
    return NextResponse.json({ error: "No file stored for this session" }, { status: 404 })
  }

  const previewKind = previewKindFromMime(stored.mimeType, stored.extension)
  const fileName = reportSession.title || stored.storedName

  if (previewKind === "word") {
    const html = await buildWordPreviewHtml(stored.buffer)
    return NextResponse.json(
      { previewKind, fileName, html },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    )
  }

  if (previewKind === "text") {
    const text = buildTextPreview(stored.buffer)
    return NextResponse.json(
      { previewKind, fileName, text },
      { headers: { "Cache-Control": "private, max-age=3600" } }
    )
  }

  return NextResponse.json({
    previewKind,
    fileName,
    fileUrl: `/api/report/sessions/${encodeURIComponent(id)}/file`,
  })
}
