import { NextResponse, type NextRequest } from "next/server"
import { signToken, createSessionSetCookie } from "@combine-ai/auth"
import {
  assertGmailScopesGranted,
  ensureGoogleAuthUser,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getPrimaryInbox,
  upsertGmailIntegration,
} from "@/lib/server/google-oauth"

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const oauthError = url.searchParams.get("error")
  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(oauthError)}`, request.url)
    )
  }

  const code = url.searchParams.get("code")
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", request.url))
  }

  const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback"

  try {
    const tokens = await exchangeGoogleCode(code, redirectUri)
    assertGmailScopesGranted(tokens.scope)

    const profile = await fetchGoogleUserInfo(tokens.access_token!)
    const user = await ensureGoogleAuthUser(profile)

    const primaryInbox = await getPrimaryInbox(user.workspaceId)
    if (!primaryInbox) {
      throw new Error("Primary inbox not found for this workspace")
    }

    await upsertGmailIntegration({
      workspaceId: user.workspaceId,
      inboxId: primaryInbox.id,
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      scopes: (tokens.scope || "").split(" ").filter(Boolean),
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      externalEmail: profile.email,
    })

    const token = await signToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      workspaceId: user.workspaceId,
      accountId: user.accountId,
    })

    const response = NextResponse.redirect(new URL("/email?gmail=connected", request.url))
    response.headers.set("Set-Cookie", createSessionSetCookie(token))
    return response
  } catch (error) {
    console.error("Google callback error:", error)
    const message = error instanceof Error ? error.message : "auth_failed"
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url)
    )
  }
}
