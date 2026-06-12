import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { searchKnowledgeChunks, type KnowledgeChunkResult } from "@/lib/server/knowledge-search"

export const dynamic = "force-dynamic"

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

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const q = url.searchParams.get("q") || ""
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "5"), 10)

  if (!q.trim()) {
    return NextResponse.json({ results: [], total: 0 })
  }

  const query = q.trim()

  // Run all 3 searches in parallel
  const [kbResults, ticketResults, workflowResults] = await Promise.allSettled([
    // 1. Knowledge Base (RAG vector search + keyword fallback)
    searchKnowledgeChunks(session.workspaceId, query, { limit })
      .then((r) =>
        (r.chunks || []).map((c: KnowledgeChunkResult) => ({
          id: c.articleId,
          title: c.articleTitle,
          category: "knowledge" as const,
          subtitle: `${c.knowledgeBaseName} · ${c.department}`,
          excerpt: c.excerpt,
          department: c.department,
          url: `/context?document=${c.articleId}`,
        }))
      )
      .catch(() => [] as SearchResultItem[]),

    // 2. Tickets (keyword match on question/aiAnswer)
    prisma.helpdeskTicket
      .findMany({
        where: {
          workspaceId: session.workspaceId,
          OR: [
            { question: { contains: query, mode: "insensitive" } },
            { aiAnswer: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      })
      .then((tickets) =>
        tickets.map((t) => ({
          id: t.id,
          title: t.question.slice(0, 100),
          category: "ticket" as const,
          subtitle: `${t.department} · ${t.status}`,
          department: t.department,
          status: t.status,
          url: `/helpdesk/tickets/${t.id}`,
        }))
      )
      .catch(() => [] as SearchResultItem[]),

    // 3. Workflow Runs (keyword match on title)
    prisma.workflowRun
      .findMany({
        where: {
          workspaceId: session.workspaceId,
          title: { contains: query, mode: "insensitive" },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      })
      .then((runs) =>
        runs.map((r) => ({
          id: r.id,
          title: r.title,
          category: "workflow" as const,
          subtitle: `${r.category} · ${r.status}`,
          status: r.status,
          url: `/workflow/runs/${r.id}`,
        }))
      )
      .catch(() => [] as SearchResultItem[]),
  ])

  // Flatten and deduplicate results
  const kb = kbResults.status === "fulfilled" ? kbResults.value : []
  const tickets = ticketResults.status === "fulfilled" ? ticketResults.value : []
  const workflows = workflowResults.status === "fulfilled" ? workflowResults.value : []

  // Deduplicate KB results by articleId
  const seenKb = new Set<string>()
  const dedupedKb = kb.filter((item) => {
    if (seenKb.has(item.id)) return false
    seenKb.add(item.id)
    return true
  })

  const results = [...dedupedKb, ...tickets, ...workflows]

  return NextResponse.json({
    results,
    total: results.length,
    categories: {
      knowledge: dedupedKb.length,
      ticket: tickets.length,
      workflow: workflows.length,
    },
  })
}
