import { NextResponse } from "next/server"
import { signToken, createSessionSetCookie } from "@combine-ai/auth"

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json() as { email?: string; password?: string }

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
    }

    // TODO: Implement actual database authentication with Prisma
    // For now, create a demo session
    const token = await signToken({
      sub: "demo-user-1",
      email,
      name: email.split("@")[0],
      role: "ADMIN",
      workspaceId: "demo-workspace",
      accountId: "demo-account",
    })

    const response = NextResponse.json({ success: true })
    response.headers.set("Set-Cookie", createSessionSetCookie(token))
    return response
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 })
  }
}
