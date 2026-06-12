import { NextResponse } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import {
  buildEditedPdfFilename,
  buildEditedTenderPdfBuffer,
  type TenderFieldExport,
} from "@/lib/server/tender-edited-pdf-export"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as {
      name?: string
      fileName?: string
      fields?: TenderFieldExport[]
    }

    const { name, fileName, fields } = body

    if (!fields || fields.length === 0) {
      return NextResponse.json({ error: "No fields provided" }, { status: 400 })
    }

    const buffer = await buildEditedTenderPdfBuffer({
      name: name || fileName || "Tender",
      fileName,
      fields,
    })

    const downloadName = buildEditedPdfFilename(fileName, name)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
      },
    })
  } catch (error) {
    console.error("Tender PDF export error:", error)
    return NextResponse.json(
      {
        error: "Export failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
