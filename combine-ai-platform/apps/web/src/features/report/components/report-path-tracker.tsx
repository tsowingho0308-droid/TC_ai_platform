"use client"

import { Suspense, useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { setReportLastPath } from "@/features/report/lib/report-workspace-store"

function ReportPathTrackerInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const search = searchParams.toString()
    const path = search ? `${pathname}?${search}` : pathname
    setReportLastPath(path)
  }, [pathname, searchParams])

  return children
}

export function ReportPathTracker({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <ReportPathTrackerInner>{children}</ReportPathTrackerInner>
    </Suspense>
  )
}
