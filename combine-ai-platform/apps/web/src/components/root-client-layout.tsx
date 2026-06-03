"use client"

import { cn } from "@combine-ai/shared-ui"
import { Geist, Geist_Mono } from "next/font/google"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

interface RootClientLayoutProps {
  children: React.ReactNode
}

export function RootClientLayout({ children }: RootClientLayoutProps) {
  return (
    <div
      className={cn(
        geistSans.variable,
        geistMono.variable,
        "min-h-screen bg-background font-sans antialiased"
      )}
    >
      {children}
    </div>
  )
}
