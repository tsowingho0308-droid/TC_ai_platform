import { NextResponse } from "next/server"
import { getLoginOAuthScopeString } from "@/lib/server/google-oauth"

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback"

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)" },
      { status: 500 }
    )
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: getLoginOAuthScopeString(),
    access_type: "offline",
    prompt: "consent",
  })

  return NextResponse.json({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  })
}
