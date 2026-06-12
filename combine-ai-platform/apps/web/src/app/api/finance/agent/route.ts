import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import { getDashScopeProvider } from "@combine-ai/ai-provider/server"
import { FinanceDocType } from "@prisma/client"
import { extractTextFromDocument } from "@/lib/server/document-text"

export const dynamic = "force-dynamic"

async function callAI(req: {
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string | unknown[] }>
}) {
  const provider = getDashScopeProvider()
  const result = await provider.createCompletion({
    model: req.model || DEFAULT_MODELS.finance,
    systemPrompt: req.systemPrompt,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 2000,
    responseFormat: req.responseFormat,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: req.messages as any,
  })
  return {
    messageContent: result.messageContent,
    model: result.model,
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

function parseJsonObject<T>(value: string, fallback: T): T {
  try {
    const cleaned = value.replace(/```json\s*|\s*```/g, "").trim()
    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

function toFinanceDocType(value: unknown, fallback?: string): FinanceDocType {
  const raw = String(value || fallback || "").toLowerCase()
  if (raw.includes("purchase") || raw === "po") return FinanceDocType.PURCHASE_ORDER
  if (raw.includes("goods") || raw.includes("grn") || raw.includes("receipt note")) return FinanceDocType.GOODS_RECEIPT
  if (raw.includes("invoice")) return FinanceDocType.INVOICE
  return FinanceDocType.RECEIPT
}

function prefixRows(
  rows: Array<{ field: string; value: string }>,
  label?: string
) {
  if (!label) return rows
  return rows.map((row) => ({
    field: `${label} · ${row.field}`,
    value: row.value,
  }))
}

const VISION_MODEL = DEFAULT_MODELS.report

function decodeBase64DataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error("Invalid file data. Expected a base64 data URL.")
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  }
}

async function buildFinanceExtractionRequest(params: {
  fileBase64: string
  fileName: string
  instructions?: string
  model?: string
}) {
  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
  let model = params.model || DEFAULT_MODELS.finance

  if (params.fileBase64.startsWith("data:image/")) {
    userContent.push({
      type: "image_url",
      image_url: { url: params.fileBase64 },
    })
    userContent.push({
      type: "text",
      text: params.instructions
        ? `Extract all financial data from this receipt or invoice. File: ${params.fileName}. Additional instructions: ${params.instructions}`
        : `Extract all financial data from this receipt or invoice. File: ${params.fileName}`,
    })
    // Vision extraction works reliably on the general multimodal model.
    model = VISION_MODEL
  } else {
    const { mimeType, buffer } = decodeBase64DataUrl(params.fileBase64)
    let documentText = ""
    try {
      documentText = await extractTextFromDocument(buffer, params.fileName, mimeType)
    } catch {
      documentText = ""
    }

    if (documentText.trim()) {
      userContent.push({
        type: "text",
        text: params.instructions
          ? `Extract all financial data from this document (${params.fileName}):\n\n${documentText}\n\nAdditional instructions: ${params.instructions}`
          : `Extract all financial data from this document (${params.fileName}):\n\n${documentText}`,
      })
    } else {
      userContent.push({
        type: "text",
        text: params.instructions
          ? `Extract all financial data from the uploaded document (${params.fileName}). MIME type: ${mimeType}. Additional instructions: ${params.instructions}`
          : `Extract all financial data from the uploaded document (${params.fileName}). MIME type: ${mimeType}.`,
      })
    }
  }

  return {
    model,
    systemPrompt: EXTRACTION_PROMPT,
    messages: [{ role: "user", content: userContent }],
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "extract"
    const body = await request.json() as Record<string, unknown>

    switch (action) {
      case "extract": {
        const { sessionId, fileBase64, fileName, instructions, model, appendRows, sourceLabel, docType } = body
        if (!sessionId || !fileBase64) {
          return NextResponse.json({ error: "sessionId and fileBase64 required" }, { status: 400 })
        }

        // Verify session ownership
        const financeSession = await prisma.financeSession.findFirst({
          where: { id: sessionId as string, workspaceId: session.workspaceId },
        })
        if (!financeSession) return NextResponse.json({ error: "Session not found" }, { status: 404 })

        const extractionRequest = await buildFinanceExtractionRequest({
          fileBase64: fileBase64 as string,
          fileName: (fileName as string | undefined) || "document",
          instructions: instructions as string | undefined,
          model: model as string | undefined,
        })

        const result = await callAI({
          model: extractionRequest.model,
          systemPrompt: extractionRequest.systemPrompt,
          temperature: 0.3,
          maxTokens: 2000,
          responseFormat: "json",
          messages: extractionRequest.messages,
        })

        // Parse extraction result
        const extracted = parseJsonObject<{
          documentType?: string
          rows?: Array<{ field: string; value: string }>
          currency?: string
          taxId?: string
        }>(result.messageContent, {
          rows: [{ field: "Raw Extraction", value: result.messageContent }],
        })

        const rows = extracted.rows || []
        const rowsForSession = prefixRows(rows, sourceLabel as string | undefined)
        const existingRows = Array.isArray(financeSession.extractedRows)
          ? financeSession.extractedRows as Array<{ field: string; value: string }>
          : []
        const mergedRows = appendRows ? [...existingRows, ...rowsForSession] : rowsForSession

        // Update session with extracted rows
        await prisma.financeSession.update({
          where: { id: sessionId as string },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: {
            extractedRows: mergedRows as any,
            status: "analyzed",
          },
        })

        await prisma.financeDocument.create({
          data: {
            sessionId: sessionId as string,
            docType: toFinanceDocType(docType, extracted.documentType),
            fileName: (fileName as string | undefined) || "document",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            extractedData: extracted as any,
          },
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

        return NextResponse.json({
          rows,
          sessionRows: mergedRows,
          documentType: extracted.documentType,
          currency: extracted.currency,
          taxId: extracted.taxId,
        })
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
          systemPrompt: prompt,
          temperature: 0.2,
          maxTokens: 1000,
          responseFormat: "json",
          messages: [{ role: "user", content: "Run the policy compliance check." }],
        })

        const parsed = parseJsonObject<{
          policyResults?: Array<{ rule: string; passed: boolean; detail: string }>
        }>(result.messageContent, {
          policyResults: [{ rule: "parse_error", passed: false, detail: "Failed to parse policy check result" }],
        })
        const policyResults = parsed.policyResults || []

        // Update session
        await prisma.financeSession.update({
          where: { id: sessionId as string },
          data: {
            policyResults,
            status: policyResults.some((p) => !p.passed) ? "needs_review" : "approved",
          },
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
          systemPrompt: THREE_WAY_MATCH_PROMPT,
          temperature: 0.2,
          maxTokens: 3000,
          responseFormat: "json",
          messages: [{ role: "user", content: userMessage }],
        })

        const matchResult = parseJsonObject<Record<string, unknown>>(result.messageContent, {
          error: "Failed to parse matching result",
        })

        // Update session
        await prisma.financeSession.update({
          where: { id: sessionId as string },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: {
            extractedRows: matchResult as any,
            status: Array.isArray(matchResult.flags) && matchResult.flags.length > 0
              ? "needs_review"
              : "matched",
          },
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
