import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const action = url.searchParams.get("action")

  switch (action) {
    case "status": {
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

    case "connect-url": {
      const clientId = process.env.GOOGLE_CLIENT_ID
      const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/api/email/integrations?action=callback"

      if (!clientId) {
        return NextResponse.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 500 })
      }

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        access_type: "offline",
        prompt: "consent",
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
      case "callback": {
        const body = await request.json() as { code?: string; inboxId?: string }
        if (!body.code || !body.inboxId) {
          return NextResponse.json({ error: "code and inboxId required" }, { status: 400 })
        }

        // Exchange code for tokens with Google
        // TODO: Implement actual Google token exchange
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: body.code,
            client_id: process.env.GOOGLE_CLIENT_ID || "",
            client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
            redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "",
            grant_type: "authorization_code",
          }),
        })

        if (!tokenResponse.ok) {
          return NextResponse.json({ error: "Failed to exchange code with Google" }, { status: 502 })
        }

        const tokens = await tokenResponse.json() as {
          access_token: string
          refresh_token?: string
          expires_in: number
          scope: string
        }

        // Save integration
        const integration = await prisma.mailIntegration.upsert({
          where: { inboxId_provider: { inboxId: body.inboxId, provider: "GMAIL" } },
          update: {
            status: "CONNECTED",
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || undefined,
            scopes: tokens.scope.split(" "),
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          },
          create: {
            workspaceId: session.workspaceId,
            inboxId: body.inboxId,
            provider: "GMAIL",
            status: "CONNECTED",
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            scopes: tokens.scope.split(" "),
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          },
        })

        return NextResponse.json({ integration })
      }

      case "sync": {
        const { inboxId } = await request.json() as { inboxId?: string }
        if (!inboxId) return NextResponse.json({ error: "inboxId required" }, { status: 400 })

        const integration = await prisma.mailIntegration.findFirst({
          where: { inboxId, workspaceId: session.workspaceId, status: "CONNECTED" },
        })
        if (!integration) return NextResponse.json({ error: "No connected integration found" }, { status: 404 })

        // Create a sync run record
        const syncRun = await prisma.gmailSyncRun.create({
          data: {
            workspaceId: session.workspaceId,
            integrationId: integration.id,
            status: "PENDING",
            triggerSource: "manual",
            initiatedById: session.sub,
          },
        })

        return NextResponse.json({
          syncRun,
          message: "Sync initiated. Poll GET /api/email/integrations?action=sync-status&runId=" + syncRun.id,
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
