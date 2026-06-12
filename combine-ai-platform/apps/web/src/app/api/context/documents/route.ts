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

    // ── Auto KB Selection (AI-powered, 2-step) ─────────────
    let finalKbId = knowledgeBaseId
    let autoKbMatched: string | null = null
    let autoDocCategory: string | null = null
    let autoDepartments: string[] = []

    if (knowledgeBaseId === "auto") {
      try {
        const { extractText } = await import("@/lib/server/document-processor")
        const sampleText = await extractText(buffer, file.type)
        const { getDashScopeProvider, DEFAULT_MODELS } = await import("@combine-ai/ai-provider")
        const provider = getDashScopeProvider()

        const result = await provider.createCompletion({
          model: DEFAULT_MODELS.email,
          temperature: 0.1,
          maxTokens: 400,
          responseFormat: "json",
          messages: [
            {
              role: "system",
              content: `You are a document classifier for a Hong Kong enterprise. First identify the document CATEGORY, then assign it to the appropriate DEPARTMENT(S).

## Step 1: Document Category
Classify the document into ONE of these categories:
- **Tender**: RFP, RFQ, bidding documents, procurement tenders, quotation requests — anything related to soliciting or submitting bids
- **Report**: Financial reports, audit reports, project reports, analysis reports, meeting minutes, summaries
- **Email**: Email threads, email conversations, email archives
- **Policy**: Company policies, procedures, guidelines, handbooks, rules, regulations
- **Invoice**: Invoices, receipts, payment documents, expense claims
- **Contract**: Contracts, agreements, MOUs, NDAs, legal documents
- **Form**: Application forms, request forms, registration forms, templates
- **Manual**: User manuals, technical guides, setup guides, SOPs
- **General**: Anything that doesn't fit the above

## Step 2: Responsible Departments
Assign to ONE OR MORE departments based on content:
- **HR**: leave, benefits, training, recruitment, performance, employee relations, payroll
- **IT**: software, hardware, VPN, security, email systems, cloud, infrastructure, technical specifications
- **ADMIN**: facilities, access cards, travel, office supplies, visitors, meeting rooms
- **FINANCE**: expenses, procurement, budget, invoices, tax, payments, pricing, financial terms
- **GENERAL**: company-wide policies, handbook, holidays, compliance, emergency

Example: An IT infrastructure tender → category: "Tender", departments: ["IT", "FINANCE"] (IT for technical scope, FINANCE for budget/procurement)
Example: An expense policy document → category: "Policy", departments: ["FINANCE", "GENERAL"]

Return ONLY valid JSON:
{ "category": "Tender"|"Report"|"Email"|"Policy"|"Invoice"|"Contract"|"Form"|"Manual"|"General", "departments": ["HR"|"IT"|"ADMIN"|"FINANCE"|"GENERAL"], "primaryDepartment": "IT", "confidence": 0.0-1.0, "reason": "one-line reason" }`,
            },
            {
              role: "user",
              content: `Classify this document:\n\n${sampleText.slice(0, 3000)}`,
            },
          ],
        })

        const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
        const classification = JSON.parse(cleaned) as {
          category: string
          departments: string[]
          primaryDepartment: string
          confidence: number
          reason: string
        }

        autoDocCategory = classification.category || null
        const validDepts = ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"]
        autoDepartments = (classification.departments || [classification.primaryDepartment]).filter(
          (d) => validDepts.includes(d)
        )
        const primaryDept = validDepts.includes(classification.primaryDepartment)
          ? classification.primaryDepartment
          : autoDepartments[0] || "GENERAL"

        // Use primary department for KB placement
        const matchedKb = await prisma.knowledgeBase.findFirst({
          where: { workspaceId: session.workspaceId, department: primaryDept as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL" },
        })

        if (matchedKb) {
          finalKbId = matchedKb.id
          autoKbMatched = `${matchedKb.name} (${matchedKb.department})`
        } else {
          const fallbackKb = await prisma.knowledgeBase.findFirst({
            where: { workspaceId: session.workspaceId },
          })
          if (fallbackKb) finalKbId = fallbackKb.id
        }
      } catch (err) {
        console.warn("Auto KB selection failed, falling back to GENERAL:", err)
        const fallbackKb = await prisma.knowledgeBase.findFirst({
          where: { workspaceId: session.workspaceId, department: "GENERAL" },
        })
        if (fallbackKb) finalKbId = fallbackKb.id
      }
    }

    // Verify knowledge base belongs to workspace
    const kb = await prisma.knowledgeBase.findFirst({
      where: { id: finalKbId, workspaceId: session.workspaceId },
    })
    if (!kb) {
      return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 })
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
      finalKbId,
      session.workspaceId,
      title || file.name.replace(/\.[^.]+$/, ""),
      {
        targetAudience: targetAudience || undefined,
        businessProcesses,
        documentType: documentType || undefined,
        linkedArticleIds,
      }
    )

    // Fetch the created article
    const article = await prisma.knowledgeArticle.findUnique({
      where: { id: articleId },
      include: {
        knowledgeBase: {
          select: { id: true, name: true, slug: true, department: true },
        },
        _count: { select: { chunks: true } },
      },
    })

    // ── AI Auto-Tagging ───────────────────────────────────
    let aiSuggestedTags: Array<{ tag: string; confidence: number; reason: string }> = []
    let aiSuggestedDepartment: string | null = null
    let aiSuggestedDocumentType: string | null = null
    let aiSummary: string | null = null

    try {
      const { getDashScopeProvider, DEFAULT_MODELS } = await import("@combine-ai/ai-provider")
      const { buildTaxonomyPrompt, PREDEFINED_TAGS } = await import("@/lib/server/tag-taxonomy")

      const provider = getDashScopeProvider()
      const taxonomyText = buildTaxonomyPrompt()
      const truncatedText = article!.content.slice(0, 4000)

      // Context from auto-classification
      const docTypeContext = autoDocCategory
        ? `This document was classified as: **${autoDocCategory}**.`
        : ""
      const deptContext = autoDepartments.length > 0
        ? `It involves these departments: ${autoDepartments.join(", ")}. Add cross-department tags if multiple departments are involved.`
        : ""

      const result = await provider.createCompletion({
        model: DEFAULT_MODELS.email,
        temperature: 0.1,
        maxTokens: 600,
        responseFormat: "json",
        messages: [
          {
            role: "system",
            content: `You are a document classification assistant. Given a document's text content, suggest the most relevant tags from the taxonomy below.

Rules:
- Select 4-10 tags that best describe the document's content
- Include the document type tag (tender, report, contract, etc.) if applicable
- If the document involves multiple departments, add the "cross-dept" tag and the relevant cross-functional tags
- Only suggest tags that are in the taxonomy list below
- Include a confidence score (0.0-1.0) for each tag
- Respond ONLY with valid JSON

${docTypeContext}
${deptContext}

${taxonomyText}

Return: { "tags": [{"tag": "tag-name", "confidence": 0.9, "reason": "short reason"}], "suggestedDocumentType": "STANDARD|PLAYBOOK|PROCESS_MAP|FAQ", "summary": "one-line summary in the document's language" }`,
          },
          {
            role: "user",
            content: `Filename: ${article!.sourceDocName || article!.title}\n\nAnalyze and suggest tags:\n\n${truncatedText}`,
          },
        ],
      })

      const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
      const parsed = JSON.parse(cleaned)
      const validTags = new Set(PREDEFINED_TAGS.map((t) => t.tag))
      aiSuggestedTags = (parsed.tags || []).filter((t: { tag: string }) => validTags.has(t.tag))
      aiSuggestedDepartment = parsed.suggestedDepartment || null
      aiSuggestedDocumentType = parsed.suggestedDocumentType || null
      aiSummary = parsed.summary || null

      // ── Filename keyword fallback ──────────────────────────
      // If filename contains obvious type keywords, add them as tags
      const fileName = (article!.sourceDocName || article!.title).toLowerCase()
      const existingTags = new Set(aiSuggestedTags.map((t) => t.tag))
      const FILENAME_TAG_HINTS: Record<string, string> = {
        report: "report",
        tender: "tender",
        rfp: "tender",
        rfq: "tender",
        invoice: "invoice-doc",
        receipt: "invoice-doc",
        contract: "contract",
        agreement: "contract",
        policy: "policy-doc",
        handbook: "handbook",
        manual: "manual",
        form: "form",
        application: "form",
        email: "email-thread",
      }
      for (const [keyword, tag] of Object.entries(FILENAME_TAG_HINTS)) {
        if (fileName.includes(keyword) && !existingTags.has(tag)) {
          aiSuggestedTags.push({ tag, confidence: 0.95, reason: `Filename contains "${keyword}"` })
        }
      }

      // Apply AI suggestions to the article if no user-specified tags were provided
      if (aiSuggestedTags.length > 0) {
        await prisma.knowledgeArticle.update({
          where: { id: articleId },
          data: {
            tags: aiSuggestedTags.map((t) => t.tag),
            documentType: (aiSuggestedDocumentType as never) || "STANDARD",
          },
        })
      }
    } catch (err) {
      console.warn("AI auto-tagging failed (non-critical):", err)
    }

    return NextResponse.json(
      {
        document: {
          id: article!.id,
          title: article!.title,
          content: article!.content.slice(0, 500),
          tags: aiSuggestedTags.length > 0 ? aiSuggestedTags.map((t) => t.tag) : article!.tags,
          language: article!.language,
          sourceDocName: article!.sourceDocName,
          targetAudience: article!.targetAudience,
          businessProcesses: article!.businessProcesses,
          documentType: aiSuggestedDocumentType || article!.documentType,
          linkedArticleIds: article!.linkedArticleIds,
          languageCode: article!.languageCode,
          knowledgeBase: article!.knowledgeBase,
          chunkCount: article!._count.chunks,
          createdAt: article!.createdAt,
          updatedAt: article!.updatedAt,
        },
        chunksCreated: chunkCount,
        autoKbMatched,
        autoDocCategory,
        autoDepartments,
        aiSuggestions: {
          tags: aiSuggestedTags,
          suggestedDepartment: aiSuggestedDepartment,
          suggestedDocumentType: aiSuggestedDocumentType,
          summary: aiSummary,
        },
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
