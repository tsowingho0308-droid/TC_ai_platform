import { NextResponse } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

// ── GET /api/tender/templates ─────────────────────────────────

export async function GET() {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const templates = await prisma.tenderTemplate.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: [{ scenario: "asc" }, { title: "asc" }],
      select: {
        id: true,
        locale: true,
        title: true,
        scenario: true,
        description: true,
        docxFields: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ templates })
  } catch (error) {
    console.error("Failed to fetch tender templates:", error)
    return NextResponse.json(
      { error: "Failed to fetch templates", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── POST /api/tender/templates ────────────────────────────────

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const contentType = request.headers.get("content-type") || ""

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData()
      const title = formData.get("title") as string | null
      const locale = formData.get("locale") as string | null
      const scenario = formData.get("scenario") as string | null
      const description = formData.get("description") as string | null
      const templateFile = formData.get("template") as File | null

      if (!title) {
        return NextResponse.json({ error: "title is required" }, { status: 400 })
      }

      const docxFields: string[] = []
      let docxFile = ""

      if (templateFile) {
        docxFile = `templates/${Date.now()}_${templateFile.name}`
        // Extract {{field}} names from DOCX — simple regex-based extraction
        try {
          const text = await templateFile.text()
          const fieldMatches = text.match(/\{\{([^}]+)\}\}/g)
          if (fieldMatches) {
            for (const m of fieldMatches) {
              const fieldName = m.replace(/^\{\{|\}\}$/g, "").trim()
              if (fieldName && !docxFields.includes(fieldName)) {
                docxFields.push(fieldName)
              }
            }
          }
        } catch {
          // If we can't read fields, leave empty
        }
        // Note: In production, save file to Cloud Storage; for now store path reference
      }

      const template = await prisma.tenderTemplate.create({
        data: {
          workspaceId: session.workspaceId,
          locale: locale || "zh_hk",
          title,
          scenario: scenario || null,
          description: description || null,
          docxFile,
          docxFields,
          metadata: {},
        },
        select: {
          id: true,
          locale: true,
          title: true,
          scenario: true,
          description: true,
          docxFields: true,
          updatedAt: true,
        },
      })

      return NextResponse.json({ template }, { status: 201 })
    }

    // JSON body
    const { title, locale, scenario, description, docxFields, docxFile } = (await request.json()) as {
      title?: string
      locale?: string
      scenario?: string
      description?: string
      docxFields?: string[]
      docxFile?: string
    }

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 })
    }

    const template = await prisma.tenderTemplate.create({
      data: {
        workspaceId: session.workspaceId,
        locale: locale || "zh_hk",
        title,
        scenario: scenario || null,
        description: description || null,
        docxFile: docxFile || "",
        docxFields: docxFields || [],
        metadata: {},
      },
      select: {
        id: true,
        locale: true,
        title: true,
        scenario: true,
        description: true,
        docxFields: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ template }, { status: 201 })
  } catch (error) {
    console.error("Failed to create tender template:", error)
    return NextResponse.json(
      { error: "Failed to create template", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── DELETE /api/tender/templates ──────────────────────────────

export async function DELETE(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = (await request.json().catch(() => ({}))) as { id?: string }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const existing = await prisma.tenderTemplate.findFirst({
      where: { id, workspaceId: session.workspaceId },
    })

    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    // Unlink sessions using this template
    await prisma.tenderSession.updateMany({
      where: { templateId: id },
      data: { templateId: null },
    })

    await prisma.tenderTemplate.delete({
      where: { id },
    })

    const templates = await prisma.tenderTemplate.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: [{ scenario: "asc" }, { title: "asc" }],
      select: { id: true, locale: true, title: true, scenario: true, description: true, docxFields: true, updatedAt: true },
    })

    return NextResponse.json({ templates })
  } catch (error) {
    console.error("Failed to delete tender template:", error)
    return NextResponse.json(
      { error: "Failed to delete template", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
