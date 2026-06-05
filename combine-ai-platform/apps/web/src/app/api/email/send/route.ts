import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import {
  buildMultipartEmail,
  buildPlainTextEmail,
  getValidGmailAccessToken,
  sendGmailMessage,
  toGmailRawMessage,
} from "@/lib/server/gmail-client"
import {
  deleteComposeAttachmentFile,
  deleteComposeAttachmentMeta,
  loadComposeAttachmentMeta,
  readComposeAttachmentFile,
} from "@/lib/server/compose-attachment-store"
import { IntegrationStatus, MailProvider, MessageDirection } from "@prisma/client"

export const dynamic = "force-dynamic"

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function parseSendPayload(request: NextRequest) {
  const contentType = request.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData()
    const attachmentIdsRaw = formData.get("attachmentIds")
    let attachmentIds: string[] = []
    if (typeof attachmentIdsRaw === "string" && attachmentIdsRaw.trim()) {
      try {
        attachmentIds = JSON.parse(attachmentIdsRaw) as string[]
      } catch {
        attachmentIds = attachmentIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
      }
    }

    return {
      inboxId: String(formData.get("inboxId") || "").trim() || undefined,
      to: String(formData.get("to") || "").trim(),
      subject: String(formData.get("subject") || "").trim(),
      body: String(formData.get("body") || "").trim(),
      conversationId: String(formData.get("conversationId") || "").trim() || undefined,
      attachmentIds,
    }
  }

  const body = (await request.json()) as {
    inboxId?: string
    to?: string
    subject?: string
    body?: string
    conversationId?: string
    attachmentIds?: string[]
  }

  return {
    inboxId: body.inboxId,
    to: (body.to || "").trim(),
    subject: (body.subject || "").trim(),
    body: (body.body || "").trim(),
    conversationId: body.conversationId,
    attachmentIds: body.attachmentIds || [],
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const payload = await parseSendPayload(request)
    const { to, subject, messageBody } = {
      to: payload.to,
      subject: payload.subject,
      messageBody: payload.body,
    }

    if (!to || !isValidEmail(to)) {
      return NextResponse.json({ error: "Valid recipient email is required" }, { status: 400 })
    }
    if (!subject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 })
    }
    if (!messageBody) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 })
    }

    let inboxId = payload.inboxId
    if (!inboxId) {
      const primaryInbox = await prisma.inbox.findFirst({
        where: { workspaceId: session.workspaceId, kind: "PRIMARY" },
        select: { id: true },
      })
      inboxId = primaryInbox?.id
    }
    if (!inboxId) {
      return NextResponse.json({ error: "No inbox found" }, { status: 400 })
    }

    const integration = await prisma.mailIntegration.findFirst({
      where: {
        inboxId,
        workspaceId: session.workspaceId,
        provider: MailProvider.GMAIL,
        status: IntegrationStatus.CONNECTED,
      },
    })
    if (!integration?.accessToken) {
      return NextResponse.json(
        { error: "Gmail is not connected. Connect Gmail in the sidebar first." },
        { status: 400 }
      )
    }

    const accessToken = await getValidGmailAccessToken(integration)
    const fromEmail = integration.externalEmail || "me"

    let threadId: string | undefined
    let inReplyTo: string | undefined
    let references: string | undefined
    let conversationId = payload.conversationId

    if (conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId: session.workspaceId, inboxId },
        include: {
          messages: {
            where: { direction: MessageDirection.INBOUND },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })
      if (conversation) {
        threadId = conversation.providerThreadId || undefined
        const latestInbound = conversation.messages[0]
        if (latestInbound?.providerMessageId) {
          const messageId = `<${latestInbound.providerMessageId}@mail.gmail.com>`
          inReplyTo = messageId
          references = messageId
        }
      }
    } else {
      const existingThread = await prisma.conversation.findFirst({
        where: {
          workspaceId: session.workspaceId,
          inboxId,
          replyTo: to,
          sourceProvider: MailProvider.GMAIL,
          providerThreadId: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })
      if (existingThread) {
        conversationId = existingThread.id
        threadId = existingThread.providerThreadId || undefined
        const latest = existingThread.messages[0]
        if (latest?.providerMessageId) {
          const messageId = `<${latest.providerMessageId}@mail.gmail.com>`
          inReplyTo = messageId
          references = messageId
        }
      }
    }

    const attachmentFiles: Array<{ fileName: string; mimeType: string; data: Buffer }> = []
    for (const attachmentId of payload.attachmentIds) {
      const meta = await loadComposeAttachmentMeta(session.workspaceId, attachmentId)
      if (!meta) continue
      const data = await readComposeAttachmentFile(meta.storagePath)
      attachmentFiles.push({
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        data,
      })
    }

    const emailParams = {
      from: fromEmail,
      to,
      subject,
      body: messageBody,
      inReplyTo,
      references,
    }

    const rawMessage =
      attachmentFiles.length > 0
        ? buildMultipartEmail({ ...emailParams, attachments: attachmentFiles })
        : buildPlainTextEmail(emailParams)

    const sent = await sendGmailMessage({
      accessToken,
      raw: toGmailRawMessage(rawMessage),
      threadId,
    })

    for (const attachmentId of payload.attachmentIds) {
      const meta = await loadComposeAttachmentMeta(session.workspaceId, attachmentId)
      if (!meta) continue
      await deleteComposeAttachmentFile(meta.storagePath)
      await deleteComposeAttachmentMeta(session.workspaceId, attachmentId)
    }

    if (conversationId) {
      await prisma.message.create({
        data: {
          workspaceId: session.workspaceId,
          conversationId,
          direction: MessageDirection.OUTBOUND,
          sourceProvider: MailProvider.GMAIL,
          providerMessageId: sent.id,
          providerThreadId: sent.threadId,
          body: messageBody,
          bodyText: messageBody,
          gmailLabelIds: sent.labelIds || ["SENT"],
        },
      })
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          preview: messageBody.replace(/\s+/g, " ").trim().slice(0, 220),
          folderId: "sent",
          finalReplyDraft: messageBody,
          finalReplyStatus: "SENT",
          finalReplySentAt: new Date(),
          updatedAt: new Date(),
        },
      })
    } else {
      await prisma.conversation.create({
        data: {
          workspaceId: session.workspaceId,
          inboxId,
          folderId: "sent",
          status: "OPEN",
          subject,
          senderName: "You",
          senderEmail: fromEmail,
          preview: messageBody.replace(/\s+/g, " ").trim().slice(0, 220),
          replyTo: to,
          read: true,
          labels: [],
          sourceProvider: MailProvider.GMAIL,
          providerThreadId: sent.threadId,
          messages: {
            create: {
              workspaceId: session.workspaceId,
              direction: MessageDirection.OUTBOUND,
              sourceProvider: MailProvider.GMAIL,
              providerMessageId: sent.id,
              providerThreadId: sent.threadId,
              body: messageBody,
              bodyText: messageBody,
              gmailLabelIds: sent.labelIds || ["SENT"],
            },
          },
        },
      })
    }

    return NextResponse.json({
      success: true,
      messageId: sent.id,
      threadId: sent.threadId,
    })
  } catch (error) {
    console.error("Send email error:", error)
    return NextResponse.json(
      {
        error: "Failed to send email",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
