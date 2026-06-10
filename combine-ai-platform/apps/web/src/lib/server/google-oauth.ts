import { prisma } from "@/lib/server/prisma"
import { AuthProvider } from "@prisma/client"

export type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

export type GoogleUserInfo = {
  id: string
  email: string
  name?: string
  picture?: string
}

export const GMAIL_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
] as const

export const LOGIN_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  ...GMAIL_OAUTH_SCOPES,
] as const

export function getGmailOAuthScopeString() {
  return GMAIL_OAUTH_SCOPES.join(" ")
}

export function getLoginOAuthScopeString() {
  return LOGIN_OAUTH_SCOPES.join(" ")
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured")
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })

  const tokens = (await response.json()) as GoogleTokenResponse
  if (!response.ok || !tokens.access_token) {
    throw new Error(tokens.error_description || tokens.error || "Failed to exchange authorization code")
  }
  return tokens
}

export function assertGmailScopesGranted(scope?: string) {
  const grantedScopes = (scope || "").split(" ").filter(Boolean)
  const hasGmailScope = grantedScopes.some((s) => s.includes("gmail"))
  if (!hasGmailScope) {
    throw new Error("Gmail permissions not granted — sign in again and allow all permissions")
  }
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error("Failed to fetch Google profile")
  }
  const data = (await response.json()) as Partial<GoogleUserInfo>
  if (!data.id || !data.email) {
    throw new Error("Google profile is missing required fields")
  }
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture,
  }
}

export async function ensureGoogleAuthUser(profile: GoogleUserInfo) {
  const existingIdentity = await prisma.authIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: AuthProvider.GOOGLE,
        providerAccountId: profile.id,
      },
    },
    include: { user: true },
  })
  if (existingIdentity) return existingIdentity.user

  const existingByEmail = await prisma.user.findUnique({ where: { email: profile.email } })
  if (existingByEmail) {
    await prisma.authIdentity.upsert({
      where: {
        userId_provider: { userId: existingByEmail.id, provider: AuthProvider.GOOGLE },
      },
      update: { providerAccountId: profile.id },
      create: {
        userId: existingByEmail.id,
        provider: AuthProvider.GOOGLE,
        providerAccountId: profile.id,
      },
    })
    return existingByEmail
  }

  const workspaceId = process.env.GOOGLE_LOGIN_WORKSPACE_ID || "demo-workspace"
  const accountId = process.env.GOOGLE_LOGIN_ACCOUNT_ID || "demo-account"

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace) {
    throw new Error("Workspace not found — run db:seed first")
  }

  const user = await prisma.user.create({
    data: {
      accountId,
      workspaceId,
      email: profile.email,
      name: profile.name?.trim() || profile.email.split("@")[0],
      role: "AGENT",
    },
  })

  await prisma.authIdentity.create({
    data: {
      userId: user.id,
      provider: AuthProvider.GOOGLE,
      providerAccountId: profile.id,
    },
  })

  return user
}

export async function getPrimaryInbox(workspaceId: string) {
  return prisma.inbox.findFirst({
    where: { workspaceId, kind: "PRIMARY" },
    orderBy: { createdAt: "asc" },
  })
}

const PRESERVED_CONVERSATION_ID_PREFIX = "test-email-"

export async function clearGmailMailboxDataForWorkspace(workspaceId: string) {
  await prisma.conversation.deleteMany({
    where: {
      workspaceId,
      NOT: {
        id: { startsWith: PRESERVED_CONVERSATION_ID_PREFIX },
      },
    },
  })
}

export async function clearGmailSyncedConversationsForInbox(inboxId: string) {
  await prisma.conversation.deleteMany({
    where: {
      inboxId,
      sourceProvider: "GMAIL",
    },
  })
}

export async function upsertGmailIntegration(params: {
  workspaceId: string
  inboxId: string
  accessToken: string
  refreshToken?: string | null
  scopes: string[]
  tokenExpiresAt: Date | null
  externalEmail: string | null
}) {
  const existing = await prisma.mailIntegration.findUnique({
    where: { inboxId_provider: { inboxId: params.inboxId, provider: "GMAIL" } },
    select: { externalEmail: true },
  })

  const previousEmail = existing?.externalEmail?.trim().toLowerCase() || null
  const nextEmail = params.externalEmail?.trim().toLowerCase() || null
  if (existing && previousEmail && nextEmail && previousEmail !== nextEmail) {
    await clearGmailMailboxDataForWorkspace(params.workspaceId)
  }

  await prisma.mailIntegration.upsert({
    where: { inboxId_provider: { inboxId: params.inboxId, provider: "GMAIL" } },
    update: {
      status: "CONNECTED",
      accessToken: params.accessToken,
      refreshToken: params.refreshToken || undefined,
      scopes: params.scopes,
      tokenExpiresAt: params.tokenExpiresAt,
      externalEmail: params.externalEmail,
      lastSyncError: null,
    },
    create: {
      workspaceId: params.workspaceId,
      inboxId: params.inboxId,
      provider: "GMAIL",
      status: "CONNECTED",
      accessToken: params.accessToken,
      refreshToken: params.refreshToken || null,
      scopes: params.scopes,
      tokenExpiresAt: params.tokenExpiresAt,
      externalEmail: params.externalEmail,
    },
  })
}
