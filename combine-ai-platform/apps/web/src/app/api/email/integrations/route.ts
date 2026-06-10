import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { IntegrationStatus, MailProvider, MessageDirection } from "@prisma/client"
import {
  buildAttachmentStoragePath,
  saveAttachmentFile,
} from "@/lib/server/email-attachment-store"
import {
  assertGmailScopesGranted,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getGmailOAuthScopeString,
  upsertGmailIntegration,
  type GoogleTokenResponse,
} from "@/lib/server/google-oauth"

export const dynamic = "force-dynamic"

type OAuthStatePayload = {
  workspaceId: string
  inboxId: string
  actorId: string
  issuedAt: number
}

type GmailListMessagesResponse = {
  messages?: Array<{ id: string; threadId: string }>
}

type GmailMessagePart = {
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailMessagePart[]
}

type GmailAttachmentMeta = {
  fileName: string
  mimeType: string
  attachmentId: string
  sizeBytes: number
  contentId?: string | null
}

type GmailAttachmentResponse = {
  data?: string
  size?: number
}

type GmailMessageDetailResponse = {
  id: string
  threadId: string
  internalDate?: string
  labelIds?: string[]
  snippet?: string
  payload?: {
    headers?: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: GmailMessagePart[]
  }
}

type GmailThreadResponse = {
  id: string
  historyId?: string
  messages?: GmailMessageDetailResponse[]
}

function getStateSecret() {
  return process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.JWT_SECRET || "combine-ai-oauth-state-dev"
}

function encodeState(payload: OAuthStatePayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", getStateSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

function decodeState(raw: string): OAuthStatePayload {
  const dotIndex = raw.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex >= raw.length - 1) {
    throw new Error("OAuth link expired — click Connect again")
  }
  const body = raw.slice(0, dotIndex)
  const sig = raw.slice(dotIndex + 1)
  const expected = createHmac("sha256", getStateSecret()).update(body).digest("base64url")
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("OAuth link expired — click Connect again")
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload
  if (!payload.workspaceId || !payload.inboxId || !payload.actorId || !payload.issuedAt) {
    throw new Error("OAuth link expired — click Connect again")
  }
  if (Date.now() - payload.issuedAt > 60 * 60 * 1000) {
    throw new Error("OAuth link expired — click Connect again")
  }
  return payload
}

