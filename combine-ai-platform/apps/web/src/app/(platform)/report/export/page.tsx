"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, FileSpreadsheet } from "lucide-react"

interface ReportSession {
  id: string
  title: string
  updatedAt: string
}

export default function BatchExportPage() {
  const [sessions, setSessions] = useState<ReportSession[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/report/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sessions) setSessions(data.sessions)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggleSession(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === sessions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sessions.map((s) => s.id)))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/report" className="rounded-md p-1 hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Batch Export</h1>
        </div>
        <button
          disabled={selected.size === 0}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export Selected ({selected.size})
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">No report sessions</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create report sessions first, then export them in batch.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {sessions.length} session{sessions.length !== 1 ? "s" : ""} available
              </p>
              <button
                onClick={toggleAll}
                className="text-sm text-primary hover:underline"
              >
                {selected.size === sessions.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            <div className="space-y-2">
              {sessions.map((session) => (
                <label
                  key={session.id}
                  className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(session.id)}
                    onChange={() => toggleSession(session.id)}
                    className="h-4 w-4 rounded border-primary"
                  />
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{session.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
