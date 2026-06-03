import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { rows } = await request.json() as {
      rows?: Array<{ field: string; value: string }>
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 })
    }

    // Generate simple CSV (placeholder for full XLSX with SheetJS)
    const header = "Field,Value"
    const body = rows
      .map((r) => `"${(r.field || "").replace(/"/g, '""')}","${(r.value || "").replace(/"/g, '""')}"`)
      .join("\n")
    const csv = `${header}\n${body}`

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="report-${Date.now()}.csv"`,
      },
    })
  } catch (error) {
    console.error("Export error:", error)
    return NextResponse.json({ error: "Export failed" }, { status: 500 })
  }
}
