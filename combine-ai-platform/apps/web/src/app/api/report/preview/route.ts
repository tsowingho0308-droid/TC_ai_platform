import { NextResponse } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import {
  buildTextPreview,
  buildWordPreviewHtml,
} from "@/lib/server/report-document-preview"
import { getMimeTypeForExtension, previewKindFromMime } from "@/lib/server/report-session-file"
import path from "path"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const extension = path.extname(file.name).toLowerCase()
    const mimeType = file.type || getMimeTypeForExtension(extension)
    const previewKind = previewKindFromMime(mimeType, extension)

    if (previewKind === "word") {
      const html = await buildWordPreviewHtml(buffer)
      return NextResponse.json({ previewKind, fileName: file.name, html })
    }

    if (previewKind === "text") {
      const text = buildTextPreview(buffer)
      return NextResponse.json({ previewKind, fileName: file.name, text })
    }

    return NextResponse.json({
      previewKind,
      fileName: file.name,
      mimeType,
    })
  } catch (error) {
    console.error("Report preview error:", error)
    return NextResponse.json(
      { error: "Preview failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
