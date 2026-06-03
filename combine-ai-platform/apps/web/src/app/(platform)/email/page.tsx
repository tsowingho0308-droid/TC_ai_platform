"use client"

import { useState, useCallback } from "react"
import { MailList } from "@/features/email/components/mail-list"
import { MailDisplay } from "@/features/email/components/mail-display"

export default function EmailPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

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
          folder="inbox"
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