function parseSender(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return { name: "Unknown sender", email: "unknown@example.com" }
  const match = trimmed.match(/^(.*)<([^>]+)>$/)
  if (!match) return { name: trimmed.replace(/"/g, ""), email: trimmed }
  return { name: match[1]?.replace(/"/g, "").trim() || match[2].trim(), email: match[2].trim() }
}

function getHeader(message: GmailMessageDetailResponse, headerName: string) {
  const headers = message.payload?.headers || []
  return headers.find((h) => h.name.toLowerCase() === headerName.toLowerCase())?.value?.trim() || ""
}

function decodeBase64Url(data?: string) {
  if (!data) return null
  try {
    return Buffer.from(data, "base64url").toString("utf8").trim() || null
  } catch {
    return null
  }
}

function collectBodies(message: GmailMessageDetailResponse) {
  const textParts: string[] = []
  const htmlParts: string[] = []
  const visit = (part?: GmailMessagePart) => {
    if (!part) return
    const mime = (part.mimeType || "").toLowerCase()
    const decoded = decodeBase64Url(part.body?.data)
    if (decoded) {
      if (mime.startsWith("text/plain")) textParts.push(decoded)
      else if (mime.startsWith("text/html")) htmlParts.push(decoded)
    }
    for (const child of part.parts || []) visit(child)
  }
  visit(message.payload as GmailMessagePart | undefined)
  return {
    text: textParts.join("\n\n").trim() || null,
    html: htmlParts.join("\n\n").trim() || null,
  }
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function getPartHeader(part: GmailMessagePart, headerName: string) {
  const headers = part.headers || []
  return headers.find((h) => h.name.toLowerCase() === headerName.toLowerCase())?.value?.trim() || ""
}

function normalizeContentId(value: string) {
  return value.replace(/^<|>$/g, "").trim()
}

function normalizeAttachmentFileName(fileName: string) {
  return fileName.trim().toLowerCase()
}

function buildAttachmentRecordId(messageId: string, attachmentId: string) {
  return createHash("sha256")
    .update(`${messageId}:${attachmentId}`)
    .digest("hex")
    .slice(0, 32)
}

function collectAttachments(message: GmailMessageDetailResponse): GmailAttachmentMeta[] {
  const byAttachmentId = new Map<string, GmailAttachmentMeta>()
  const byFileName = new Map<string, GmailAttachmentMeta>()
  const visit = (part?: GmailMessagePart) => {
    if (!part) return
    const attachmentId = part.body?.attachmentId
    const mimeType = part.mimeType || "application/octet-stream"
    const mimeLower = mimeType.toLowerCase()
    const fileName = part.filename?.trim()
    const contentIdRaw = getPartHeader(part, "Content-ID")
    const contentId = contentIdRaw ? normalizeContentId(contentIdRaw) : null

    if (attachmentId && (fileName || mimeLower.startsWith("image/") || mimeLower === "application/pdf")) {
      const ext = mimeLower.split("/")[1]?.split("+")[0] || "bin"
      const resolvedName = fileName || contentId || `inline-${attachmentId.slice(0, 12)}.${ext}`
      const normalizedName = fileName ? normalizeAttachmentFileName(resolvedName) : null

      // Gmail MIME trees can expose the same file in multiple parts with different attachmentIds.
      if (normalizedName && byFileName.has(normalizedName)) {
        const existing = byFileName.get(normalizedName)!
        if (!existing.contentId && contentId) {
          byFileName.set(normalizedName, { ...existing, contentId })
          byAttachmentId.set(existing.attachmentId, { ...existing, contentId })
        }
      } else {
        const next: GmailAttachmentMeta = {
          fileName: resolvedName,
          mimeType,
          attachmentId,
          sizeBytes: part.body?.size || 0,
          contentId,
        }
        const existing = byAttachmentId.get(attachmentId)
        if (!existing) {
          byAttachmentId.set(attachmentId, next)
          if (normalizedName) byFileName.set(normalizedName, next)
        } else if (!existing.fileName && next.fileName) {
          const merged = {
            ...existing,
            fileName: next.fileName,
            contentId: existing.contentId || next.contentId,
          }
          byAttachmentId.set(attachmentId, merged)
          if (normalizedName) byFileName.set(normalizedName, merged)
        }
      }
    }
    for (const child of part.parts || []) visit(child)
  }
  visit(message.payload as GmailMessagePart | undefined)
  return Array.from(byAttachmentId.values())
}

async function downloadGmailAttachment(accessToken: string, messageId: string, attachmentId: string) {
  const response = await gmailApi<GmailAttachmentResponse>(
    accessToken,
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  )
  if (!response.data) return null
  return Buffer.from(response.data, "base64url")
}

async function dedupeStoredAttachments(workspaceId: string) {
  const attachments = await prisma.messageAttachment.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, messageId: true, providerAttachmentId: true, fileName: true },
  })

  const seenProviderIds = new Set<string>()
  const seenFileNames = new Set<string>()
  const duplicateIds: string[] = []
  for (const att of attachments) {
    const providerKey =
      att.providerAttachmentId != null
        ? `${att.messageId}:${att.providerAttachmentId}`
        : null
    const fileNameKey = att.fileName.trim()
      ? `${att.messageId}:${normalizeAttachmentFileName(att.fileName)}`
      : null

    const isDuplicate =
      (providerKey != null && seenProviderIds.has(providerKey)) ||
      (fileNameKey != null && seenFileNames.has(fileNameKey))

    if (isDuplicate) {
      duplicateIds.push(att.id)
      continue
    }

    if (providerKey) seenProviderIds.add(providerKey)
    if (fileNameKey) seenFileNames.add(fileNameKey)
  }

  if (duplicateIds.length > 0) {
    await prisma.messageAttachment.deleteMany({
      where: { id: { in: duplicateIds } },
    })
  }
}

async function syncMessageAttachments(params: {
  workspaceId: string
  conversationId: string
  messageId: string
  gmailMessageId: string
  accessToken: string
  attachments: GmailAttachmentMeta[]
}) {
  for (const att of params.attachments) {
    const existing = await prisma.messageAttachment.findFirst({
      where: {
        workspaceId: params.workspaceId,
        messageId: params.messageId,
        OR: [
          { providerAttachmentId: att.attachmentId },
          ...(att.fileName.trim()
            ? [{ fileName: { equals: att.fileName, mode: "insensitive" as const } }]
            : []),
        ],
      },
    })
    if (existing) {
      await prisma.messageAttachment.update({
        where: { id: existing.id },
        data: {
          fileName: att.fileName,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes || existing.sizeBytes,
          contentId: att.contentId || existing.contentId,
          providerAttachmentId: existing.providerAttachmentId || att.attachmentId,
        },
      })
      continue
    }

    const buffer = await downloadGmailAttachment(params.accessToken, params.gmailMessageId, att.attachmentId)
    if (!buffer || buffer.length === 0) continue

    const recordId = buildAttachmentRecordId(params.messageId, att.attachmentId)
    const storagePath = buildAttachmentStoragePath(params.workspaceId, recordId, att.fileName)
    await saveAttachmentFile(storagePath, buffer)

    await prisma.messageAttachment.create({
      data: {
        id: recordId,
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sizeBytes: buffer.length,
        storagePath,
        sourceProvider: MailProvider.GMAIL,
        providerMessageId: params.gmailMessageId,
        providerAttachmentId: att.attachmentId,
        contentId: att.contentId || null,
      },
    })
  }
}

function mapFolder(labelIds: string[]) {
  if (labelIds.includes("TRASH")) return "trash"
  if (labelIds.includes("DRAFT")) return "drafts"
  if (labelIds.includes("INBOX")) return "inbox"
  if (labelIds.includes("SENT")) return "sent"
  return "archive"
}

async function gmailApi<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${accessToken}`)
  headers.set("Accept", "application/json")
  const response = await fetch(`https://gmail.googleapis.com${path}`, { ...init, headers })
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300)
    throw new Error(`Gmail API failed (${response.status}): ${detail}`)
  }
  return response.json() as Promise<T>
}

