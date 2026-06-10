import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { extractTextFromDocument, validateDocumentText } from "@/lib/server/document-text"
import { mockTenderResult, mockTenderCompare } from "@/lib/server/mock-extraction"
import type { Prisma } from "@prisma/client"
import { getDashScopeProvider, DEFAULT_MODELS } from "@combine-ai/ai-provider"

export const dynamic = "force-dynamic"
export const maxDuration = 120

const DOCUMENT_TEXT_LIMIT = 20000

type ExtractedTender = {
  tenderTitle?: string
  tenderType?: string
  fields?: Array<{ field: string; value: string }>
  keyRequirements?: string[]
  deadlines?: Array<{ label: string; date: string | null }>
  confidence?: number
}

function normalizeExtractedFields(extracted: ExtractedTender): Array<{ field: string; value: string }> {
  const fields = extracted.fields || []
  if (fields.length > 0) return fields

  const flattened: Array<{ field: string; value: string }> = []
  for (const req of extracted.keyRequirements || []) {
    if (req.trim()) flattened.push({ field: "Key Requirement", value: req })
  }
  for (const dl of extracted.deadlines || []) {
    if (dl.label?.trim()) {
      flattened.push({ field: dl.label, value: dl.date || "TBD" })
    }
  }
  return flattened
}

function buildExtractionPrompt(
  documentText: string,
  fileName?: string,
  instructions?: string
): string {
  const textSlice = documentText.slice(0, DOCUMENT_TEXT_LIMIT)
  if (instructions) {
    return `Analyze this tender document and extract all structured fields. File: ${fileName || "document"}. Additional instructions: ${instructions}\n\nDocument text:\n${textSlice}`
  }
  return `Analyze this tender document and extract all structured fields. File: ${fileName || "document"}\n\nDocument text:\n${textSlice}`
}

// ── AI Provider ───────────────────────────────────────────────

async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string | unknown[] }>
  tools?: unknown[]
}) {
  const provider = getDashScopeProvider()
  return provider.createCompletion({
    model: req.model || DEFAULT_MODELS.tender,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 2000,
    responseFormat: req.responseFormat,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: req.messages as any,
    tools: req.tools as any,
  })
}

// ── Prompt Templates ──────────────────────────────────────────

const TENDER_EXTRACTION_PROMPT = `You are a tender and procurement analysis assistant for a Hong Kong enterprise (B2B context).
Analyze the uploaded tender/RFP/bidding document and extract ALL structured information.

Extract the following categories of fields:

1. TENDER IDENTIFICATION:
   - Tender Reference Number
   - Tender Title
   - Issuing Organization
   - Tender Type (Open/Selective/Single Source)
   - Industry/Sector

2. SCOPE OF WORK:
   - Services Included (list all)
   - Services Excluded
   - Deliverables
   - Key Requirements / Qualifications
   - Contract Duration / Period

3. FINANCIAL:
   - Estimated Budget / Tender Value
   - Currency
   - Payment Terms
   - Bid Bond Required (Y/N, amount)
   - Performance Bond Required (Y/N, %)

4. TIMELINE:
   - Tender Issue Date
   - Site Visit Date (if any)
   - Clarification Deadline
   - Submission Deadline
   - Tender Validity Period
   - Award Date (if specified)
   - Contract Start Date

5. SUBMISSION REQUIREMENTS:
   - Submission Method (email, portal, hard copy)
   - Required Documents (list)
   - Technical Proposal Format
   - Financial Proposal Format
   - Language Requirements
   - Number of Copies

6. EVALUATION:
   - Evaluation Criteria / Weighting
   - Technical Score Weight
   - Price Score Weight
   - Presentation/Interview Required
   - Shortlist Process

7. CONTACTS:
   - Contact Person
   - Contact Email
   - Contact Phone
   - Department

For each extracted value, be as specific as possible. Use the exact text from the document.
Format dates as YYYY-MM-DD.
Format monetary amounts with currency.
If a field cannot be found, omit it — do not invent data.

Respond ONLY with valid JSON:
{
  "tenderTitle": "extracted title",
  "tenderType": "client_tender|company_bid|rfp|rfq|other",
  "fields": [
    { "field": "standardized_label", "value": "exact_value" }
  ],
  "keyRequirements": ["requirement 1", "requirement 2"],
  "deadlines": [
    { "label": "deadline description", "date": "YYYY-MM-DD or null" }
  ],
  "confidence": 0.0-1.0
}`

