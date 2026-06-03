"use client"

import { useSearchParams } from "next/navigation"
import { useState, useCallback } from "react"
import { MailList } from "@/features/email/components/mail-list"
import { MailDisplay } from "@/features/email/components/mail-display"

export default function EmailPage() {
  const searchParams = useSearchParams()
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const folder = searchParams.get("folder") || "inbox"
  const department = searchParams.get("department") || undefined

  const handleSelectConversation = useCallback((id: string) => {
    setSelectedConversationId(id)
  }, [])

  const handleClose = useCallback(() => {
    setSelectedConversationId(null)
  }, [])

  return (
    <div className="flex h-full">
      {/* Left sidebar: Folder list is in the AppSidebar context section */}
      {/* Column 1: Conversation List */}
      <div className="w-80 shrink-0">
        <MailList
          folder={folder}
          department={department}
          onSelectConversation={handleSelectConversation}
          selectedId={selectedConversationId}
        />
      </div>

      {/* Column 2: Conversation Detail */}
      <div className="flex-1">
        <MailDisplay
          conversationId={selectedConversationId}
          onClose={handleClose}
        />
      </div>
    </div>
  )
}
