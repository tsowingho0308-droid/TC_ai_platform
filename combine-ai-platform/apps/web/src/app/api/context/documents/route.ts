import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const knowledgeBaseId = url.searchParams.get("knowledgeBaseId")
    const department = url.searchParams.get("department")
    const search = url.searchParams.get("search") || ""
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100)
    const offset = parseInt(url.searchParams.get("offset") || "0")

    const where: Record<string, unknown> = {
      knowledgeBase: {
        workspaceId: session.workspaceId,
      },
    }

    if (knowledgeBaseId) {
      where.knowledgeBaseId = knowledgeBaseId
    }

    if (department && department !== "GENERAL") {
      where.knowledgeBase = {
        ...(where.knowledgeBase as Record<string, unknown>),
        department: department,
      }
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ]
    }

    const [documents, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where: where as any,
        include: {
          knowledgeBase: {
            select: { id: true, name: true, slug: true, department: true },
          },
          _count: { select: { chunks: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.knowledgeArticle.count({ where: where as any }),
    ])

    const result = documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      content: doc.content.slice(0, 500), // preview only
      tags: doc.tags,
      language: doc.language,
      sourceDocName: doc.sourceDocName,
      targetAudience: doc.targetAudience,
      businessProcesses: doc.businessProcesses,
      documentType: doc.documentType,
      linkedArticleIds: doc.linkedArticleIds,
      languageCode: doc.languageCode,
      knowledgeBase: doc.knowledgeBase,
      chunkCount: doc._count.chunks,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }))

    return NextResponse.json({ documents: result, total })
  } catch (error) {
    console.error("Context documents API error:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch documents",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const knowledgeBaseId = formData.get("knowledgeBaseId") as string | null
    const title = formData.get("title") as string | null
    const targetAudience = formData.get("targetAudience") as string | null
    const businessProcessesRaw = formData.get("businessProcesses") as string | null
    const documentType = formData.get("documentType") as string | null
    const linkedArticleIdsRaw = formData.get("linkedArticleIds") as string | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    if (!knowledgeBaseId) {
      return NextResponse.json(
        { error: "knowledgeBaseId is required" },
        { status: 400 }
      )
    }

    // Verify knowledge base belongs to workspace
    const kb = await prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, workspaceId: session.workspaceId },
    })

    if (!kb) {
      return NextResponse.json(
        { error: "Knowledge base not found" },
        { status: 404 }
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Check file size (10MB max)
    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      )
    }

    // Extract text and process document
    const { processDocument } = await import(
      "@/lib/server/document-processor"
    )
    // Parse comma-separated or JSON array fields
    const businessProcesses = businessProcessesRaw
      ? businessProcessesRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined
    let linkedArticleIds: string[] | undefined
    if (linkedArticleIdsRaw) {
      try {
        linkedArticleIds = JSON.parse(linkedArticleIdsRaw) as string[]
      } catch {
        linkedArticleIds = linkedArticleIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      }
    }

    const { articleId, chunkCount } = await processDocument(
      buffer,
      file.name,
      file.type,
      knowledgeBaseId,
      session.workspaceId,
      title || file.name.replace(/\.[^.]+$/, ""),
      {
        targetAudience: targetAudience || undefined,
        businessProcesses,
        documentType: documentType || undefined,
        linkedArticleIds,
      }
    )

    // Broadcast context update event
    const article = await prisma.knowledgeArticle.findUnique({
      where: { id: articleId },
      include: {
        knowledgeBase: {
          select: { id: true, name: true, slug: true, department: true },
        },
        _count: { select: { chunks: true } },
      },
    })

    return NextResponse.json(
      {
        document: {
          id: article!.id,
          title: article!.title,
          content: article!.content.slice(0, 500),
          tags: article!.tags,
          language: article!.language,
          sourceDocName: article!.sourceDocName,
          knowledgeBase: article!.knowledgeBase,
          chunkCount: article!._count.chunks,
          createdAt: article!.createdAt,
          updatedAt: article!.updatedAt,
        },
        chunksCreated: chunkCount,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Context documents POST error:", error)
    return NextResponse.json(
      {
        error: "Failed to upload document",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as { id: string }
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: "Document id required" }, { status: 400 })
    }

    // Verify ownership
    const doc = await prisma.knowledgeArticle.findFirst({
      where: {
        id,
        knowledgeBase: { workspaceId: session.workspaceId },
      },
      include: { knowledgeBase: true },
    })

    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      )
    }

    // Delete (cascades to chunks)
    await prisma.knowledgeArticle.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Context documents DELETE error:", error)
    return NextResponse.json(
      {
        error: "Failed to delete document",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
