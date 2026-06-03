"use client"

import { Suspense } from "react"
import { ContextPage } from "@/features/context/components/context-page"

export default function ContextPageRoute() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <ContextPage />
    </Suspense>
  )
}
