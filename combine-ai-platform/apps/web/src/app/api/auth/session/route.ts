import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@combine-ai/auth"

export const dynamic = "force-dynamic"

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get("combine_ai_session")

  if (!session?.value) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const payload = await verifyToken(session.value)
  if (!payload) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({
    user: {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      workspaceId: payload.workspaceId,
      workspaceName: ((payload as unknown as Record<string, unknown>).workspaceName as string) || "",
      uiLanguage: "zh-HK",
    },
  })
}
