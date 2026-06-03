"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { FileSpreadsheet, Loader2, AlertCircle } from "lucide-react"

interface TableRow {
  field: string
  value: string
}

interface SessionData {
  id: string
  title: string
  status: string
  rows?: TableRow[]
  draftNote?: string | null
  updatedAt: string
}

export default function ReportSessionPage() {
  const params = useParams()
  const sessionId = params?.sessionId as string
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    fetch("/api/report/sessions")
      .then((r) => r.json())
      .then((data) => {
        const found = (data.sessions || []).find((s: SessionData) => s.id === sessionId)
        if (found) {
          setSession(found)
        } else {
          setError("Session not found")
        }
      })
      .catch((err) => setError(err.message || "Failed to load session"))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{error || "Session not found"}</p>
          <a href="/report" className="text-sm text-primary hover:underline">
            Back to Report Agent
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <a href="/report" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </a>
          <h1 className="text-lg font-semibold">{session.title}</h1>
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
            {session.status}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {session.rows && session.rows.length > 0 ? (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Field</th>
                  <th className="px-4 py-2 text-left font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {session.rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium text-muted-foreground">{row.field}</td>
                    <td className="px-4 py-2">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              No data extracted yet.{" "}
              <a href="/report" className="text-primary hover:underline">
                Go to Report Agent
              </a>{" "}
              to upload a document.
            </p>
          </div>
        )}

        {session.draftNote && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Notes</p>
            <p className="mt-1 text-sm">{session.draftNote}</p>
          </div>
        )}
      </div>
    </div>
  )
}
