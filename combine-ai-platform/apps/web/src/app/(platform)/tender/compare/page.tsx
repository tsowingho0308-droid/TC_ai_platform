"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, GitCompare, Send } from "lucide-react"

interface TenderSession {
  id: string
  title: string
  tenderType: string | null
  fieldInputs: Record<string, string>
}

export default function ComparePage() {
  const [sessions, setSessions] = useState<TenderSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch all tender sessions for comparison
    fetch("/api/tender/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sessions) setSessions(data.sessions)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const allFields = Array.from(
    new Set(sessions.flatMap((s) => Object.keys(s.fieldInputs || {})))
  ).filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/tender" className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Tender Comparison</h1>
          <GitCompare className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            <Download className="h-4 w-4" />
            Export Excel
          </button>
          <Link
            href={`/email/compose?fromTender=comparison`}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            <Send className="h-4 w-4" />
            Send via Email
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : sessions.length < 2 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <GitCompare className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">Not enough tenders to compare</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload at least 2 tender documents to enable comparison.
            </p>
            <Link href="/tender" className="mt-4 text-sm text-primary hover:underline">
              Return to Tender Agent
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Field</th>
                  {sessions.map((s) => (
                    <th key={s.id} className="px-4 py-3 text-left font-medium">
                      {s.title}
                      <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                        ({s.tenderType?.replace("_", " ") || "general"})
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFields.map((field) => (
                  <tr key={field} className="border-b">
                    <td className="px-4 py-2 font-medium text-muted-foreground">{field}</td>
                    {sessions.map((s) => (
                      <td key={`${s.id}-${field}`} className="px-4 py-2">
                        {s.fieldInputs?.[field] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
