"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Search, Loader2, X } from "lucide-react"
import type { SearchResult } from "../api/context-client"

interface SearchBarProps {
  value: string
  onChange: (q: string) => void
  results: SearchResult[]
  searching: boolean
  onSelectResult: (result: SearchResult) => void
}

export function SearchBar({
  value,
  onChange,
  results,
  searching,
  onSelectResult,
}: SearchBarProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Debounced search call
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const handleChange = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onChange(q), 300)
    },
    [onChange]
  )

  // Show dropdown when we have results
  useEffect(() => {
    setShowDropdown(results.length > 0 && value.trim().length > 0)
  }, [results, value])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div className="relative flex-1 max-w-xl">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search documents semantically..."
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setShowDropdown(true)
          }}
          className="w-full rounded-md border py-2 pl-10 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {(value || searching) && (
          <button
            onClick={() => {
              onChange("")
              setShowDropdown(false)
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <X className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-lg"
        >
          {results.length === 0 && searching && (
            <div className="px-4 py-3 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          )}
          {results.map((result, idx) => (
            <button
              key={`${result.articleId}-${result.chunkIndex}`}
              onClick={() => {
                onSelectResult(result)
                setShowDropdown(false)
              }}
              className="w-full px-4 py-3 text-left hover:bg-accent transition-colors border-b last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">
                  {result.articleTitle}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {result.department}
                </span>
                {result.similarity > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {Math.round(result.similarity * 100)}% match
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {result.excerpt}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                in {result.knowledgeBaseName}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
