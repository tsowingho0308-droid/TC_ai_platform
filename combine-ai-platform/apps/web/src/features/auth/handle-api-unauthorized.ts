export const SESSION_EXPIRED_MESSAGE = "登录已过期，请重新登录"

export function isUnauthorizedResponse(response: Response): boolean {
  return response.status === 401
}

export function shouldRedirectUnauthorizedApi(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false
  if (pathname.startsWith("/api/auth/session")) return false
  if (pathname.startsWith("/api/auth/login")) return false
  if (pathname.startsWith("/api/auth/signup")) return false
  if (pathname.startsWith("/api/auth/logout")) return false
  return true
}

export function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input.startsWith("http") ? new URL(input).pathname : input
  }
  if (input instanceof URL) return input.pathname
  return new URL(input.url).pathname
}

export async function redirectToLoginForUnauthorized(
  refreshSession?: () => Promise<void>
): Promise<void> {
  if (refreshSession) {
    await refreshSession().catch(() => {})
  }
  window.location.href = "/login?reason=session_expired"
}

export async function handleUnauthorizedResponse(
  response: Response,
  refreshSession?: () => Promise<void>
): Promise<boolean> {
  if (!isUnauthorizedResponse(response)) return false
  await redirectToLoginForUnauthorized(refreshSession)
  return true
}

export function getApiErrorMessage(
  response: Response,
  errData?: { error?: string; detail?: string }
): string {
  if (isUnauthorizedResponse(response)) return SESSION_EXPIRED_MESSAGE
  return errData?.detail || errData?.error || `Server error: ${response.status}`
}