const TENDER_TEMPLATE_SELECTION_PROMPT = `You are a tender analysis assistant. The user has uploaded a tender document.
Select the most appropriate template for analyzing this tender.

Available templates:
{templates}

User input:
{userPrompt}

Choose the best matching template based on:
1. The document content and type
2. The industry/sector it belongs to
3. The template title and description match

Respond ONLY with valid JSON:
{ "selectedTemplateId": "template-id", "reason": "why this template was selected", "confidence": 0.0-1.0 }`

const TENDER_COMPARISON_PROMPT = `You are a procurement comparison analyst. Compare the following tender documents and identify similarities, differences, advantages, and risks.

TENDER A:
{tenderA}

TENDER B:
{tenderB}

Provide:
1. Side-by-side field comparison (align common fields)
2. Key differences (price, scope, timeline, requirements)
3. Risk analysis for each
4. Recommendation summary

Respond ONLY with valid JSON:
{
  "comparisonFields": [
    {
      "field": "field name",
      "tenderAValue": "value from Tender A",
      "tenderBValue": "value from Tender B",
      "match": true|false,
      "difference": "description of difference if any"
    }
  ],
  "keyDifferences": ["difference 1", "difference 2"],
  "risksA": ["risk from tender A"],
  "risksB": ["risk from tender B"],
  "recommendation": {
    "preferred": "A"|"B"|"neither",
    "reason": "explanation"
  }
}`

const TENDER_THREE_WAY_MATCH_PROMPT = `You are a procurement auditor performing a 3-Way Match analysis.
You will be given extracted text from Purchase Order (PO), Goods Receipt Note (GRN), and Supplier Invoice documents.
There may be multiple files per category — treat all files within each category as a combined set.

Your task is to:
1. Identify all line items across the three document sets
2. Match corresponding items by name/description
3. Compare quantities: PO quantity vs GRN received quantity vs Invoice quantity
4. Compare prices: PO unit price vs Invoice unit price
5. Detect and flag any discrepancies

Categorize each item status:
- "match": Quantities and prices agree across all three documents
- "qty_mismatch": Quantities differ between GRN and Invoice (or PO)
- "price_mismatch": Unit price in Invoice differs from PO
- "missing_grn": Item in Invoice/PO but no corresponding GRN entry
- "missing_po": Item in Invoice but not found in any PO

Respond ONLY with valid JSON:
{
  "matchedItems": [
    {
      "poItem": "item name/description",
      "grnQty": 0,
      "invQty": 0,
      "poPrice": 0,
      "invPrice": 0,
      "status": "match|qty_mismatch|price_mismatch|missing_grn|missing_po"
    }
  ],
  "summary": {
    "totalMatchCount": 0,
    "discrepancyCount": 0,
    "totalPOAmount": 0,
    "totalInvAmount": 0,
    "variance": 0
  },
  "flags": ["description of critical issues"]
}`

const TENDER_FIELDS_TOOL = {
  type: "function" as const,
  function: {
    name: "apply_tender_fields",
    description: "Apply extracted tender fields from the document analysis.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string", description: "Standardized field label" },
              value: { type: "string", description: "Exact value from the document" },
            },
            required: ["field", "value"],
          },
        },
        tenderTitle: { type: "string" },
        tenderType: { type: "string", enum: ["client_tender", "company_bid", "rfp", "rfq", "other"] },
        keyRequirements: {
          type: "array",
          items: { type: "string" },
        },
        confidence: { type: "number" },
      },
      required: ["fields"],
    },
  },
}

