import { NextResponse } from "next/server"

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const redirectUri = process.env.GOOGLE_AUTH_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback"

  if (!clientId) {
    return NextResponse.json({
      url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=demo&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid+email+profile&access_type=offline&prompt=consent`
    })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  })

  return NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
}
