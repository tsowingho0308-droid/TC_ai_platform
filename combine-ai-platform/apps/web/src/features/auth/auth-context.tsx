"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import {
  getRequestPath,
  redirectToLoginForUnauthorized,
  shouldRedirectUnauthorizedApi,
} from "@/features/auth/handle-api-unauthorized"

interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  workspaceId: string
  workspaceName: string
  uiLanguage: string
}

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refreshSession: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const redirectingRef = useRef(false)

  async function refreshSession() {
    try {
      const res = await fetch("/api/auth/session")
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    setUser(null)
    window.location.href = "/login"
  }

  useEffect(() => {
    refreshSession()
  }, [])

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      const path = getRequestPath(input)

      if (
        response.status === 401 &&
        shouldRedirectUnauthorizedApi(path) &&
        !redirectingRef.current
      ) {
        redirectingRef.current = true
        setUser(null)
        await redirectToLoginForUnauthorized()
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
