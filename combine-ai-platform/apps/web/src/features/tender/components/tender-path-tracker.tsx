"use client"

import { Suspense, useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { setTenderLastPath } from "@/features/tender/lib/tender-workspace-store"

function TenderPathTrackerInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const search = searchParams.toString()
    const path = search ? `${pathname}?${search}` : pathname
    setTenderLastPath(path)
  }, [pathname, searchParams])

  return children
}

export function TenderPathTracker({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <TenderPathTrackerInner>{children}</TenderPathTrackerInner>
    </Suspense>
  )
}
