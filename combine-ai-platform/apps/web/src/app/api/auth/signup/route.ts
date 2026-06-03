import { NextResponse } from "next/server"
import { signToken, createSessionSetCookie } from "@combine-ai/auth"

export async function POST(request: Request) {
  try {
    const { email, password, name, workspaceName } = await request.json() as {
      email?: string
      password?: string
      name?: string
      workspaceName?: string
    }

    if (!email || !password || !name || !workspaceName) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 })
    }

    // TODO: Implement actual user/workspace creation with Prisma
    const token = await signToken({
      sub: `user-${Date.now()}`,
      email,
      name,
      role: "ADMIN",
      workspaceId: `ws-${Date.now()}`,
      accountId: `acct-${Date.now()}`,
    })

    const response = NextResponse.json({ success: true })
    response.headers.set("Set-Cookie", createSessionSetCookie(token))
    return response
  } catch (error) {
    console.error("Signup error:", error)
    return NextResponse.json({ error: "Registration failed" }, { status: 500 })
  }
}
