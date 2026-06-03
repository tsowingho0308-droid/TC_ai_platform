import { cookies } from "next/headers"
import { verifyToken, type JwtPayload } from "@combine-ai/auth"

export async function getSession(): Promise<JwtPayload | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get("combine_ai_session")
  if (!session?.value) return null
  return verifyToken(session.value)
}

export async function requireSession(): Promise<JwtPayload> {
  const session = await getSession()
  if (!session) throw new Error("Unauthorized")
  return session
}
