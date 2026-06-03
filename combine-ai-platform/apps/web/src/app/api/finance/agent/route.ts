import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

export const dynamic = "force-dynamic"

async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string | unknown[] }>
}) {
  const apiUrl = process.env.LLM_API_URL || "https://api.poe.com/v1"
  const apiKey = process.env.LLM_API_KEY || ""
  const model = req.model || process.env.LLM_MODEL || "Claude-Sonnet-4.5"

  if (!apiKey) {
    throw new Error("LLM_API_KEY not configured. Set it in .env.local")
  }

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 2000,
      response_format: req.responseFormat === "json" ? { type: "json_object" } : undefined,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`AI provider error: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as Record<string, unknown>
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
  const message = choice?.message as Record<string, unknown> | undefined

  return {
    messageContent: (message?.content as string) || "",
    model,
  }
}

const EXTRACTION_PROMPT = `You are a financial document extraction assistant for Hong Kong enterprises.
Analyze this receipt/invoice image and extract structured data.

For each data point found, create a field-value pair:
- "field": Standardized label (e.g., "Vendor Name", "Invoice Number", "Date", "Subtotal", "Tax", "Total Amount", "Currency", "Payment Method")
- "value": The exact value from the document

For line items, use format: "Item 1 - Description", "Item 1 - Quantity", "Item 1 - Unit Price", "Item 1 - Amount"

Also identify:
- "documentType": "receipt" | "invoice" | "other"
- "currency": detected currency code
- "taxId": business registration number if visible

Respond ONLY with valid JSON:
{ "documentType": "...", "rows": [{"field": "...", "value": "..."}], "currency": "...", "taxId": "..." }`

const POLICY_CHECK_PROMPT = `You are a financial compliance checker for a Hong Kong enterprise.
Given extracted expense data and company policies, check each policy rule.

Policies:
{policies}

Extracted Data:
{data}

For each policy, determine if the expense passes or fails. Provide details.
Respond ONLY with valid JSON:
{ "policyResults": [{"rule": "policy_rule_name", "passed": true|false, "detail": "explanation"}] }`

const THREE_WAY_MATCH_PROMPT = `You are a financial auditor comparing three documents: Purchase Order (PO), Goods Receipt Note (GRN), and Supplier Invoice.

Compare line items across all three documents and identify:
1. Items matching across all 3 (quantity, unit price, total)
2. Quantity discrepancies (PO vs GRN vs Invoice)
3. Price discrepancies (PO vs Invoice)
4. Items in Invoice not in PO
5. Items in PO without GRN match

Respond ONLY with valid JSON:
{
  "matchedItems": [{"poItem": "item name", "grnQty": N, "invQty": N, "poPrice": N, "invPrice": N, "status": "match|qty_mismatch|price_mismatch|missing_grn|missing_po"}],
  "summary": {"totalMatchCount": N, "discrepancyCount": N, "totalPOAmount": N, "totalInvAmount": N, "variance": N},
  "flags": ["critical issue descriptions"]
}`

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "extract"
    const body = await request.json() as Record<string, unknown>

    switch (action) {
      case "extract": {
        const { sessionId, fileBase64, fileName, instructions } = body
        if (!sessionId || !fileBase64) {
          return NextResponse.json({ error: "sessionId and fileBase64 required" }, { status: 400 })
        }

        // Verify session ownership
        const financeSession = await prisma.financeSession.findFirst({
          where: { id: sessionId as string, workspaceId: session.workspaceId },
        })
        if (!financeSession) return NextResponse.json({ error: "Session not found" }, { status: 404 })

        // Build messages with image content
        const messages: Array<{ role: string; content: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> }> = [
          { role: "system", content: [{ type: "text", text: EXTRACTION_PROMPT }] },
          {
            role: "user",
            content: [
              { type: "text", text: instructions ? `Additional instructions: ${instructions}` : "Extract all data from this document." },
              { type: "image_url", image_url: { url: fileBase64 as string, detail: "high" } },
            ],
          },
        ]

        const result = await callAI({
          temperature: 0.3,
          maxTokens: 2000,
          responseFormat: "json",
          messages: messages as Array<{ role: string; content: unknown[] }>,
        })

        // Parse extraction result
        let extracted: { documentType?: string; rows?: Array<{ field: string; value: string }>; currency?: string; taxId?: string } = {}
        try {
          const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
          extracted = JSON.parse(cleaned)
        } catch {
          // Try to extract from raw text
          extracted = { rows: [{ field: "Raw Extraction", value: result.messageContent }] }
        }

        const rows = extracted.rows || []

        // Update session with extracted rows
        await prisma.financeSession.update({
          where: { id: sessionId as string },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { extractedRows: rows as any },
        })

        // Create conversation turns
        await prisma.financeConversationTurn.create({
          data: {
            sessionId: sessionId as string,
            role: "user",
            content: `Uploaded: ${fileName || "document"}`,
          },
        })
        await prisma.financeConversationTurn.create({
          data: {
            sessionId: sessionId as string,
            role: "assistant",
            content: `Extracted ${rows.length} fields`,
            assistantReply: JSON.stringify(extracted),
          },
        })

        // Create AgentRun record
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            kind: "FINANCE_EXTRACTION",
            status: "COMPLETED",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input: { fileName: fileName as string, fileBase64: (fileBase64 as string).slice(0, 100) } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: extracted as any,
          },
        })

        return NextResponse.json({ rows, documentType: extracted.documentType, currency: extracted.currency })
      }

      case "check-policy": {
        const { sessionId } = body
        if (!sessionId) {
          return NextResponse.json({ error: "sessionId required" }, { status: 400 })
        }

        const financeSession = await prisma.financeSession.findFirst({
          where: { id: sessionId as string, workspaceId: session.workspaceId },
        })
        if (!financeSession) return NextResponse.json({ error: "Session not found" }, { status: 404 })

        // Load policies
        const policies = await prisma.expensePolicy.findMany({
          where: { workspaceId: session.workspaceId, enabled: true },
        })

        if (policies.length === 0) {
          return NextResponse.json({ policyResults: [], message: "No policies configured" })
        }

        const policyText = policies.map((p) =>
          `- ${p.name} (${p.rule}): max ${p.threshold} ${p.unit}. ${p.description || ""}`
        ).join("\n")

        const prompt = POLICY_CHECK_PROMPT
          .replace("{policies}", policyText)
          .replace("{data}", JSON.stringify(financeSession.extractedRows || []))

        const result = await callAI({
          temperature: 0.2,
          maxTokens: 1000,
          responseFormat: "json",
          messages: [
            { role: "system", content: prompt },
          ],
        })

        let policyResults: Array<{ rule: string; passed: boolean; detail: string }> = []
        try {
          const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
          const parsed = JSON.parse(cleaned)
          policyResults = parsed.policyResults || []
        } catch {
          policyResults = [{ rule: "parse_error", passed: false, detail: "Failed to parse policy check result" }]
        }

        // Update session
        await prisma.financeSession.update({
          where: { id: sessionId as string },
          data: { policyResults },
        })

        // Create AgentRun
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            kind: "FINANCE_POLICY_CHECK",
            status: "COMPLETED",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input: { sessionId: sessionId as string, policyCount: policies.length } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: { policyResults } as any,
          },
        })

        return NextResponse.json({ policyResults })
      }

      case "three-way-match": {
        const { sessionId, poData, grnData, invData } = body
        if (!sessionId || !poData || !grnData || !invData) {
          return NextResponse.json({ error: "sessionId, poData, grnData, invData required" }, { status: 400 })
        }

        const financeSession = await prisma.financeSession.findFirst({
          where: { id: sessionId as string, workspaceId: session.workspaceId },
        })
        if (!financeSession) return NextResponse.json({ error: "Session not found" }, { status: 404 })

        const userMessage = `PO Data:\n${JSON.stringify(poData)}\n\nGRN Data:\n${JSON.stringify(grnData)}\n\nInvoice Data:\n${JSON.stringify(invData)}`

        const result = await callAI({
          temperature: 0.2,
          maxTokens: 3000,
          responseFormat: "json",
          messages: [
            { role: "system", content: THREE_WAY_MATCH_PROMPT },
            { role: "user", content: userMessage },
          ],
        })

        let matchResult: Record<string, unknown> = {}
        try {
          const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
          matchResult = JSON.parse(cleaned)
        } catch {
          matchResult = { error: "Failed to parse matching result" }
        }

        // Update session
        await prisma.financeSession.update({
          where: { id: sessionId as string },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { extractedRows: matchResult as any },
        })

        // Create AgentRun
        await prisma.agentRun.create({
          data: {
            workspaceId: session.workspaceId,
            kind: "FINANCE_THREE_WAY_MATCH",
            status: "COMPLETED",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input: { sessionId: sessionId as string } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: matchResult as any,
          },
        })

        return NextResponse.json(matchResult)
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error("Finance agent API error:", error)
    return NextResponse.json({
      error: "Agent processing failed",
      detail: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}
