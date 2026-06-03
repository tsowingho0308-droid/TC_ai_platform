import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"

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

const REPORT_EXTRACTION_PROMPT = `You are a document data extraction assistant for a Hong Kong enterprise.
Analyze the uploaded document (image, scanned document, PDF, or text) and extract ALL structured field-value data you can find.

Rules:
1. For each data point, create a "field" (standardized label) and "value" (exact text from the document).
2. Group related items using numbered suffixes (e.g., "Item 1 - Description", "Item 1 - Quantity").
3. Detect document metadata: document type, date, reference numbers, totals, parties involved.
4. Identify all monetary amounts with their currency.
5. Extract dates in YYYY-MM-DD format when possible.
6. Extract names, addresses, phone numbers, and email addresses.
7. For tables, extract column headers as field prefixes and row data accordingly.
8. Preserve exact values — do not modify, summarize, or translate.
9. Flag any unclear or ambiguous text with "⚠️" prefix.

Respond ONLY with valid JSON:
{
  "documentType": "report|invoice|receipt|contract|letter|form|other",
  "title": "extracted document title or subject",
  "rows": [
    { "field": "standardized_label", "value": "exact_value" }
  ],
  "metadata": {
    "date": "YYYY-MM-DD or null",
    "referenceNumber": "string or null",
    "totalAmount": "number or null",
    "currency": "HKD|USD|CNY|etc or null",
    "parties": ["party names"],
    "pageCount": "number or null"
  }
}`

const REPORT_REFINEMENT_PROMPT = `You are a document data extraction assistant. The user has provided additional instructions or corrections for the extracted data.

Current extracted data:
{currentRows}

User instructions:
{instructions}

Apply the user's instructions to modify the rows. You may:
- Add new rows
- Update existing rows' field names or values
- Remove rows as requested
- Reorganize or reformat data

Respond ONLY with valid JSON:
{
  "rows": [
    { "field": "standardized_label", "value": "exact_value" }
  ],
  "changes": "description of what was changed",
  "applied": true
}`

const EXTRACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "apply_field_updates",
    description: "Apply extracted field-value pairs from the document. Call this when you have finished extracting data.",
    parameters: {
      type: "object",
      properties: {
        rows: {
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
        documentType: { type: "string", description: "Type of document" },
        title: { type: "string", description: "Document title" },
        confidence: { type: "number", description: "Overall extraction confidence 0-1" },
      },
      required: ["rows"],
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

    // ── Multipart file upload (non-streaming) ──
    if (contentType.includes("multipart/form-data")) {
      return handleMultipartExtract(request, session)
    }

    const body = (await request.json()) as Record<string, unknown>

    switch (action) {
      case "extract":
        return stream
          ? handleStreamExtract(session, body)
          : handleExtract(session, body)

      case "refine":
        return handleRefine(session, body)

      case "summarize":
        return handleSummarize(session, body)

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error("Report agent API error:", error)
    return NextResponse.json(
      {
        error: "Agent processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

// ── Multipart Upload Extraction ───────────────────────────────

async function handleMultipartExtract(request: NextRequest, session: { sub: string; workspaceId: string }) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const sessionId = formData.get("sessionId") as string | null
    const instructions = formData.get("instructions") as string | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")
    const mimeType = file.type || "application/octet-stream"
    const dataUrl = `data:${mimeType};base64,${base64}`

    return performExtraction(session, {
      fileBase64: dataUrl,
      fileName: file.name,
      sessionId: sessionId || undefined,
      instructions: instructions || undefined,
    })
  } catch (error) {
    console.error("Multipart extraction error:", error)
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
  const { sessionId, fileBase64, fileName, instructions, documentText } = body

  if (!fileBase64 && !documentText) {
    return NextResponse.json({ error: "fileBase64 or documentText required" }, { status: 400 })
  }

  return performExtraction(session, {
    fileBase64: fileBase64 as string | undefined,
    fileName: fileName as string | undefined,
    sessionId: sessionId as string | undefined,
    instructions: instructions as string | undefined,
    documentText: documentText as string | undefined,
  })
}

interface ExtractionParams {
  fileBase64?: string
  fileName?: string
  sessionId?: string
  instructions?: string
  documentText?: string
}

async function performExtraction(
  session: { sub: string; workspaceId: string },
  params: ExtractionParams
) {
  const { fileBase64, fileName, sessionId, instructions, documentText } = params

  // Build messages
  const messages: Array<{ role: string; content: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> }> = [
    { role: "system", content: [{ type: "text", text: REPORT_EXTRACTION_PROMPT }] },
  ]

  // Build user message content
  const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = []

  if (fileBase64) {
    const isImage = fileBase64.startsWith("data:image/")
    if (isImage) {
      userContent.push({
        type: "image_url",
        image_url: { url: fileBase64, detail: "high" },
      })
      userContent.push({
        type: "text",
        text: instructions
          ? `Extract all data from this document. File: ${fileName || "upload"}. Additional instructions: ${instructions}`
          : `Extract all data from this document. File: ${fileName || "upload"}`,
      })
    } else {
      // For PDF/DOCX, the base64 data needs to be described
      userContent.push({
        type: "text",
        text: instructions
          ? `Extract all data from the uploaded document (${fileName || "upload"}). File type: ${fileBase64.split(";")[0]}. Additional instructions: ${instructions}`
          : `Extract all data from the uploaded document (${fileName || "upload"}). File type: ${fileBase64.split(";")[0]}`,
      })
    }
  } else if (documentText) {
    userContent.push({
      type: "text",
      text: instructions
        ? `Extract all data from this document text:\n\n${documentText}\n\nAdditional instructions: ${instructions}`
        : `Extract all data from this document text:\n\n${documentText}`,
    })
  }

  messages.push({ role: "user", content: userContent })

  const result = await callAI({
    temperature: 0.2,
    maxTokens: 3000,
    responseFormat: "json",
    tools: [EXTRACTION_TOOL],
    messages: messages as Array<{ role: string; content: unknown[] }>,
  })

  // Parse result
  let extracted: {
    documentType?: string
    title?: string
    rows?: Array<{ field: string; value: string }>
    metadata?: Record<string, unknown>
    confidence?: number
  } = {}

  try {
    // Check for tool call result first
    if (result.toolCalls.length > 0) {
      const toolCall = result.toolCalls[0]
      if (toolCall?.function?.arguments) {
        extracted = JSON.parse(toolCall.function.arguments)
      }
    } else {
      const cleaned = result.messageContent
        .replace(/```json\s*|\s*```/g, "")
        .trim()
      extracted = JSON.parse(cleaned)
    }
  } catch {
    // Fallback: create a single row with raw output
    extracted = {
      rows: [{ field: "AI Extraction", value: result.messageContent.slice(0, 500) }],
      documentType: "other",
    }
  }

  const rows = extracted.rows || []

  // Save to session if sessionId provided
  if (sessionId) {
    try {
      const existing = await prisma.reportSession.findFirst({
        where: { id: sessionId, workspaceId: session.workspaceId },
      })

      if (existing) {
        await prisma.reportSession.update({
          where: { id: sessionId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { rows: rows as any, status: "active" },
        })

        // Create conversation turns
        await prisma.reportConversationTurn.create({
          data: {
            sessionId,
            role: "user",
            content: `Uploaded: ${fileName || "document"}${instructions ? ` (with instructions: ${instructions})` : ""}`,
          },
        })

        await prisma.reportConversationTurn.create({
          data: {
            sessionId,
            role: "assistant",
            content: `Extracted ${rows.length} fields from document`,
            assistantReply: JSON.stringify(extracted),
          },
        })
      }
    } catch (dbErr) {
      console.error("Failed to save extraction to session:", dbErr)
      // Non-fatal — return rows anyway
    }
  }

  // Create AgentRun record
  try {
    await prisma.agentRun.create({
      data: {
        workspaceId: session.workspaceId,
        kind: "REPORT_EXTRACTION",
        status: "COMPLETED",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: { fileName: fileName, hasFile: !!fileBase64, hasInstructions: !!instructions } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        output: { documentType: extracted.documentType, rowCount: rows.length } as any,
      },
    })
  } catch (dbErr) {
    console.error("Failed to create AgentRun:", dbErr)
  }

  return NextResponse.json({
    rows,
    documentType: extracted.documentType,
    title: extracted.title,
    metadata: extracted.metadata,
    confidence: extracted.confidence,
    model: result.model,
  })
}

// ── Streaming Extraction ──────────────────────────────────────

async function handleStreamExtract(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { sessionId, fileBase64, fileName, instructions, documentText } = body

  if (!fileBase64 && !documentText) {
    return NextResponse.json({ error: "fileBase64 or documentText required" }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)))
      }

      try {
        // Step 1: Sending to AI
        send("trace", {
          trace: {
            id: "report-extract-start",
            at: new Date().toISOString(),
            stage: "extraction",
            status: "running",
            title: "Analyzing document",
            detail: fileName ? `Processing: ${fileName}` : "Processing uploaded document",
          },
        })

        const messages: Array<{
          role: string
          content: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>
        }> = [
          { role: "system", content: [{ type: "text", text: REPORT_EXTRACTION_PROMPT }] },
        ]

        const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = []

        if (fileBase64) {
          const isImage = fileBase64.startsWith("data:image/")
          if (isImage) {
            userContent.push({
              type: "image_url",
              image_url: { url: fileBase64, detail: "high" },
            })
          }
          userContent.push({
            type: "text",
            text: instructions
              ? `Extract all data. File: ${fileName || "upload"}. Instructions: ${instructions}`
              : `Extract all data. File: ${fileName || "upload"}`,
          })
        } else if (documentText) {
          userContent.push({
            type: "text",
            text: instructions
              ? `Extract all data:\n\n${(documentText as string).slice(0, 4000)}\n\nInstructions: ${instructions}`
              : `Extract all data:\n\n${(documentText as string).slice(0, 4000)}`,
          })
        }

        messages.push({ role: "user", content: userContent })

        send("thinking", { text: "Sending document to AI for analysis..." })

        const result = await callAI({
          temperature: 0.2,
          maxTokens: 3000,
          responseFormat: "json",
          tools: [EXTRACTION_TOOL],
          messages: messages as Array<{ role: string; content: unknown[] }>,
        })

        // Parse result
        let extracted: {
          documentType?: string
          title?: string
          rows?: Array<{ field: string; value: string }>
          metadata?: Record<string, unknown>
          confidence?: number
        } = {}

        try {
          if (result.toolCalls.length > 0) {
            const toolCall = result.toolCalls[0]
            if (toolCall?.function?.arguments) {
              extracted = JSON.parse(toolCall.function.arguments)
            }
          } else {
            const cleaned = result.messageContent
              .replace(/```json\s*|\s*```/g, "")
              .trim()
            extracted = JSON.parse(cleaned)
          }
        } catch {
          extracted = {
            rows: [{ field: "AI Extraction", value: result.messageContent.slice(0, 500) }],
            documentType: "other",
          }
        }

        const rows = extracted.rows || []

        send("trace", {
          trace: {
            id: "report-extract-done",
            at: new Date().toISOString(),
            stage: "extraction",
            status: "complete",
            title: "Extraction complete",
            detail: `Extracted ${rows.length} fields${extracted.documentType ? ` (${extracted.documentType})` : ""}`,
          },
        })

        // Save to DB
        if (sessionId) {
          try {
            const existing = await prisma.reportSession.findFirst({
              where: { id: sessionId, workspaceId: session.workspaceId },
            })
            if (existing) {
              await prisma.reportSession.update({
                where: { id: sessionId },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data: { rows: rows as any, status: "active" },
              })
              await prisma.reportConversationTurn.createMany({
                data: [
                  {
                    sessionId,
                    role: "user",
                    content: `Uploaded: ${fileName || "document"}`,
                  },
                  {
                    sessionId,
                    role: "assistant",
                    content: `Extracted ${rows.length} fields`,
                    assistantReply: JSON.stringify(extracted),
                  },
                ],
              })
            }
          } catch (dbErr) {
            console.error("Failed to save stream extraction:", dbErr)
          }
        }

        // Send final result
        send("result", {
          result: {
            rows,
            documentType: extracted.documentType,
            title: extracted.title,
            metadata: extracted.metadata,
            confidence: extracted.confidence,
            model: result.model,
            applied: true,
            appliedAt: new Date().toISOString(),
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

// ── Refine Extraction ─────────────────────────────────────────

async function handleRefine(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { sessionId, instructions, currentRows } = body

  if (!instructions) {
    return NextResponse.json({ error: "instructions required" }, { status: 400 })
  }

  const prompt = REPORT_REFINEMENT_PROMPT.replace(
    "{currentRows}",
    JSON.stringify(currentRows || [])
  ).replace("{instructions}", instructions as string)

  const result = await callAI({
    temperature: 0.3,
    maxTokens: 2000,
    responseFormat: "json",
    messages: [{ role: "system", content: prompt }],
  })

  let refined: { rows?: Array<{ field: string; value: string }>; changes?: string; applied?: boolean } = {}
  try {
    const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
    refined = JSON.parse(cleaned)
  } catch {
    refined = { rows: currentRows as Array<{ field: string; value: string }>, changes: "Could not parse refinement", applied: false }
  }

  const rows = refined.rows || (currentRows as Array<{ field: string; value: string }>) || []

  // Save to session
  if (sessionId) {
    try {
      await prisma.reportSession.update({
        where: { id: sessionId as string },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { rows: rows as any },
      })
      await prisma.reportConversationTurn.create({
        data: {
          sessionId: sessionId as string,
          role: "user",
          content: `Refinement request: ${instructions}`,
        },
      })
      await prisma.reportConversationTurn.create({
        data: {
          sessionId: sessionId as string,
          role: "assistant",
          content: refined.changes || "Refinement applied",
          assistantReply: JSON.stringify(refined),
        },
      })
    } catch (dbErr) {
      console.error("Failed to save refinement:", dbErr)
    }
  }

  return NextResponse.json({ rows, changes: refined.changes, applied: refined.applied ?? true })
}

// ── Summarize Document ────────────────────────────────────────

async function handleSummarize(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { rows } = body

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows array required" }, { status: 400 })
  }

  const rowsText = (rows as Array<{ field: string; value: string }>)
    .map((r) => `${r.field}: ${r.value}`)
    .join("\n")

  const result = await callAI({
    temperature: 0.3,
    maxTokens: 500,
    messages: [
      {
        role: "system",
        content:
          "You are a document summarizer. Summarize the following extracted fields into a 2-3 sentence executive summary. Be concise and highlight the most important information.",
      },
      { role: "user", content: rowsText },
    ],
  })

  return NextResponse.json({ summary: result.messageContent })
}
