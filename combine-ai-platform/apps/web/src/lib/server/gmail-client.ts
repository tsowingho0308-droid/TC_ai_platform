import { prisma } from "@/lib/server/prisma"
import { IntegrationStatus } from "@prisma/client"

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type GmailSendResponse = {
  id: string
  threadId: string
  labelIds?: string[]
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

export async function getValidGmailAccessToken(integration: {
  inboxId: string
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: Date | null
}) {
  if (!integration.accessToken) throw new Error("Google access token is missing")
  const expiresSoon = integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() <= Date.now() + 60_000
  if (!expiresSoon) return integration.accessToken
  if (!integration.refreshToken) throw new Error("Google refresh token is missing — reconnect Gmail")
  return refreshAccessToken(integration.inboxId, integration.refreshToken)
}

function encodeGmailRaw(message: string) {
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function encodeHeaderValue(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) return value
  const encoded = Buffer.from(value, "utf8").toString("base64")
  return `=?UTF-8?B?${encoded}?=`
}

function normalizeBodyLines(body: string) {
  return body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n")
}

function buildEmailHeaders(params: {
  from: string
  to: string
  subject: string
  contentType: string
  inReplyTo?: string
  references?: string
}) {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeHeaderValue(params.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${params.contentType}`,
  ]
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`)
  if (params.references) lines.push(`References: ${params.references}`)
  return lines
}

function encodeAttachmentFileName(fileName: string) {
  if (/^[\x20-\x7E]*$/.test(fileName)) return `filename="${fileName}"`
  return `filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export function buildPlainTextEmail(params: {
  from: string
  to: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
}) {
  const lines = buildEmailHeaders({
    from: params.from,
    to: params.to,
    subject: params.subject,
    contentType: 'text/plain; charset="UTF-8"',
    inReplyTo: params.inReplyTo,
    references: params.references,
  })
  lines.push('Content-Transfer-Encoding: 8bit', "", normalizeBodyLines(params.body))
  return lines.join("\r\n")
}

export function buildMultipartEmail(params: {
  from: string
  to: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
  attachments: Array<{ fileName: string; mimeType: string; data: Buffer }>
}) {
  const boundary = `combine_ai_${Date.now().toString(36)}`
  const lines = buildEmailHeaders({
    from: params.from,
    to: params.to,
    subject: params.subject,
    contentType: `multipart/mixed; boundary="${boundary}"`,
    inReplyTo: params.inReplyTo,
    references: params.references,
  })

  lines.push(
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    normalizeBodyLines(params.body)
  )

  for (const attachment of params.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.fileName}"`,
      `Content-Disposition: attachment; ${encodeAttachmentFileName(attachment.fileName)}`,
      "Content-Transfer-Encoding: base64",
      "",
      attachment.data.toString("base64")
    )
  }

  lines.push(`--${boundary}--`)
  return lines.join("\r\n")
}

export async function sendGmailMessage(params: {
  accessToken: string
  raw: string
  threadId?: string
}) {
  const payload: { raw: string; threadId?: string } = { raw: params.raw }
  if (params.threadId) payload.threadId = params.threadId

  return gmailApi<GmailSendResponse>(params.accessToken, "/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function toGmailRawMessage(email: ReturnType<typeof buildPlainTextEmail>) {
  return encodeGmailRaw(email)
}
