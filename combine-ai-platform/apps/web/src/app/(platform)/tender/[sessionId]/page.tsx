"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { FileText, Loader2, AlertCircle } from "lucide-react"

interface SessionData {
  id: string
  title: string
  templateId: string | null
  tenderType: string | null
  fieldInputs: Record<string, string>
  status: string
  updatedAt: string
}

export default function TenderSessionPage() {
  const params = useParams()
  const sessionId = params?.sessionId as string
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    fetch("/api/tender/sessions")
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
          <a href="/tender" className="text-sm text-primary hover:underline">
            Back to Tender Agent
          </a>
        </div>
      </div>
    )
  }

  const fieldEntries = Object.entries(session.fieldInputs || {})

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <a href="/tender" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </a>
          <h1 className="text-lg font-semibold">{session.title}</h1>
          {session.tenderType && (
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 capitalize">
              {session.tenderType.replace(/_/g, " ")}
            </span>
          )}
          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
            {session.status}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {fieldEntries.length > 0 ? (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Field</th>
                  <th className="px-4 py-2 text-left font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {fieldEntries.map(([field, value], i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium text-muted-foreground">{field}</td>
                    <td className="px-4 py-2">{value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              No fields extracted yet.{" "}
              <a href="/tender" className="text-primary hover:underline">
                Go to Tender Agent
              </a>{" "}
              to upload a document.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