// ── SSE Helpers ────────────────────────────────────────────────

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ── POST Handler ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const url = new URL(request.url)
    const action = url.searchParams.get("action") || "extract"
    const stream = url.searchParams.get("stream") === "1"
    const contentType = request.headers.get("content-type") || ""

    // Handle multipart file upload
    if (contentType.includes("multipart/form-data")) {
      return stream
        ? handleStreamMultipartExtract(request, session)
        : handleMultipartExtract(request, session)
    }

    const body = (await request.json()) as Record<string, unknown>

    switch (action) {
      case "extract":
        return stream
          ? handleStreamExtract(session, body)
          : handleExtract(session, body)

      case "select-template":
        return handleSelectTemplate(session, body)

      case "compare":
        return handleCompare(session, body)

      case "generate-docx":
        return handleGenerateDocx(session, body)

      case "three-way-match":
        return handleTenderThreeWayMatch(session, body)

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error("Tender agent API error:", error)
    return NextResponse.json(
      {
        error: "Agent processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

// ── Multipart Extraction ──────────────────────────────────────

async function extractTextFromUploadedFile(file: File): Promise<string | undefined> {
  const arrayBuffer = await file.arrayBuffer()
  const mimeType = file.type || "application/octet-stream"
  try {
    return await extractTextFromDocument(Buffer.from(arrayBuffer), file.name, mimeType)
  } catch (err) {
    console.error("Tender document extraction failed:", file.name, err)
    return undefined
  }
}

async function handleStreamMultipartExtract(
  request: NextRequest,
  session: { sub: string; workspaceId: string }
) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const sessionId = formData.get("sessionId") as string | null
    const instructions = formData.get("instructions") as string | null
    const templateId = formData.get("templateId") as string | null
    const model = formData.get("model") as string | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const documentText = await extractTextFromUploadedFile(file)

    return handleStreamExtract(session, {
      documentText,
      fileName: file.name,
      sessionId: sessionId || undefined,
      instructions: instructions || undefined,
      templateId: templateId || undefined,
      model: model || undefined,
    })
  } catch (error) {
    console.error("Stream multipart tender extraction error:", error)
    return NextResponse.json(
      {
        error: "File processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

async function handleMultipartExtract(
  request: NextRequest,
  session: { sub: string; workspaceId: string }
) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const sessionId = formData.get("sessionId") as string | null
    const instructions = formData.get("instructions") as string | null
    const templateId = formData.get("templateId") as string | null
    const model = formData.get("model") as string | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const documentText = await extractTextFromUploadedFile(file)
    const validationError = validateDocumentText(documentText)
    if (validationError) {
      return NextResponse.json({ error: validationError, detail: validationError }, { status: 400 })
    }

    return performExtraction(session, {
      documentText,
      fileName: file.name,
      sessionId: sessionId || undefined,
      instructions: instructions || undefined,
      templateId: templateId || undefined,
      model: model || undefined,
    })
  } catch (error) {
    console.error("Multipart tender extraction error:", error)
    return NextResponse.json(
      {
        error: "File processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

// ── Standard Extraction ───────────────────────────────────────

async function handleExtract(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { sessionId, documentText, fileName, instructions, templateId } = body
  const model = body.model as string | undefined

  if (!documentText) {
    return NextResponse.json({ error: "documentText required" }, { status: 400 })
  }

  return performExtraction(session, {
    documentText: documentText as string,
    fileName: fileName as string | undefined,
    sessionId: sessionId as string | undefined,
    instructions: instructions as string | undefined,
    templateId: templateId as string | undefined,
    model,
  })
}

interface TenderExtractionParams {
  documentText?: string
  fileName?: string
  sessionId?: string
  instructions?: string
  templateId?: string
  model?: string
}

async function performExtraction(
  session: { sub: string; workspaceId: string },
  params: TenderExtractionParams
) {
  const { documentText, fileName, sessionId, instructions, model } = params

  const validationError = validateDocumentText(documentText)
  if (validationError) {
    return NextResponse.json({ error: validationError, detail: validationError }, { status: 400 })
  }

  const userPrompt = buildExtractionPrompt(documentText!, fileName, instructions)

  // ── Try AI extraction, fallback to mock template if no API key ──
  let extracted: ExtractedTender = {}
  let modelUsed = "unknown"

  try {
    const result = await callAI({
      model,
      temperature: 0.2,
      maxTokens: 3000,
      responseFormat: "json",
      tools: [TENDER_FIELDS_TOOL],
      messages: [
        { role: "system", content: TENDER_EXTRACTION_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    modelUsed = result.model

    try {
      if (result.toolCalls.length > 0) {
        const toolCall = result.toolCalls[0]
        if (toolCall?.function?.arguments) {
          extracted = JSON.parse(toolCall.function.arguments)
        }
      } else {
        const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
        extracted = JSON.parse(cleaned)
      }
    } catch {
      extracted = {
        fields: [{ field: "AI Analysis", value: result.messageContent.slice(0, 500) }],
        tenderType: "other",
      }
    }
  } catch (aiErr) {
    console.warn("AI tender extraction unavailable, using mock template:", (aiErr as Error).message)
    const mock = mockTenderResult(fileName)
    extracted = {
      tenderTitle: mock.tenderTitle,
      tenderType: mock.tenderType,
      fields: mock.fields,
      keyRequirements: mock.keyRequirements,
      deadlines: mock.deadlines,
      confidence: mock.confidence,
    }
    modelUsed = mock.model
  }

  const fields = normalizeExtractedFields(extracted)
  const fieldInputs: Record<string, string> = {}
  for (const f of fields) {
    fieldInputs[f.field] = f.value
  }

  // Save to session if sessionId provided
  if (sessionId) {
    try {
      const existing = await prisma.tenderSession.findFirst({
        where: { id: sessionId, workspaceId: session.workspaceId },
      })

      if (existing) {
        await prisma.tenderSession.update({
          where: { id: sessionId },
          data: {
            fieldInputs: fieldInputs as Prisma.InputJsonValue,
            tenderType: extracted.tenderType || existing.tenderType,
            status: "active",
          },
        })
      }
    } catch (dbErr) {
      console.error("Failed to save tender extraction:", dbErr)
    }
  }

  // Create AgentRun
  try {
    await prisma.agentRun.create({
      data: {
        workspaceId: session.workspaceId,
        kind: "TENDER_ANALYSIS",
        status: "COMPLETED",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: { fileName, hasText: !!documentText, textLength: documentText?.length } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output: { tenderType: extracted.tenderType, fieldCount: fields.length } as any,
      },
    })
  } catch (dbErr) {
    console.error("Failed to create AgentRun:", dbErr)
  }

  return NextResponse.json({
    fields,
    fieldInputs,
    tenderTitle: extracted.tenderTitle,
    tenderType: extracted.tenderType,
    keyRequirements: extracted.keyRequirements,
    deadlines: extracted.deadlines,
    confidence: extracted.confidence,
    model: modelUsed,
  })
}

// ── Streaming Extraction ──────────────────────────────────────

async function handleStreamExtract(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const sessionId = body.sessionId as string | undefined
  const documentText = body.documentText as string | undefined
  const fileName = body.fileName as string | undefined
  const instructions = body.instructions as string | undefined
  const model = body.model as string | undefined

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      try {
        const validationError = validateDocumentText(documentText)
        if (validationError) {
          send("error", {
            error: "Text extraction failed",
            detail: validationError,
            code: "TEXT_EXTRACTION_FAILED",
          })
          return
        }

        const userPrompt = buildExtractionPrompt(documentText!, fileName, instructions)

        send("trace", {
          trace: {
            id: "tender-extract-start",
            at: new Date().toISOString(),
            stage: "extraction",
            status: "running",
            title: "Analyzing tender document",
            detail: fileName
              ? `Processing: ${fileName} (${documentText!.length.toLocaleString()} chars)`
              : `Processing tender document (${documentText!.length.toLocaleString()} chars)`,
          },
        })

        send("thinking", { text: "Sending tender document to AI for analysis..." })

        // ── Try AI, fallback to mock if no API key ──
        let extracted: ExtractedTender = {}
        let modelUsed = "unknown"

        try {
          const result = await callAI({
            model,
            temperature: 0.2,
            maxTokens: 3000,
            responseFormat: "json",
            tools: [TENDER_FIELDS_TOOL],
            messages: [
              { role: "system", content: TENDER_EXTRACTION_PROMPT },
              { role: "user", content: userPrompt },
            ],
          })

          modelUsed = result.model

          try {
            if (result.toolCalls.length > 0) {
              const tc = result.toolCalls[0]
              if (tc?.function?.arguments) {
                extracted = JSON.parse(tc.function.arguments)
              }
            } else {
              const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
              extracted = JSON.parse(cleaned)
            }
          } catch {
            extracted = {
              fields: [{ field: "AI Analysis", value: result.messageContent.slice(0, 500) }],
              tenderType: "other",
            }
          }
        } catch (aiErr) {
          console.warn("AI tender stream extraction unavailable, using mock template:", (aiErr as Error).message)
          const mock = mockTenderResult(fileName)
          extracted = {
            tenderTitle: mock.tenderTitle,
            tenderType: mock.tenderType,
            fields: mock.fields,
            keyRequirements: mock.keyRequirements,
            deadlines: mock.deadlines,
            confidence: mock.confidence,
          }
          modelUsed = mock.model
        }

        const fields = normalizeExtractedFields(extracted)
        const fieldInputs: Record<string, string> = {}
        for (const f of fields) {
          fieldInputs[f.field] = f.value
        }

        send("trace", {
          trace: {
            id: "tender-extract-done",
            at: new Date().toISOString(),
            stage: "extraction",
            status: "complete",
            title: "Extraction complete",
            detail: `Extracted ${fields.length} fields (${extracted.tenderType || "general"})`,
          },
        })

        // Save to session
        if (sessionId) {
          try {
            const existing = await prisma.tenderSession.findFirst({
              where: { id: sessionId, workspaceId: session.workspaceId },
            })
            if (existing) {
              await prisma.tenderSession.update({
                where: { id: sessionId },
                data: {
                  fieldInputs: fieldInputs as Prisma.InputJsonValue,
                  tenderType: extracted.tenderType || existing.tenderType,
                  status: "active",
                },
              })
            }
          } catch (dbErr) {
            console.error("Failed to save stream extraction:", dbErr)
          }
        }

        send("result", {
          result: {
            selectedTemplateId: null,
            selectedByAgent: false,
            selectionReason: "",
            fields,
            fieldUpdates: fieldInputs,
            applied: true,
            appliedAt: new Date().toISOString(),
            model: modelUsed,
            tenderTitle: extracted.tenderTitle,
            tenderType: extracted.tenderType,
            confidence: extracted.confidence,
            keyRequirements: extracted.keyRequirements,
            deadlines: extracted.deadlines,
          },
        })
      } catch (error) {
        console.error("Stream extraction error:", error)
        send("error", {
          error: "Extraction failed",
          detail: error instanceof Error ? error.message : "Unknown error",
        })
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

// ── Template Selection ────────────────────────────────────────

async function handleSelectTemplate(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { userPrompt } = body

  if (!userPrompt || typeof userPrompt !== "string") {
    return NextResponse.json({ error: "userPrompt required" }, { status: 400 })
  }

  const templates = await prisma.tenderTemplate.findMany({
    where: { workspaceId: session.workspaceId },
    select: { id: true, title: true, description: true, scenario: true, locale: true },
  })

  if (templates.length === 0) {
    return NextResponse.json({ selectedTemplateId: null, reason: "No templates available", confidence: 0 })
  }

  const templateList = templates
    .map((t) => `- ID: ${t.id} | Title: ${t.title} | Scenario: ${t.scenario || "general"} | Locale: ${t.locale}\n  Description: ${t.description || "N/A"}`)
    .join("\n\n")

  const prompt = TENDER_TEMPLATE_SELECTION_PROMPT
    .replace("{templates}", templateList)
    .replace("{userPrompt}", userPrompt)

  const result = await callAI({
    temperature: 0.2,
    maxTokens: 500,
    responseFormat: "json",
    messages: [{ role: "system", content: prompt }],
  })

  let selection: { selectedTemplateId?: string; reason?: string; confidence?: number } = {}
  try {
    const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
    selection = JSON.parse(cleaned)
  } catch {
    selection = { selectedTemplateId: templates[0]?.id, reason: "Fallback to first template" }
  }

  return NextResponse.json({
    selectedTemplateId: selection.selectedTemplateId || null,
    reason: selection.reason,
    confidence: selection.confidence || 0,
  })
}

// ── Tender Comparison ─────────────────────────────────────────

interface TenderCompareData {
  id: string
  title: string
  fieldInputs: Record<string, string>
}

type AiComparisonResult = {
  keyDifferences?: string[]
  risksA?: string[]
  risksB?: string[]
  recommendation?: { preferred?: string; reason?: string }
}

function buildComparisonFields(tenderData: TenderCompareData[]) {
  const allFields = Array.from(
    new Set(tenderData.flatMap((t) => Object.keys(t.fieldInputs)))
  ).filter(Boolean)

  return allFields.map((field) => {
    const values = tenderData.map((t) => ({
      tenderId: t.id,
      tenderTitle: t.title,
      value: t.fieldInputs[field] || "—",
    }))
    const allMatch = values.length >= 2 && values.every((v) => v.value === values[0].value)
    return { field, values, match: allMatch }
  })
}

async function runAiComparison(tenderData: TenderCompareData[]): Promise<AiComparisonResult> {
  if (tenderData.length !== 2) return {}

  try {
    const prompt = TENDER_COMPARISON_PROMPT
      .replace("{tenderA}", JSON.stringify(tenderData[0]))
      .replace("{tenderB}", JSON.stringify(tenderData[1]))

    const result = await callAI({
      temperature: 0.3,
      maxTokens: 2000,
      responseFormat: "json",
      messages: [{ role: "system", content: prompt }],
    })

    try {
      const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
      return JSON.parse(cleaned) as AiComparisonResult
    } catch {
      return {}
    }
  } catch (aiErr) {
    console.warn("AI comparison unavailable, using mock template:", (aiErr as Error).message)
    const mock = mockTenderCompare(tenderData.map((t) => t.title))
    return {
      keyDifferences: mock.keyDifferences,
      risksA: mock.risksA,
      risksB: mock.risksB,
      recommendation: mock.recommendation,
    }
  }
}

function parseInlineTenders(
  inlineTenders: Array<{
    title: string
    fields?: Array<{ field: string; value: string }> | Record<string, string>
  }>
): TenderCompareData[] {
  return inlineTenders.map((t, i) => {
    const fieldInputs: Record<string, string> = {}
    if (Array.isArray(t.fields)) {
      for (const f of t.fields) {
        if (f.field?.trim()) fieldInputs[f.field] = f.value
      }
    } else if (t.fields) {
      Object.assign(fieldInputs, t.fields)
    }
    return {
      id: `inline-${i}`,
      title: t.title,
      fieldInputs,
    }
  })
}

async function handleCompare(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { sessionIdA, sessionIdB, sessionIds, tenders: inlineTenders } = body

  let tenderData: TenderCompareData[]
  let idsToCompare: string[] = []
  let persistToDb = true

  if (Array.isArray(inlineTenders) && inlineTenders.length >= 2) {
    tenderData = parseInlineTenders(
      inlineTenders as Array<{
        title: string
        fields?: Array<{ field: string; value: string }> | Record<string, string>
      }>
    )
    persistToDb = false
  } else {
    idsToCompare = sessionIds
      ? (sessionIds as string[])
      : [sessionIdA as string, sessionIdB as string].filter(Boolean)

    if (idsToCompare.length < 2) {
      return NextResponse.json(
        { error: "At least 2 tenders required (sessionIds or inline tenders array)" },
        { status: 400 }
      )
    }

    const tenderSessions = await prisma.tenderSession.findMany({
      where: {
        id: { in: idsToCompare },
        workspaceId: session.workspaceId,
      },
    })

    if (tenderSessions.length < 2) {
      return NextResponse.json({ error: "Not enough valid tender sessions found" }, { status: 404 })
    }

    tenderData = tenderSessions.map((t) => ({
      id: t.id,
      title: t.title,
      fieldInputs: (t.fieldInputs as Record<string, string>) || {},
    }))
  }

  const comparisonFields = buildComparisonFields(tenderData)
  const aiComparison = await runAiComparison(tenderData)

  if (persistToDb) {
    try {
      await prisma.tenderComparison.create({
        data: {
          workspaceId: session.workspaceId,
          userId: session.sub,
          title: `Comparison: ${tenderData.map((t) => t.title).join(" vs ")}`,
          comparisonType: idsToCompare.length > 2 ? "multi_client" : "company_vs_competitor",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          comparisonData: { comparisonFields, ...aiComparison } as any,
          comparedTenderIds: idsToCompare,
        },
      })
    } catch (dbErr) {
      console.error("Failed to save comparison:", dbErr)
    }
  }

  return NextResponse.json({
    comparisonFields,
    tenders: tenderData,
    keyDifferences: aiComparison.keyDifferences || [],
    risksA: aiComparison.risksA || [],
    risksB: aiComparison.risksB || [],
    recommendation: aiComparison.recommendation || null,
  })
}

// ── Generate DOCX ─────────────────────────────────────────────

async function handleGenerateDocx(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { sessionId, templateId } = body

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 })
  }

  const tenderSession = await prisma.tenderSession.findFirst({
    where: { id: sessionId as string, workspaceId: session.workspaceId },
  })

  if (!tenderSession) {
    return NextResponse.json({ error: "Tender session not found" }, { status: 404 })
  }

  const resolvedTemplateId = templateId || tenderSession.templateId

  if (!resolvedTemplateId) {
    return NextResponse.json({ error: "No template selected for this tender session" }, { status: 400 })
  }

  const template = await prisma.tenderTemplate.findFirst({
    where: { id: resolvedTemplateId as string, workspaceId: session.workspaceId },
  })

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  // For now, return the field data that would be used to fill the template
  // Full DOCX generation requires docxtemplater on the server
  return NextResponse.json({
    templateId: template.id,
    templateTitle: template.title,
    fields: template.docxFields,
    fieldInputs: tenderSession.fieldInputs || {},
    message: "DOCX generation placeholder — fields returned for client-side processing",
  })
}

// ── Tender 3-Way Match ─────────────────────────────────────────

async function extractTextFromFiles(
  files: Array<{ name: string; base64: string }>
): Promise<string> {
  const texts: string[] = []
  for (const file of files) {
    try {
      const buffer = Buffer.from(file.base64, "base64")
      let extractedText = ""

      if (file.name.toLowerCase().endsWith(".pdf")) {
        try {
          // pdf-parse is CommonJS — use createRequire for ESM compatibility
          const { createRequire } = await import("module")
          const req = createRequire(import.meta.url)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pdfParse = req("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>
          const data = await pdfParse(buffer)
          extractedText = data.text || ""
          console.log(`[3-Way Match] Parsed PDF ${file.name}: ${extractedText.length} chars`)
        } catch (pdfErr) {
          console.warn(`[3-Way Match] pdf-parse failed for ${file.name}, falling back to text:`, (pdfErr as Error).message)
          // Strip non-printable bytes so the AI gets something legible
          extractedText = buffer.toString("utf-8").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
        }
      } else {
        extractedText = buffer.toString("utf-8")
      }

      texts.push(`[File: ${file.name}]\n${extractedText}`)
    } catch (fileErr) {
      console.error(`[3-Way Match] Failed to process file ${file.name}:`, fileErr)
      texts.push(`[File: ${file.name}]\n(Failed to process file)`)
    }
  }
  return texts.join("\n\n---\n\n")
}

async function handleTenderThreeWayMatch(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { poFiles, grnFiles, invFiles } = body as {
    poFiles?: Array<{ name: string; base64: string }>
    grnFiles?: Array<{ name: string; base64: string }>
    invFiles?: Array<{ name: string; base64: string }>
  }

  if (!poFiles?.length || !grnFiles?.length || !invFiles?.length) {
    return NextResponse.json(
      { error: "poFiles, grnFiles, and invFiles are required (at least one each)" },
      { status: 400 }
    )
  }

  // Extract text from all uploaded files in parallel
  const [poText, grnText, invText] = await Promise.all([
    extractTextFromFiles(poFiles),
    extractTextFromFiles(grnFiles),
    extractTextFromFiles(invFiles),
  ])

  const divider = "==".repeat(30)
  const userMessage = [
    `PURCHASE ORDER DOCUMENTS (${poFiles.length} file${poFiles.length > 1 ? "s" : ""}):\n${poText}`,
    `GOODS RECEIPT NOTE DOCUMENTS (${grnFiles.length} file${grnFiles.length > 1 ? "s" : ""}):\n${grnText}`,
    `SUPPLIER INVOICE DOCUMENTS (${invFiles.length} file${invFiles.length > 1 ? "s" : ""}):\n${invText}`,
  ].join(`\n\n${divider}\n\n`)

  let result
  try {
    result = await callAI({
      temperature: 0.2,
      maxTokens: 4000,
      responseFormat: "json",
      messages: [
        { role: "system", content: TENDER_THREE_WAY_MATCH_PROMPT },
        { role: "user", content: userMessage },
      ],
    })
  } catch (aiErr) {
    console.error("[3-Way Match] AI call failed:", aiErr)
    return NextResponse.json(
      { error: "AI service unavailable. Please try again later." },
      { status: 503 }
    )
  }

  let matchResult: Record<string, unknown> = {}
  try {
    const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
    matchResult = JSON.parse(cleaned)
  } catch {
    console.error("[3-Way Match] Failed to parse AI response:", result.messageContent.slice(0, 300))
    return NextResponse.json(
      { error: "AI returned an unreadable response. The documents may not contain enough structured procurement data." },
      { status: 422 }
    )
  }

  // Validate that the AI returned the expected shape
  if (!Array.isArray(matchResult.matchedItems) || typeof matchResult.summary !== "object") {
    console.error("[3-Way Match] AI response missing required fields:", JSON.stringify(matchResult).slice(0, 300))
    return NextResponse.json(
      { error: matchResult.error as string || "AI could not extract procurement data from the documents. Please ensure files contain readable PO / GRN / Invoice line items (text-based PDFs, DOCX, CSV or TXT work best)." },
      { status: 422 }
    )
  }

  // Create AgentRun record
  try {
    await prisma.agentRun.create({
      data: {
        workspaceId: session.workspaceId,
        kind: "FINANCE_THREE_WAY_MATCH",
        status: "COMPLETED",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: { poFileCount: poFiles.length, grnFileCount: grnFiles.length, invFileCount: invFiles.length } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output: matchResult as any,
      },
    })
  } catch (dbErr) {
    console.error("Failed to create AgentRun for three-way match:", dbErr)
  }

  return NextResponse.json(matchResult)
}

