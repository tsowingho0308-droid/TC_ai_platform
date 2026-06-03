import { NextResponse, type NextRequest } from "next/server"
import { signToken, createSessionSetCookie } from "@combine-ai/auth"

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", request.url))
  }

  try {
    // TODO: Exchange code for Google tokens and fetch user info
    // For now, create a demo session
    const token = await signToken({
      sub: "google-user-1",
      email: "user@gmail.com",
      name: "Google User",
      role: "ADMIN",
      workspaceId: "demo-workspace",
      accountId: "demo-account",
    })

    const response = NextResponse.redirect(new URL("/dashboard", request.url))
    response.headers.set("Set-Cookie", createSessionSetCookie(token))
    return response
  } catch (error) {
    console.error("Google callback error:", error)
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url))
  }
}
