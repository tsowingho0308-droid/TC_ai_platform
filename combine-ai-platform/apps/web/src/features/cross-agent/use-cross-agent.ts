"use client"

import { useRouter } from "next/navigation"

export type CrossAgentSource = "email" | "report" | "tender" | "finance"

export function useCrossAgent() {
  const router = useRouter()

  async function openInTenderAgent(params: {
    sourceId: string
    subject?: string
    attachmentId?: string
    attachmentIds?: string[]
    attachmentName?: string
  }) {
    const searchParams = new URLSearchParams()
    searchParams.set("fromEmail", params.sourceId)
    if (params.subject) searchParams.set("emailSubject", params.subject)
    if (params.attachmentIds?.length) {
      searchParams.set("attachmentIds", params.attachmentIds.join(","))
    } else if (params.attachmentId) {
      searchParams.set("attachmentId", params.attachmentId)
    }
    if (params.attachmentName) searchParams.set("attachmentName", params.attachmentName)

    router.push(`/tender?${searchParams.toString()}`)
  }

  async function openInReportAgent(params: {
    sourceId: string
    subject?: string
    attachmentId?: string
    attachmentIds?: string[]
    attachmentName?: string
  }) {
    const searchParams = new URLSearchParams()
    searchParams.set("fromEmail", params.sourceId)
    if (params.subject) searchParams.set("emailSubject", params.subject)
    if (params.attachmentIds?.length) {
      searchParams.set("attachmentIds", params.attachmentIds.join(","))
    } else if (params.attachmentId) {
      searchParams.set("attachmentId", params.attachmentId)
    }
    if (params.attachmentName) searchParams.set("attachmentName", params.attachmentName)

    router.push(`/report?${searchParams.toString()}`)
  }

  async function openInFinanceAgent(params: {
    sourceId: string
    subject?: string
    attachmentId?: string
    attachmentIds?: string[]
    attachmentName?: string
  }) {
    const searchParams = new URLSearchParams()
    searchParams.set("fromEmail", params.sourceId)
    if (params.subject) searchParams.set("emailSubject", params.subject)
    if (params.attachmentIds?.length) {
      searchParams.set("attachmentIds", params.attachmentIds.join(","))
    } else if (params.attachmentId) {
      searchParams.set("attachmentId", params.attachmentId)
    }
    if (params.attachmentName) searchParams.set("attachmentName", params.attachmentName)

    router.push(`/finance?${searchParams.toString()}`)
  }

  async function sendViaEmail(params: {
    sourceType: "report" | "tender"
    sourceId: string
    subject?: string
  }) {
    const searchParams = new URLSearchParams()
    searchParams.set(`from${params.sourceType.charAt(0).toUpperCase() + params.sourceType.slice(1)}`, params.sourceId)

    router.push(`/email/compose?${searchParams.toString()}`)
  }

  async function createLink(params: {
    sourceType: CrossAgentSource
    sourceId: string
    targetType: CrossAgentSource
    targetId: string
    linkType: "attachment" | "reference" | "export"
  }) {
    try {
      await fetch("/api/cross-agent/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
    } catch (err) {
      console.error("Failed to create cross-agent link:", err)
    }
  }

  return {
    openInTenderAgent,
    openInReportAgent,
    openInFinanceAgent,
    sendViaEmail,
    createLink,
  }
}
