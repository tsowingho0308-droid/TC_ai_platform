"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState, Suspense } from "react"
import Link from "next/link"
import { ArrowLeft, Send } from "lucide-react"

function ComposeContent() {
  const searchParams = useSearchParams()
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [to, setTo] = useState("")

  const fromTender = searchParams.get("fromTender")
  const fromReport = searchParams.get("fromReport")

  useEffect(() => {
    // Pre-fill from cross-agent context
    if (fromTender) {
      setSubject("Re: Tender Analysis Summary")
      setBody(`Please find attached the tender analysis for your review.\n\nKey findings:\n- Tender analysis completed on ${new Date().toLocaleDateString()}\n- Reference: ${fromTender}\n\nBest regards,`)
    } else if (fromReport) {
      setSubject("Report: Data Extraction Results")
      setBody(`Please find attached the report generated from the document analysis.\n\nReference: ${fromReport}\n\nBest regards,`)
    }
  }, [fromTender, fromReport])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <Link href="/email" className="rounded-md p-1 hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-semibold">New Message</h1>
        {(fromTender || fromReport) && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {fromTender ? "From Tender Agent" : "From Report Agent"}
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">To</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@company.com"
              className="w-full border-b bg-transparent px-0 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject..."
              className="w-full border-b bg-transparent px-0 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="flex-1">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={15}
              className="w-full resize-none bg-transparent py-2 text-sm outline-none"
            />
          </div>
        </div>
      </div>

      <footer className="border-t px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {fromTender && "Reply will be linked to Tender Analysis"}
            {fromReport && "Reply will be linked to Report Session"}
          </p>
          <button className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
      </footer>
    </div>
  )
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading...</div>}>
      <ComposeContent />
    </Suspense>
  )
}
