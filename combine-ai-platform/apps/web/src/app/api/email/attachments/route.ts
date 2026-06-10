import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { readAttachmentFile } from "@/lib/server/email-attachment-store"
import { extractTextFromDocument, isSupportedDocumentMimeType } from "@/lib/server/document-text"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const action = url.searchParams.get("action") || "metadata"
  const attachmentId = url.searchParams.get("id")
  const conversationId = url.searchParams.get("conversationId")

  if (conversationId) {
    const attachments = await prisma.messageAttachment.findMany({
      where: { workspaceId: session.workspaceId, conversationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        messageId: true,
        contentId: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ attachments })
  }

  if (!attachmentId) {
    return NextResponse.json({ error: "id or conversationId required" }, { status: 400 })
  }

  const attachment = await prisma.messageAttachment.findFirst({
    where: { id: attachmentId, workspaceId: session.workspaceId },
  })

  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
  }

  let buffer: Buffer
  try {
    buffer = await readAttachmentFile(attachment.storagePath)
  } catch {
    return NextResponse.json({ error: "Attachment file missing on disk" }, { status: 404 })
  }

  if (action === "download") {
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
        "Content-Length": String(buffer.length),
      },
    })
  }

  if (action === "inline") {
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `inline; filename="${attachment.fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600",
      },
    })
  }

  if (action === "extract") {
    if (!isSupportedDocumentMimeType(attachment.mimeType, attachment.fileName)) {
      return NextResponse.json(
        { error: `Unsupported document type: ${attachment.mimeType}` },
        { status: 400 }
      )
    }

    try {
      const text = await extractTextFromDocument(buffer, attachment.fileName, attachment.mimeType)
      return NextResponse.json({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        text,
      })
    } catch (err) {
      return NextResponse.json(
        {
          error: "Failed to extract document text",
          detail: err instanceof Error ? err.message : "Unknown error",
        },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    attachment: {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      conversationId: attachment.conversationId,
      messageId: attachment.messageId,
      createdAt: attachment.createdAt,
    },
  })
}
