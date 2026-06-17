"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  MessageCircleMore,
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Search,
  X,
  BookOpen,
  Paperclip,
} from "lucide-react"
import { cn } from "@combine-ai/shared-ui"

export interface ChatRoom {
  id: string
  title: string
  status: string
  department: string
  updatedAt: string
}

export interface AttachedDocument {
  articleId: string
  articleTitle: string
  excerpt: string
  knowledgeBaseName: string
}

interface ChatRoomSidebarProps {
  activeRoomId: string | null
  onSelectRoom: (roomId: string) => void
  onNewRoom: () => void
  onDeleteRoom: (roomId: string) => void
  onAttachDocument?: (doc: AttachedDocument) => void
  refreshKey?: number
}

interface SearchResultItem {
  articleId: string
  articleTitle: string
  knowledgeBaseName: string
  department: string
  similarity: number
  excerpt: string
}

export function ChatRoomSidebar({
  activeRoomId,
  onSelectRoom,
  onNewRoom,
  onDeleteRoom,
  onAttachDocument,
  refreshKey,
}: ChatRoomSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // ── Knowledge search state ──
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q)
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      if (!q.trim()) {
        setSearchResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      searchTimerRef.current = setTimeout(async () => {
        try {
          const params = new URLSearchParams({ q: q.trim(), limit: "8" })
          const res = await fetch(`/api/context/search?${params.toString()}`)
          if (res.ok) {
            const data = await res.json()
            setSearchResults((data.results || []) as SearchResultItem[])
          }
        } catch (err) {
          console.error("KB search failed:", err)
        } finally {
          setSearching(false)
        }
      }, 300)
    },
    []
  )

  const handleClearSearch = useCallback(() => {
    setSearchQuery("")
    setSearchResults([])
    setSearching(false)
  }, [])

  const handleAttachDocument = useCallback(
    (item: SearchResultItem) => {
      if (onAttachDocument) {
        onAttachDocument({
          articleId: item.articleId,
          articleTitle: item.articleTitle,
          excerpt: item.excerpt,
          knowledgeBaseName: item.knowledgeBaseName,
        })
      }
      // Clear search after attaching
      handleClearSearch()
    },
    [onAttachDocument, handleClearSearch]
  )

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/conversations")
      if (res.ok) {
        const data = await res.json()
        setRooms((data.conversations || []) as ChatRoom[])
      }
    } catch (err) {
      console.error("Failed to fetch chat rooms:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRooms()
  }, [fetchRooms, refreshKey])

  const handleDelete = useCallback(
    async (roomId: string) => {
      if (pendingDelete === roomId) {
        // Confirm delete
        try {
          const res = await fetch("/api/helpdesk/conversations", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: roomId }),
          })
          if (res.ok) {
            const wasActive = activeRoomId === roomId
            const newRooms = rooms.filter((r) => r.id !== roomId)
            setRooms(newRooms)
            // If deleting active room, switch to the most recent remaining room
            if (wasActive) {
              onDeleteRoom(roomId)
              if (newRooms.length > 0) {
                // Switch to the first (most recently updated) remaining room
                onSelectRoom(newRooms[0].id)
              } else {
                // No rooms left — create a new one
                onNewRoom()
              }
            } else {
              onDeleteRoom(roomId)
            }
          }
        } catch (err) {
          console.error("Failed to delete chat room:", err)
        }
        setPendingDelete(null)
      } else {
        setPendingDelete(roomId)
      }
    },
    [pendingDelete, activeRoomId, rooms, onDeleteRoom, onSelectRoom, onNewRoom]
  )

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffHrs = diffMs / (1000 * 60 * 60)
    // Show recorded time (not relative to now)
    const time = d.toLocaleTimeString("en-HK", { hour: "2-digit", minute: "2-digit" })
    if (diffHrs < 24 && d.getDate() === now.getDate()) {
      return time
    }
    const date = d.toLocaleDateString("en-HK", { month: "short", day: "numeric" })
    if (d.getFullYear() === now.getFullYear()) {
      return `${date}, ${time}`
    }
    return `${date} ${d.getFullYear()}, ${time}`
  }

  // ── Collapsed toggle button ──
  if (collapsed) {
    return (
      <div className="flex flex-col border-l bg-muted/10 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center justify-center p-2 hover:bg-accent transition-colors"
          title="Show chat rooms"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col border-l bg-muted/10 w-72 shrink-0 h-full">
      {/* ════════════════ Top bar: collapse toggle ════════════════ */}
      <div className="flex items-center justify-end px-2 py-1 border-b shrink-0">
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Hide sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ════════════════ Knowledge Search Section (top 50%) ════════════════ */}
      <div className="flex flex-col flex-1 border-b min-h-0">
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Knowledge Search
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search knowledge base..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-md border bg-background py-1.5 pl-8 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
              autoComplete="off"
              spellCheck={false}
            />
            {(searchQuery || searching) && (
              <button
                onClick={handleClearSearch}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
              >
                {searching ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <X className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {searchResults.length > 0 ? (
            <div className="space-y-0.5">
              {searchResults.map((item, i) => (
                <button
                  key={`${item.articleId}-${i}`}
                  onClick={() => handleAttachDocument(item)}
                  className="w-full flex items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent/60 transition-colors group/result"
                >
                  <Paperclip className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground group-hover/result:text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate leading-snug">
                      {item.articleTitle}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {item.knowledgeBaseName}
                      {item.similarity > 0 && (
                        <span> · {Math.round(item.similarity * 100)}% match</span>
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : searchQuery.trim() && !searching ? (
            <p className="text-center text-[10px] text-muted-foreground py-4">
              No documents found
            </p>
          ) : !searchQuery.trim() ? (
            <p className="text-center text-[10px] text-muted-foreground py-4">
              Search the knowledge base and attach relevant documents to your chat
            </p>
          ) : null}
        </div>
      </div>

      {/* ════════════════ Chat Rooms Section (bottom ~2/3) ════════════════ */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircleMore className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Chat Rooms
          </span>
          {rooms.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
              {rooms.length}/5
            </span>
          )}
        </div>
        <button
          onClick={onNewRoom}
          className="rounded-md p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="New chat room"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Room List ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageCircleMore className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-4 text-sm text-muted-foreground">
              No chat rooms yet.
            </p>
            <button
              onClick={onNewRoom}
              className="mt-3 text-sm text-primary hover:underline"
            >
              Create one →
            </button>
          </div>
        ) : (
          <div className="space-y-1.5 p-3">
            {rooms.map((room) => {
              const isActive = room.id === activeRoomId
              return (
                <div key={room.id} className="group relative">
                  <button
                    onClick={() => onSelectRoom(room.id)}
                    className={cn(
                      "w-full flex items-start gap-3 rounded-lg px-3.5 py-3 text-left transition-colors",
                      isActive
                        ? "bg-primary/10 border border-primary/20 shadow-sm"
                        : "hover:bg-accent/50 border border-transparent"
                    )}
                  >
                    <MessageCircleMore
                      className={cn(
                        "h-4 w-4 mt-0.5 shrink-0",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm truncate leading-snug",
                          isActive
                            ? "font-semibold text-foreground"
                            : "font-medium text-foreground/80"
                        )}
                      >
                        {room.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(room.updatedAt)}
                        {room.department !== "GENERAL" && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-muted px-1.5 py-0 text-[10px]">
                            {room.department}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>

                  {/* Delete button — visible on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(room.id)
                    }}
                    className={cn(
                      "absolute right-2 top-3 rounded-md p-1.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100",
                      pendingDelete === room.id &&
                        "opacity-100 text-destructive bg-destructive/10"
                    )}
                    title={
                      pendingDelete === room.id
                        ? "Click again to confirm delete"
                        : "Delete chat room"
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
