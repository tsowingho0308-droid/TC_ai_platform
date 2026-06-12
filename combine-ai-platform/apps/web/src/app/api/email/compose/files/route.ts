import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import {
  buildComposeAttachmentPath,
  deleteComposeAttachmentFile,
  deleteComposeAttachmentMeta,
  loadComposeAttachmentMeta,
  saveComposeAttachmentFile,
  saveComposeAttachmentMeta,
} from "@/lib/server/compose-attachment-store"
import { extractTextFromDocument, isSupportedDocumentMimeType } from "@/lib/server/document-text"

export const dynamic = "force-dynamic"

const MAX_FILE_BYTES = 10 * 1024 * 1024
const TEXT_EXCERPT_LIMIT = 8000

function inferMimeType(rawType: string, fileName: string) {
  if (rawType) return rawType
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".txt")) return "text/plain"
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (lower.endsWith(".doc")) return "application/msword"
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".zip")) return "application/zip"
  return "application/octet-stream"
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 })
    }

    const fileName = file.name || "attachment"
    const mimeType = inferMimeType(file.type, fileName)

    const buffer = Buffer.from(await file.arrayBuffer())
    let textExcerpt = ""
    if (isSupportedDocumentMimeType(mimeType, fileName)) {
      try {
        const text = await extractTextFromDocument(buffer, fileName, mimeType)
        textExcerpt = text.slice(0, TEXT_EXCERPT_LIMIT)
      } catch {
        textExcerpt = ""
      }
    }

    const id = crypto.randomUUID()
    const storagePath = buildComposeAttachmentPath(session.workspaceId, id, fileName)
    await saveComposeAttachmentFile(storagePath, buffer)
    await saveComposeAttachmentMeta({
      id,
      workspaceId: session.workspaceId,
      fileName,
      mimeType,
      sizeBytes: buffer.length,
      storagePath,
      textExcerpt,
    })

    return NextResponse.json({
      id,
      fileName,
      mimeType,
      sizeBytes: buffer.length,
      textExcerpt,
    })
  } catch (error) {
    console.error("Compose file upload error:", error)
    return NextResponse.json(
      {
        error: "Failed to upload file",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const meta = await loadComposeAttachmentMeta(session.workspaceId, id)
  if (!meta) return NextResponse.json({ error: "File not found" }, { status: 404 })

  await deleteComposeAttachmentFile(meta.storagePath)
  await deleteComposeAttachmentMeta(session.workspaceId, id)
  return NextResponse.json({ success: true })
}
