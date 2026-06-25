import type { TenderSessionWorkspace } from "@/features/tender/lib/tender-session-workspace"
import { unpackTenderSessionWorkspace } from "@/features/tender/lib/tender-session-workspace"

export interface TenderSessionRecord {
  id: string
  title: string
  status: string
  fieldInputs?: unknown
  templateId?: string | null
  tenderType?: string | null
}

export async function fetchTenderSessionById(
  sessionId: string
): Promise<TenderSessionRecord | null> {
  const res = await fetch(`/api/tender/sessions?id=${encodeURIComponent(sessionId)}`)
  if (!res.ok) return null
  const data = (await res.json()) as { session?: TenderSessionRecord }
  return data.session ?? null
}

export function resolveTenderSessionWorkspace(
  session: TenderSessionRecord
): TenderSessionWorkspace | null {
  return unpackTenderSessionWorkspace(session.fieldInputs, {
    title: session.title,
  })
}