async function refreshAccessToken(inboxId: string, refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const data = (await response.json()) as GoogleTokenResponse
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to refresh Google token")
  }
  await prisma.mailIntegration.update({
    where: { inboxId_provider: { inboxId, provider: "GMAIL" } },
    data: {
      accessToken: data.access_token,
      tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      status: IntegrationStatus.CONNECTED,
      lastSyncError: null,
    },
  })
  return data.access_token
}

async function getValidAccessToken(integration: {
  inboxId: string
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
}) {
  if (!integration.accessToken) throw new Error("Google access token is missing")
  const expiresSoon = integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() <= Date.now() + 60_000
  if (!expiresSoon) return integration.accessToken
  if (!integration.refreshToken) throw new Error("Google refresh token is missing")
  return refreshAccessToken(integration.inboxId, integration.refreshToken)
}

async function runManualSync(params: {
  workspaceId: string
  inboxId: string
  accessToken: string
  externalEmail: string | null
}) {
  // Drop legacy thread-grouped Gmail rows (pre per-message sync)
  await prisma.conversation.deleteMany({
    where: {
      workspaceId: params.workspaceId,
      inboxId: params.inboxId,
      sourceProvider: MailProvider.GMAIL,
      providerMessageId: null,
    },
  })

  await dedupeStoredAttachments(params.workspaceId)

  const list = await gmailApi<GmailListMessagesResponse>(
    params.accessToken,
    "/gmail/v1/users/me/messages?maxResults=50"
  )
  const threadIds = Array.from(new Set((list.messages || []).map((m) => m.threadId).filter(Boolean)))

  let conversationsCreated = 0
  let conversationsUpdated = 0
  let messagesCreated = 0
  let fetchedMessages = 0
  let cursorEnd: string | null = null

  for (const threadId of threadIds) {
    const thread = await gmailApi<GmailThreadResponse>(
      params.accessToken,
      `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`
    )
    const messages = [...(thread.messages || [])].sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))
    if (!messages.length) continue
    fetchedMessages += messages.length

    for (const msg of messages) {
      const msgLabels = msg.labelIds || []
      const sender = parseSender(getHeader(msg, "From"))
      const subject = getHeader(msg, "Subject") || "(No subject)"
      const replyTo = getHeader(msg, "Reply-To") || sender.email
      const parts = collectBodies(msg)
      const bodyText = parts.text
      const bodyHtml = parts.html
      const body = bodyText || msg.snippet || stripHtml(bodyHtml || "") || "(No body)"
      const preview = (
        bodyText ||
        msg.snippet ||
        stripHtml(bodyHtml || "") ||
        "(No preview)"
      ).replace(/\s+/g, " ").trim().slice(0, 220)

      const existingConversation = await prisma.conversation.findUnique({
        where: {
          inboxId_sourceProvider_providerMessageId: {
            inboxId: params.inboxId,
            sourceProvider: MailProvider.GMAIL,
            providerMessageId: msg.id,
          },
        },
      })

      const conversation = existingConversation
        ? await prisma.conversation.update({
            where: { id: existingConversation.id },
            data: {
              folderId: mapFolder(msgLabels),
              read: !msgLabels.includes("UNREAD"),
              starred: msgLabels.includes("STARRED"),
              senderName: sender.name,
              senderEmail: sender.email,
              subject,
              preview,
              replyTo,
              providerThreadId: thread.id,
            },
          })
        : await prisma.conversation.create({
            data: {
              workspaceId: params.workspaceId,
              inboxId: params.inboxId,
              folderId: mapFolder(msgLabels),
              status: "OPEN",
              subject,
              senderName: sender.name,
              senderEmail: sender.email,
              preview,
              replyTo,
              read: !msgLabels.includes("UNREAD"),
              starred: msgLabels.includes("STARRED"),
              labels: [],
              sourceProvider: MailProvider.GMAIL,
              providerMessageId: msg.id,
              providerThreadId: thread.id,
            },
          })

      if (existingConversation) conversationsUpdated += 1
      else conversationsCreated += 1

      const direction = msgLabels.includes("SENT")
        ? MessageDirection.OUTBOUND
        : MessageDirection.INBOUND

      const existed = await prisma.message.findUnique({
        where: {
          workspaceId_sourceProvider_providerMessageId: {
            workspaceId: params.workspaceId,
            sourceProvider: MailProvider.GMAIL,
            providerMessageId: msg.id,
          },
        },
      })

      const dbMessage = existed
        ? await prisma.message.update({
            where: { id: existed.id },
            data: {
              conversationId: conversation.id,
              body,
              bodyText,
              bodyHtml,
              gmailLabelIds: msgLabels,
            },
          })
        : await prisma.message.create({
            data: {
              workspaceId: params.workspaceId,
              conversationId: conversation.id,
              direction,
              sourceProvider: MailProvider.GMAIL,
              providerMessageId: msg.id,
              providerThreadId: thread.id,
              body,
              bodyText,
              bodyHtml,
              gmailLabelIds: msgLabels,
              createdAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
            },
          })

      if (!existed) messagesCreated += 1

      const attachmentParts = collectAttachments(msg)
      if (attachmentParts.length > 0) {
        await syncMessageAttachments({
          workspaceId: params.workspaceId,
          conversationId: conversation.id,
          messageId: dbMessage.id,
          gmailMessageId: msg.id,
          accessToken: params.accessToken,
          attachments: attachmentParts,
        })
      }
    }

    if (thread.historyId) cursorEnd = thread.historyId
  }

  return {
    fetchedThreads: threadIds.length,
    fetchedMessages,
    conversationsCreated,
    conversationsUpdated,
    messagesCreated,
    cursorEnd,
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const action = url.searchParams.get("action")

  switch (action) {
    case "callback": {
      const code = url.searchParams.get("code")
      const stateRaw = url.searchParams.get("state")
      const frontendRedirect = process.env.GOOGLE_OAUTH_FRONTEND_REDIRECT || "/email"
      if (!code || !stateRaw) {
        return NextResponse.redirect(new URL(`${frontendRedirect}?gmail=error&reason=missing_code_or_state`, request.url))
      }

      try {
        const state = decodeState(stateRaw)
        const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || ""
        const tokens = await exchangeGoogleCode(code, redirectUri)
        assertGmailScopesGranted(tokens.scope)

        const userInfo = await fetchGoogleUserInfo(tokens.access_token!)

        await upsertGmailIntegration({
          workspaceId: state.workspaceId,
          inboxId: state.inboxId,
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token,
          scopes: (tokens.scope || "").split(" ").filter(Boolean),
          tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          externalEmail: userInfo.email,
        })

        return NextResponse.redirect(new URL(`${frontendRedirect}?gmail=connected`, request.url))
      } catch (error) {
        return NextResponse.redirect(
          new URL(`${frontendRedirect}?gmail=error&reason=${encodeURIComponent(error instanceof Error ? error.message : "oauth_failed")}`, request.url)
        )
      }
    }

    case "status": {
      const session = await requireSession().catch(() => null)
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const integrations = await prisma.mailIntegration.findMany({
        where: { workspaceId: session.workspaceId },
        select: {
          id: true,
          inboxId: true,
          provider: true,
          status: true,
          externalEmail: true,
          lastSyncedAt: true,
          lastSyncError: true,
        },
      })
      return NextResponse.json({ integrations })
    }

    case "sync-status": {
      const session = await requireSession().catch(() => null)
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const runId = url.searchParams.get("runId")
      if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 })

      const syncRun = await prisma.gmailSyncRun.findFirst({
        where: { id: runId, workspaceId: session.workspaceId },
      })
      if (!syncRun) return NextResponse.json({ error: "Sync run not found" }, { status: 404 })
      return NextResponse.json({ syncRun })
    }

    case "connect-url": {
      const session = await requireSession().catch(() => null)
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      const clientId = process.env.GOOGLE_CLIENT_ID
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/api/email/integrations?action=callback"
      const inboxId = url.searchParams.get("inboxId")

      if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
        return NextResponse.json({ error: "Google OAuth env is not configured" }, { status: 500 })
      }
      if (!inboxId) return NextResponse.json({ error: "inboxId is required" }, { status: 400 })
      const inbox = await prisma.inbox.findFirst({
        where: { id: inboxId, workspaceId: session.workspaceId },
      })
      if (!inbox) return NextResponse.json({ error: "Inbox not found" }, { status: 404 })

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: getGmailOAuthScopeString(),
        access_type: "offline",
        prompt: "consent",
        state: encodeState({
          workspaceId: session.workspaceId,
          inboxId,
          actorId: session.sub,
          issuedAt: Date.now(),
        }),
      })

      return NextResponse.json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      })
    }

    default:
      return NextResponse.json({ error: "Specify action=status or action=connect-url" }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action")

    switch (action) {
      case "disconnect": {
        const { inboxId } = await request.json() as { inboxId?: string }
        if (!inboxId) return NextResponse.json({ error: "inboxId required" }, { status: 400 })

        await prisma.mailIntegration.deleteMany({
          where: { inboxId, workspaceId: session.workspaceId, provider: "GMAIL" },
        })
        return NextResponse.json({ success: true })
      }

      case "sync": {
        const { inboxId } = await request.json() as { inboxId?: string }
        if (!inboxId) return NextResponse.json({ error: "inboxId required" }, { status: 400 })

        const integration = await prisma.mailIntegration.findFirst({
          where: { inboxId, workspaceId: session.workspaceId, status: "CONNECTED" },
        })
        if (!integration) return NextResponse.json({ error: "No connected integration found" }, { status: 404 })

        const syncRun = await prisma.gmailSyncRun.create({
          data: {
            workspaceId: session.workspaceId,
            integrationId: integration.id,
            status: "PENDING",
            triggerSource: "manual",
            initiatedById: session.sub,
          },
        })

        await prisma.gmailSyncRun.update({
          where: { id: syncRun.id },
          data: { status: "RUNNING", startedAt: new Date() },
        })

        try {
          const accessToken = await getValidAccessToken({
            inboxId: integration.inboxId,
            accessToken: integration.accessToken,
            refreshToken: integration.refreshToken,
            tokenExpiresAt: integration.tokenExpiresAt,
          })

          const result = await runManualSync({
            workspaceId: session.workspaceId,
            inboxId,
            accessToken,
            externalEmail: integration.externalEmail,
          })

          await prisma.gmailSyncRun.update({
            where: { id: syncRun.id },
            data: {
              status: "COMPLETED",
              finishedAt: new Date(),
              cursorStart: integration.gmailHistoryId,
              cursorEnd: result.cursorEnd,
              fetchedThreads: result.fetchedThreads,
              fetchedMessages: result.fetchedMessages,
              conversationsCreated: result.conversationsCreated,
              conversationsUpdated: result.conversationsUpdated,
              messagesCreated: result.messagesCreated,
            },
          })

          await prisma.mailIntegration.update({
            where: { inboxId_provider: { inboxId, provider: "GMAIL" } },
            data: {
              status: "CONNECTED",
              gmailHistoryId: result.cursorEnd || integration.gmailHistoryId,
              lastHistorySyncedAt: result.cursorEnd ? new Date() : integration.lastHistorySyncedAt,
              lastFullSyncAt: new Date(),
              lastSyncedAt: new Date(),
              lastSyncError: null,
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Sync failed"
          await prisma.gmailSyncRun.update({
            where: { id: syncRun.id },
            data: { status: "FAILED", finishedAt: new Date(), error: message },
          })
          await prisma.mailIntegration.update({
            where: { inboxId_provider: { inboxId, provider: "GMAIL" } },
            data: { status: "ERROR", lastSyncError: message },
          })
          return NextResponse.json({
            error: "Sync failed",
            detail: message,
            syncRunId: syncRun.id,
          }, { status: 500 })
        }

        return NextResponse.json({
          syncRunId: syncRun.id,
          message: "Sync completed",
        })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({
      error: "Integration action failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}
