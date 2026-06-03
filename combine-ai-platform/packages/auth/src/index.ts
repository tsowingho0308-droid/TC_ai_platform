// Auth package - JWT utilities for Next.js middleware and API routes

import { SignJWT, jwtVerify } from "jose"

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-me"
)

const SESSION_DURATION = "7d"

export interface JwtPayload {
  sub: string
  email: string
  name: string
  role: string
  workspaceId: string
  accountId: string
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JwtPayload
  } catch {
    return null
  }
}

export function parseSessionCookie(
  cookieHeader: string | null,
  cookieName = "combine_ai_session"
): string | null {
  if (!cookieHeader) return null
  for (const cookie of cookieHeader.split(";")) {
    const [name, ...rest] = cookie.trim().split("=")
    if (name === cookieName) {
      return rest.join("=").trim()
    }
  }
  return null
}

export function createSessionSetCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE !== "false"
  const sameSite = (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax"
  const securePart = secure ? "; Secure" : ""
  return `combine_ai_session=${token}; HttpOnly; Path=/; SameSite=${sameSite}; Max-Age=604800${securePart}`
}

export function createLogoutCookie(): string {
  return `combine_ai_session=; HttpOnly; Path=/; SameSite=lax; Max-Age=0`
}
