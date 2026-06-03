"use client"

import { useEffect, useState, useCallback } from "react"
import { Search, Loader2 } from "lucide-react"
import { listConversations, classifyConversation } from "../api/email-client"
import { cn } from "@combine-ai/shared-ui"

interface Conversation {
  id: string
  inboxId: string
  subject: string
  senderName: string
  senderEmail: string
  preview: string
  read: boolean
  starred: boolean
  labels: string[]
  status: string
  workType: string | null
  aiTriagedAt: string | null
  aiRouteConfidence: number | null
  createdAt: string
}

interface MailListProps {
  folder?: string
  inboxId?: string
  onSelectConversation: (id: string) => void
  selectedId?: string | null
}

export function MailList({ folder = "inbox", inboxId, onSelectConversation, selectedId }: MailListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [classifying, setClassifying] = useState<string | null>(null)

  const loadConversations = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listConversations({ folder, inboxId, q: search || undefined })
      setConversations(data)
    } catch (err) {
      console.error("Failed to load conversations:", err)
    } finally {
      setLoading(false)
    }
  }, [folder, inboxId, search])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  async function handleClassify(e: React.MouseEvent, conversationId: string) {
    e.stopPropagation()
    setClassifying(conversationId)
    try {
      const result = await classifyConversation(conversationId)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, workType: result.workType, aiTriagedAt: new Date().toISOString(), aiRouteConfidence: result.confidence }
            : c
        )
      )
    } catch (err) {
      console.error("Classification failed:", err)
    } finally {
      setClassifying(null)
    }
  }

  const workTypeBadge = (type: string | null) => {
    if (!type) return null
    const colors: Record<string, string> = {
      commercial: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      it: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      hr: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    }
    return (
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", colors[type] || "bg-muted")}>
        {type.toUpperCase()}
      </span>
    )
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <div className="flex h-full flex-col border-r">
      {/* Search */}
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emails..."
            className="w-full rounded-md border bg-muted/50 py-2 pr-3 pl-9 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No conversations found
          </div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={cn(
                "cursor-pointer border-b p-3 transition-colors hover:bg-accent",
                !conv.read && "bg-muted/30",
                selectedId === conv.id && "bg-accent"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm", !conv.read && "font-semibold")}>
                    {conv.senderName}
                  </span>
                  {workTypeBadge(conv.workType)}
                </div>
                <span className="text-xs text-muted-foreground">{formatTime(conv.createdAt)}</span>
              </div>
              <p className={cn("mt-0.5 text-sm", !conv.read && "font-medium")}>
                {conv.subject}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <p className="truncate text-xs text-muted-foreground">{conv.preview}</p>
                {!conv.workType && (
                  <button
                    onClick={(e) => handleClassify(e, conv.id)}
                    disabled={classifying === conv.id}
                    className="ml-2 shrink-0 rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    {classifying === conv.id ? "..." : "Classify"}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
