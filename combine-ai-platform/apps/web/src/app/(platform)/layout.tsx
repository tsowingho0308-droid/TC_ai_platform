"use client"

import { FinanceBackgroundAnalysis } from "@/features/finance/components/finance-background-analysis"
import { AuthProvider, useAuth } from "@/features/auth/auth-context"
import { AppSidebar } from "@/components/app-sidebar"
import { GlobalSearchBar } from "@/features/search/components/global-search-bar"
import { redirect } from "next/navigation"
import { useEffect } from "react"

function PlatformLayoutInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) {
      redirect("/login")
    }
  }, [user, loading])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null // redirect happens in useEffect
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top Navigation Bar with Global Search */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Combine AI</span>
        </div>
        <div className="flex items-center gap-3">
          <GlobalSearchBar />
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        <FinanceBackgroundAnalysis />
        <AppSidebar />
        <main className="flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PlatformLayoutInner>{children}</PlatformLayoutInner>
    </AuthProvider>
  )
}
