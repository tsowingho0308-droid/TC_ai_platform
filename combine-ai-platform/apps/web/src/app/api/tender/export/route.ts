import { NextResponse } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import {
  buildTenderComparisonXlsxBuffer,
  type ComparisonResultExport,
} from "@/lib/server/tender-comparison-export"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as {
      comparisonResult?: ComparisonResultExport
      showDiffsOnly?: boolean
      diffCount?: number
      matchCount?: number
    }

    const { comparisonResult, showDiffsOnly, diffCount, matchCount } = body

    if (!comparisonResult?.tenders?.length || comparisonResult.tenders.length < 2) {
      return NextResponse.json(
        { error: "At least 2 tenders required for comparison export" },
        { status: 400 }
      )
    }

    const buffer = await buildTenderComparisonXlsxBuffer({
      comparisonResult,
      showDiffsOnly,
      diffCount,
      matchCount,
    })

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="tender-comparison-${Date.now()}.xlsx"`,
      },
    })
  } catch (error) {
    console.error("Tender comparison export error:", error)
    return NextResponse.json(
      {
        error: "Export failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
