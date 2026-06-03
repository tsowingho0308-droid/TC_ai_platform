import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { mockTenderResult, mockTenderCompare } from "@/lib/server/mock-extraction"
import type { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"
export const maxDuration = 120

// ── AI Provider ───────────────────────────────────────────────

async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "json" | "text"
  messages: Array<{ role: string; content: string | unknown[] }>
  tools?: unknown[]
}) {
  const apiUrl = process.env.LLM_API_URL || "https://api.poe.com/v1"
  const apiKey = process.env.LLM_API_KEY || ""
  const model = req.model || process.env.LLM_MODEL || "Claude-Sonnet-4.5"

  if (!apiKey) {
    throw new Error("LLM_API_KEY not configured. Set it in .env.local")
  }

  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
    max_tokens: req.maxTokens ?? 2000,
  }

  if (req.responseFormat === "json") {
    body.response_format = { type: "json_object" }
  }

  if (req.tools && Array.isArray(req.tools) && req.tools.length > 0) {
    body.tools = req.tools
  }

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`AI provider error: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
  const message = choice?.message as Record<string, unknown> | undefined

  if (!message) {
    throw new Error("AI provider returned no message")
  }

  return {
    messageContent: (message.content as string) || "",
    model,
    toolCalls: (message.tool_calls as Array<{
      id: string
      type: "function"
      function: { name: string; arguments: string }
    }>) || [],
  }
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
      return handleMultipartExtract(request, session)
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

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const text = await file.text().catch(() => "")

    return performExtraction(session, {
      documentText: text || undefined,
      fileName: file.name,
      sessionId: sessionId || undefined,
      instructions: instructions || undefined,
      templateId: templateId || undefined,
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

  if (!documentText) {
    return NextResponse.json({ error: "documentText required" }, { status: 400 })
  }

  return performExtraction(session, {
    documentText: documentText as string,
    fileName: fileName as string | undefined,
    sessionId: sessionId as string | undefined,
    instructions: instructions as string | undefined,
    templateId: templateId as string | undefined,
  })
}

interface TenderExtractionParams {
  documentText?: string
  fileName?: string
  sessionId?: string
  instructions?: string
  templateId?: string
}

async function performExtraction(
  session: { sub: string; workspaceId: string },
  params: TenderExtractionParams
) {
  const { documentText, fileName, sessionId, instructions } = params

  const userPrompt = instructions
    ? `Analyze this tender document and extract all structured fields. File: ${fileName || "document"}. Additional instructions: ${instructions}\n\nDocument text:\n${(documentText || "").slice(0, 8000)}`
    : `Analyze this tender document and extract all structured fields. File: ${fileName || "document"}\n\nDocument text:\n${(documentText || "").slice(0, 8000)}`

  // ── Try AI extraction, fallback to mock template if no API key ──
  let extracted: {
    tenderTitle?: string
    tenderType?: string
    fields?: Array<{ field: string; value: string }>
    keyRequirements?: string[]
    deadlines?: Array<{ label: string; date: string | null }>
    confidence?: number
  } = {}
  let modelUsed = "unknown"

  try {
    const result = await callAI({
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

  const fields = extracted.fields || []
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
        input: { fileName, hasText: !!documentText } as any,
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

  if (!documentText) {
    return NextResponse.json({ error: "documentText required" }, { status: 400 })
  }

  const userPrompt = instructions
    ? `Analyze this tender document and extract all structured fields. File: ${fileName || "document"}. Instructions: ${instructions}\n\nDocument text:\n${(documentText as string).slice(0, 8000)}`
    : `Analyze this tender document and extract all structured fields. File: ${fileName || "document"}\n\nDocument text:\n${(documentText as string).slice(0, 8000)}`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      try {
        send("trace", {
          trace: {
            id: "tender-extract-start",
            at: new Date().toISOString(),
            stage: "extraction",
            status: "running",
            title: "Analyzing tender document",
            detail: fileName ? `Processing: ${fileName}` : "Processing tender document",
          },
        })

        send("thinking", { text: "Sending tender document to AI for analysis..." })

        // ── Try AI, fallback to mock if no API key ──
        let extracted: {
          tenderTitle?: string
          tenderType?: string
          fields?: Array<{ field: string; value: string }>
          keyRequirements?: string[]
          deadlines?: Array<{ label: string; date: string | null }>
          confidence?: number
        } = {}
        let modelUsed = "unknown"

        try {
          const result = await callAI({
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

        const fields = extracted.fields || []
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
            fields: extracted.fields || [],
            fieldUpdates: fieldInputs,
            applied: true,
            appliedAt: new Date().toISOString(),
            model: modelUsed,
            tenderTitle: extracted.tenderTitle,
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

async function handleCompare(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { sessionIdA, sessionIdB, sessionIds } = body

  // Support both direct 2-tender compare and multi-tender compare
  const idsToCompare: string[] = sessionIds
    ? (sessionIds as string[])
    : [sessionIdA as string, sessionIdB as string].filter(Boolean)

  if (idsToCompare.length < 2) {
    return NextResponse.json({ error: "At least 2 tender session IDs required" }, { status: 400 })
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

  // Extract field data for comparison
  const tenderData = tenderSessions.map((t) => ({
    id: t.id,
    title: t.title,
    fieldInputs: (t.fieldInputs as Record<string, string>) || {},
  }))

  // Build aligned comparison
  const allFields = Array.from(
    new Set(tenderData.flatMap((t) => Object.keys(t.fieldInputs)))
  ).filter(Boolean)

  const comparisonFields = allFields.map((field) => {
    const values = tenderData.map((t) => ({
      tenderId: t.id,
      tenderTitle: t.title,
      value: t.fieldInputs[field] || "—",
    }))

    // Check if all values match
    const allMatch = values.length >= 2 && values.every((v) => v.value === values[0].value)

    return {
      field,
      values,
      match: allMatch,
    }
  })

  // If 2 tenders, optionally run AI comparison for deeper analysis
  let aiComparison: {
    keyDifferences?: string[]
    risksA?: string[]
    risksB?: string[]
    recommendation?: { preferred?: string; reason?: string }
  } = {}

  if (tenderData.length === 2) {
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
        aiComparison = JSON.parse(cleaned)
      } catch {
        aiComparison = {}
      }
    } catch (aiErr) {
      console.warn("AI comparison unavailable, using mock template:", (aiErr as Error).message)
      const mock = mockTenderCompare(tenderData.map((t) => t.title))
      aiComparison = {
        keyDifferences: mock.keyDifferences,
        risksA: mock.risksA,
        risksB: mock.risksB,
        recommendation: mock.recommendation,
      }
    }
  }

  // Save comparison to DB
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
