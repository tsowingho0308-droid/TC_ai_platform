"use client"

import { useState, useEffect, useRef, useCallback, Fragment } from "react"
import Link from "next/link"
import {
  Search,
  FileText,
  Ticket,
  GitBranch,
  Loader2,
  CornerDownLeft,
} from "lucide-react"

interface SearchResultItem {
  id: string
  title: string
  category: "knowledge" | "ticket" | "workflow"
  subtitle: string
  excerpt?: string
  department?: string
  status?: string
  url: string
}

const CATEGORY_CONFIG = {
  knowledge: {
    label: "Knowledge Base",
    icon: FileText,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  ticket: {
    label: "Tickets",
    icon: Ticket,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  workflow: {
    label: "Workflows",
    icon: GitBranch,
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
}

export function GlobalSearchBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Ctrl+K / Cmd+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery("")
      setResults([])
      setSelectedIndex(0)
    }
  }, [open])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ q, limit: "5" })
      const res = await fetch(`/api/search?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setResults((data.results || []) as SearchResultItem[])
        setSelectedIndex(0)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  const handleChange = (value: string) => {
    setQuery(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => doSearch(value), 250)
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const selected = results[selectedIndex]
      if (selected) {
        window.location.href = selected.url
        setOpen(false)
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  // Group results by category
  const grouped = results.reduce(
    (acc, r) => {
      if (!acc[r.category]) acc[r.category] = []
      acc[r.category].push(r)
      return acc
    },
    {} as Record<string, SearchResultItem[]>
  )

  const categoryOrder = ["knowledge", "ticket", "workflow"] as const

  return (
    <>
      {/* Trigger button in nav bar */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
      >
        <Search className="h-4 w-4" />
        <span className="hidden lg:inline">Search...</span>
        <kbd className="hidden lg:inline-flex items-center gap-0.5 rounded border bg-background px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
          Ctrl+K
        </kbd>
      </button>

      {/* Overlay + Dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Dialog */}
          <div
            ref={overlayRef}
            className="relative z-50 w-full max-w-xl rounded-xl border bg-popover shadow-2xl"
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 border-b px-4 py-3">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Search className="h-5 w-5 text-muted-foreground" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search documents, tickets, workflows..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="inline-flex items-center rounded border bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto p-2">
              {query.trim() && !loading && results.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Search className="h-8 w-8 text-muted-foreground/30" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    No results found for &quot;{query}&quot;
                  </p>
                </div>
              ) : !query.trim() ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Search className="h-8 w-8 text-muted-foreground/30" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Type to search across knowledge base, tickets, and workflows
                  </p>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
                </div>
              ) : (
                categoryOrder.map((cat) => {
                  const items = grouped[cat]
                  if (!items || items.length === 0) return null
                  const cfg = CATEGORY_CONFIG[cat]
                  const Icon = cfg.icon
                  return (
                    <div key={cat} className="mb-2">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {cfg.label}
                        </span>
                        <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                          {items.length}
                        </span>
                      </div>
                      {items.map((item, i) => {
                        const globalIndex = results.indexOf(item)
                        const isSelected = globalIndex === selectedIndex
                        return (
                          <Link
                            key={`${item.category}-${item.id}`}
                            href={item.url}
                            onClick={() => setOpen(false)}
                            className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                              isSelected
                                ? "bg-accent"
                                : "hover:bg-accent/50"
                            }`}
                          >
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}
                            >
                              <Icon className={`h-4 w-4 ${cfg.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">
                                {item.title}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {item.subtitle}
                              </p>
                              {item.excerpt && (
                                <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">
                                  {item.excerpt}
                                </p>
                              )}
                            </div>
                            <CornerDownLeft className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40" />
                          </Link>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-4 border-t px-4 py-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0 text-[9px]">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0 text-[9px]">↵</kbd> Open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0 text-[9px]">Esc</kbd> Close
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
