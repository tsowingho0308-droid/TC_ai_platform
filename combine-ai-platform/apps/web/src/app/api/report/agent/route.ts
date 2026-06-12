import { NextResponse, type NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/server/prisma"
import { requireSession } from "@/lib/server/auth-helpers"
import { mockReportExtraction } from "@/lib/server/mock-extraction"
import { extractTextFromDocument, validateDocumentText } from "@/lib/server/document-text"
import { searchKnowledgeChunks, type KnowledgeSearchResult } from "@/lib/server/knowledge-search"
import { extractKbHighlightPhrases } from "@/lib/server/kb-highlight-phrases"
import { buildReportDocx } from "@/lib/server/report-docx-export"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import { getDashScopeProvider, ensureAiEnvLoaded } from "@combine-ai/ai-provider/server"
import path from "path"
import fs from "fs"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// ── File Storage ───────────────────────────────────────────────

const REPORTS_DATA_DIR = path.resolve(process.cwd(), "data", "reports")

function ensureSessionDir(sessionId: string): string {
  const dir = path.join(REPORTS_DATA_DIR, sessionId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function saveUploadedFile(sessionId: string, buffer: Buffer, fileName: string): string {
  const dir = ensureSessionDir(sessionId)
  // Sanitize filename and keep extension
  const ext = path.extname(fileName) || ".bin"
  const safeFileName = `file${ext}`
  const filePath = path.join(dir, safeFileName)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

function getStoredFilePath(sessionId: string): string | null {
  const dir = path.join(REPORTS_DATA_DIR, sessionId)
  if (!fs.existsSync(dir)) return null
  const entries = fs.readdirSync(dir)
  // Return first file found (there should be only one: "file.pdf" etc.)
  for (const entry of entries) {
    const fullPath = path.join(dir, entry)
    if (fs.statSync(fullPath).isFile()) return fullPath
  }
  return null
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
  ensureAiEnvLoaded()
  const provider = getDashScopeProvider()
  return provider.createCompletion({
    model: req.model || DEFAULT_MODELS.report,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 2000,
    responseFormat: req.responseFormat,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: req.messages as any,
    tools: req.tools as any,
  })
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
10. When possible, identify the page number (1-based) where each field appears in the document and include it as the "page" field in the row.
11. For PDF highlighting: "value" must match the document text EXACTLY (same punctuation, currency symbols, spacing). "field" should use the label text as it appears in the PDF when visible (e.g. "Invoice Date", not a paraphrase), so field+value can be highlighted together. For amounts, dates, titles, and reference numbers, "page" is REQUIRED.

Respond ONLY with valid JSON:
{
  "documentType": "report|invoice|receipt|contract|letter|form|other",
  "title": "extracted document title or subject",
  "rows": [
    { "field": "standardized_label", "value": "exact_value", "page": 1 }
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
- Remove rows as requested (e.g. "刪除第 3 行", "delete row 3", "remove rows containing 備註")
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
              page: { type: "number", description: "Page number (1-based) where this value appears in the document. Provide this when the document has multiple pages and you can determine the page." },
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

const REPORT_SUMMARY_PROMPT = `你是香港企業的報告分析助手。根據上傳的報告內容與知識庫參考資料，產出精簡繁體中文摘要。

要求：
1. summary：2-4 句精簡總述報告核心內容
2. keyPoints：3-6 條要點，優先標出與知識庫政策/標準/流程的關聯、差異或需注意事項
3. kbReferences：列出實際用到的知識庫條文（articleTitle、knowledgeBaseName、relevance 說明關聯原因）
4. 若知識庫無相關內容，keyPoints 仍給報告要點，並在 summary 中說明未找到相關知識庫條文

僅回傳有效 JSON：
{
  "summary": "string",
  "keyPoints": ["string"],
  "kbReferences": [{ "articleTitle": "string", "knowledgeBaseName": "string", "relevance": "string" }]
}`

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

type ExtractRow = { field: string; value: string; page?: number }

function highlightRowScore(row: ExtractRow): number {
  let score = 0
  if (row.page && row.page >= 1) score += 100
  const v = row.value?.trim() || ""
  if (v.length >= 4 && v.length <= 40) score += 30
  else if (v.length >= 2 && v.length <= 80) score += 10
  if (/\d/.test(v)) score += 10
  if (/[$¥€£]|HKD|USD|CNY/i.test(v)) score += 15
  if (/\d{4}[-/]\d{1,2}/.test(v)) score += 10
  score -= Math.min(v.length, 100)
  return score
}

const HIGHLIGHT_SOFT_CAP = 12

function selectHighlightRows(rows: ExtractRow[], limit = HIGHLIGHT_SOFT_CAP): ExtractRow[] {
  const filtered = [...rows].filter((r) => {
    const v = r.value?.trim() || ""
    return v.length >= 3 && v.length <= 80
  })
  if (filtered.length <= limit) return filtered
  return filtered
    .sort((a, b) => highlightRowScore(b) - highlightRowScore(a))
    .slice(0, limit)
}

async function saveStreamExtraction(
  session: { workspaceId: string },
  sessionId: string,
  fileName: string | undefined,
  rows: ExtractRow[],
  extracted: Record<string, unknown>
) {
  try {
    const existing = await prisma.reportSession.findFirst({
      where: { id: sessionId, workspaceId: session.workspaceId },
    })
    if (existing) {
      await prisma.reportSession.update({
        where: { id: sessionId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { rows: rows as any, status: "completed" },
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

async function extractDocumentTextFromBase64(
  fileBase64: string,
  fileName: string
): Promise<string | undefined> {
  const match = fileBase64.match(/^data:([^;]+);base64,([\s\S]+)$/)
  if (!match) return undefined
  const mimeType = match[1]
  const buffer = Buffer.from(match[2], "base64")
  try {
    const text = await extractTextFromDocument(buffer, fileName, mimeType)
    return text || undefined
  } catch (err) {
    console.error("Document text extraction failed:", fileName, err)
    return undefined
  }
}

interface ReportSummaryResult {
  summary: string
  keyPoints: string[]
  kbReferences: Array<{
    articleTitle: string
    knowledgeBaseName: string
    relevance: string
  }>
  searchType: "semantic" | "keyword" | "none"
}

async function performReportSummary(
  session: { workspaceId: string },
  params: {
    documentText?: string
    fileName?: string
    documentType?: string
    title?: string
    rows?: Array<{ field: string; value: string }>
    kbSearchResult?: KnowledgeSearchResult
  }
): Promise<ReportSummaryResult> {
  const { documentText, fileName, documentType, title, rows, kbSearchResult } = params

  let reportContent = documentText?.trim() || ""
  if (!reportContent && rows && rows.length > 0) {
    reportContent = rows.map((r) => `${r.field}: ${r.value}`).join("\n")
  }

  if (!reportContent) {
    return {
      summary: "無法取得報告內容以產生摘要。",
      keyPoints: [],
      kbReferences: [],
      searchType: "none",
    }
  }

  let chunks = kbSearchResult?.chunks ?? []
  let searchType = kbSearchResult?.searchType ?? "keyword"

  if (!kbSearchResult) {
    const searchQuery = [title, documentType, reportContent.slice(0, 1500)]
      .filter(Boolean)
      .join("\n")

    const result = await searchKnowledgeChunks(session.workspaceId, searchQuery, { limit: 5 })
    chunks = result.chunks
    searchType = result.searchType
  }

  const kbContext =
    chunks.length > 0
      ? chunks
          .map(
            (c, i) =>
              `[${i + 1}] ${c.articleTitle} (${c.knowledgeBaseName})\n${c.excerpt}`
          )
          .join("\n\n")
      : "（知識庫中未找到相關條文）"

  const userPrompt = [
    fileName ? `檔案：${fileName}` : "",
    documentType ? `類型：${documentType}` : "",
    title ? `標題：${title}` : "",
    "",
    "── 報告內容 ──",
    reportContent.slice(0, 4000),
    "",
    "── 知識庫參考 ──",
    kbContext,
  ]
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")

  try {
    const result = await callAI({
      model: "qwen-flash",
      temperature: 0.3,
      maxTokens: 1200,
      responseFormat: "json",
      messages: [
        { role: "system", content: REPORT_SUMMARY_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    let parsed: {
      summary?: string
      keyPoints?: string[]
      kbReferences?: Array<{
        articleTitle: string
        knowledgeBaseName: string
        relevance: string
      }>
    } = {}

    try {
      const cleaned = result.messageContent.replace(/```json\s*|\s*```/g, "").trim()
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { summary: result.messageContent, keyPoints: [], kbReferences: [] }
    }

    return {
      summary: parsed.summary || result.messageContent,
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      kbReferences: Array.isArray(parsed.kbReferences) ? parsed.kbReferences : [],
      searchType: chunks.length > 0 ? searchType : "none",
    }
  } catch (err) {
    console.warn("Report summary AI unavailable:", (err as Error).message)
    return {
      summary: reportContent.slice(0, 300) + (reportContent.length > 300 ? "…" : ""),
      keyPoints: rows?.slice(0, 5).map((r) => `${r.field}: ${r.value}`) || [],
      kbReferences: chunks.slice(0, 3).map((c) => ({
        articleTitle: c.articleTitle,
        knowledgeBaseName: c.knowledgeBaseName,
        relevance: c.excerpt.slice(0, 120),
      })),
      searchType: chunks.length > 0 ? searchType : "none",
    }
  }
}

// ── Background Job Runner ──────────────────────────────────────

/**
 * Run an extraction task in the background, detached from the HTTP request lifecycle.
 * The caller immediately returns to the client; this continues in-process.
 */
function runBackgroundJob(fn: () => Promise<void>, label: string) {
  setImmediate(() => {
    fn().catch((err) => console.error(`[Background Job] ${label} failed:`, err))
  })
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

    // ── Multipart file upload ──
    // stream=1 → SSE real-time extraction; otherwise → background job
    if (contentType.includes("multipart/form-data")) {
      return stream
        ? handleStreamMultipartExtract(request, session)
        : handleMultipartExtractBackground(request, session)
    }

    const body = (await request.json()) as Record<string, unknown>

    switch (action) {
      case "extract":
        return stream
          ? handleStreamExtract(session, body)
          : handleExtractBackground(session, body)

      case "refine":
        return handleRefine(session, body)

      case "summarize":
        return handleSummarize(session, body)

      case "generateReport":
        return handleGenerateReport(session, body)

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

async function handleStreamMultipartExtract(
  request: NextRequest,
  session: { sub: string; workspaceId: string }
) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const sessionId = (formData.get("sessionId") as string) || `report-${Date.now()}`
    const instructions = formData.get("instructions") as string | null
    const model = formData.get("model") as string | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString("base64")
    const mimeType = file.type || "application/octet-stream"
    const dataUrl = `data:${mimeType};base64,${base64}`

    // Save file to disk for later session viewing
    try { saveUploadedFile(sessionId, buffer, file.name) } catch (err) {
      console.error("Failed to save uploaded file:", err)
    }

    // Ensure session exists
    await prisma.reportSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        workspaceId: session.workspaceId,
        title: file.name || "New Report",
        status: "processing",
      },
      update: { status: "processing", title: file.name || undefined },
    })

    let documentText: string | undefined
    try {
      documentText = await extractTextFromDocument(buffer, file.name, mimeType)
    } catch (err) {
      console.error("Stream multipart document extraction failed:", file.name, err)
      documentText = undefined
    }

    return handleStreamExtract(session, {
      fileBase64: dataUrl,
      fileName: file.name,
      sessionId,
      instructions: instructions || undefined,
      documentText,
      model: model || undefined,
    })
  } catch (error) {
    console.error("Stream multipart extraction error:", error)
    return NextResponse.json(
      {
        error: "File processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

async function handleMultipartExtractBackground(request: NextRequest, session: { sub: string; workspaceId: string }) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const sessionId = formData.get("sessionId") as string | null
    const instructions = formData.get("instructions") as string | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const mimeType = file.type || "application/octet-stream"
    const effectiveSessionId = sessionId || `report-${Date.now()}`
    const fileName = file.name

    // Save file to disk for session viewing
    try { saveUploadedFile(effectiveSessionId, buffer, fileName) } catch (err) {
      console.error("Failed to save uploaded file for background extraction:", err)
    }

    // Extract text from the document BEFORE starting background job
    let documentText: string | undefined
    let fileBase64: string | undefined
    const isImage = mimeType.startsWith("image/")

    if (isImage) {
      // Images: pass as base64 for AI vision
      const base64 = buffer.toString("base64")
      fileBase64 = `data:${mimeType};base64,${base64}`
    } else {
      // PDF/DOCX/TXT: extract text now
      try {
        documentText = await extractTextFromDocument(buffer, fileName, mimeType)
      } catch (err) {
        console.error("Text extraction failed:", err)
        return NextResponse.json({
          error: "Failed to extract text from document",
          detail: err instanceof Error ? err.message : "Unknown error",
        }, { status: 422 })
      }
      if (!documentText || documentText.trim().length < 50) {
        return NextResponse.json({
          error: "Document contains insufficient readable text",
          detail: `Extracted ${documentText?.length || 0} characters (minimum 50 required)`,
        }, { status: 422 })
      }
    }

    // Ensure session exists with processing status
    await prisma.reportSession.upsert({
      where: { id: effectiveSessionId },
      create: {
        id: effectiveSessionId,
        workspaceId: session.workspaceId,
        title: fileName || "New Report",
        status: "processing",
      },
      update: { status: "processing", title: fileName || undefined },
    })

    // Return IMMEDIATELY — AI runs in background
    runBackgroundJob(async () => {
      try {
        await performExtraction(session, {
          fileBase64,
          fileName,
          sessionId: effectiveSessionId,
          instructions: instructions || undefined,
          documentText,
        })
      } catch (err) {
        console.error("Background extraction failed:", err)
        await prisma.reportSession.update({
          where: { id: effectiveSessionId },
          data: { status: "failed" },
        }).catch(() => {})
      }
    }, `report-extract:${effectiveSessionId}`)

    return NextResponse.json({
      success: true,
      sessionId: effectiveSessionId,
      status: "processing",
      message: `Extraction started (${documentText ? documentText.length + " chars" : "image analysis"}). Poll GET /api/report/sessions for status.`,
    })
  } catch (error) {
    console.error("Multipart extraction setup error:", error)
    return NextResponse.json(
      { error: "File processing failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// ── Standard Extraction ───────────────────────────────────────

// Background version — creates session, returns immediately, runs AI in background
async function handleExtractBackground(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const sessionId = (body.sessionId as string) || `report-${Date.now()}`
  const fileBase64 = body.fileBase64 as string | undefined
  const fileName = (body.fileName as string) || "Report Document"
  const instructions = body.instructions as string | undefined
  const documentText = body.documentText as string | undefined
  const model = body.model as string | undefined

  if (!fileBase64 && !documentText) {
    return NextResponse.json({ error: "fileBase64 or documentText required" }, { status: 400 })
  }

  // Save file to disk for session viewing (if base64 provided)
  if (fileBase64) {
    try {
      const match = fileBase64.match(/^data:([^;]+);base64,([\s\S]+)$/)
      if (match) {
        const ext = match[1].split("/")[1] || "bin"
        saveUploadedFile(sessionId, Buffer.from(match[2], "base64"), `${fileName}.${ext}`)
      }
    } catch (err) {
      console.error("Failed to save file for background extraction:", err)
    }
  }

  // Create/update session with processing status
  await prisma.reportSession.upsert({
    where: { id: sessionId },
    create: {
      id: sessionId,
      workspaceId: session.workspaceId,
      userId: session.sub,
      title: fileName,
      status: "processing",
    },
    update: { status: "processing", title: fileName },
  })

  // Run AI in background
  runBackgroundJob(async () => {
    try {
      await performExtraction(session, {
        fileBase64,
        fileName,
        sessionId,
        instructions,
        documentText,
        model,
      })
    } catch (err) {
      console.error("Background extraction failed:", err)
      await prisma.reportSession.update({
        where: { id: sessionId },
        data: { status: "failed" },
      }).catch(() => {})
    }
  }, `report-extract:${sessionId}`)

  return NextResponse.json({
    success: true,
    sessionId,
    status: "processing",
    message: "Extraction started. Poll GET /api/report/sessions for status.",
  })
}

async function handleExtract(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const sessionId = body.sessionId as string | undefined
  const fileBase64 = body.fileBase64 as string | undefined
  const fileName = body.fileName as string | undefined
  const instructions = body.instructions as string | undefined
  const documentText = body.documentText as string | undefined
  const model = body.model as string | undefined

  if (!fileBase64 && !documentText) {
    return NextResponse.json({ error: "fileBase64 or documentText required" }, { status: 400 })
  }

  return performExtraction(session, {
    fileBase64: fileBase64 as string | undefined,
    fileName: fileName as string | undefined,
    sessionId: sessionId as string | undefined,
    instructions: instructions as string | undefined,
    documentText: documentText as string | undefined,
    model,
  })
}

interface ExtractionParams {
  fileBase64?: string
  fileName?: string
  sessionId?: string
  instructions?: string
  documentText?: string
  model?: string
}

async function performExtraction(
  session: { sub: string; workspaceId: string },
  params: ExtractionParams
) {
  const { fileBase64, fileName, sessionId, instructions, documentText, model } = params

  // Set session to processing
  if (sessionId) {
    try { await prisma.reportSession.update({ where: { id: sessionId }, data: { status: "processing" } }) } catch { /* best-effort */ }
  }

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

  // ── Try AI extraction, fallback to mock template if no API key ──
  let extracted: {
    documentType?: string
    title?: string
    rows?: Array<{ field: string; value: string }>
    metadata?: Record<string, unknown>
    confidence?: number
  } = {}
  let modelUsed = "unknown"

  try {
    const result = await callAI({
      model,
      temperature: 0.2,
      maxTokens: 3000,
      responseFormat: "json",
      tools: [EXTRACTION_TOOL],
      messages: messages as Array<{ role: string; content: unknown[] }>,
    })

    modelUsed = result.model

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
  } catch (aiErr) {
    // No API key or AI unavailable — use mock template based on file name
    console.warn("AI extraction unavailable, using mock template:", (aiErr as Error).message)
    const mock = mockReportExtraction(fileName)
    extracted = {
      documentType: mock.documentType,
      title: mock.title,
      rows: mock.rows,
      metadata: mock.metadata,
      confidence: mock.confidence,
    }
    modelUsed = mock.model
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
          data: { rows: rows as any, status: "completed" },
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

  // Generate summary in background (don't block the response)
  runBackgroundJob(async () => {
    try {
      const summaryResult = await performReportSummary(session, {
        documentText: documentText as string | undefined,
        fileName: fileName as string | undefined,
        documentType: extracted.documentType,
        title: extracted.title,
        rows: rows as Array<{ field: string; value: string }>,
      })
      await prisma.reportSession.update({
        where: { id: sessionId },
        data: { summary: summaryResult as unknown as Prisma.InputJsonValue },
      })
    } catch (err) {
      console.error("Background summary generation failed:", err)
    }
  }, `report-summary:${sessionId}`)

  return NextResponse.json({
    rows,
    documentType: extracted.documentType,
    title: extracted.title,
    metadata: extracted.metadata,
    confidence: extracted.confidence,
    model: modelUsed,
  })
}

// ── Streaming Extraction ──────────────────────────────────────

async function handleStreamExtract(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const effectiveSessionId = (body.sessionId as string) || `report-${Date.now()}`
  const fileBase64 = body.fileBase64 as string | undefined
  const fileName = body.fileName as string | undefined
  const instructions = body.instructions as string | undefined
  const documentText = body.documentText as string | undefined
  const model = body.model as string | undefined

  if (!fileBase64 && !documentText) {
    return NextResponse.json({ error: "fileBase64 or documentText required" }, { status: 400 })
  }

  // Save file to disk for session viewing (if base64 provided and not already saved by multipart handler)
  if (fileBase64) {
    try {
      const match = fileBase64.match(/^data:([^;]+);base64,([\s\S]+)$/)
      if (match && !getStoredFilePath(effectiveSessionId)) {
        const ext = match[1].split("/")[1] || "bin"
        saveUploadedFile(effectiveSessionId, Buffer.from(match[2], "base64"), `${fileName || "file"}.${ext}`)
      }
    } catch (err) {
      console.error("Failed to save file in stream extract:", err)
    }
  }

  // Ensure session exists
  try {
    await prisma.reportSession.upsert({
      where: { id: effectiveSessionId },
      create: {
        id: effectiveSessionId,
        workspaceId: session.workspaceId,
        title: fileName || "New Report",
        status: "processing",
      },
      update: { status: "processing", title: fileName || undefined },
    })
  } catch { /* best-effort */ }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false
      const send = (event: string, data: Record<string, unknown>) => {
        if (streamClosed) return
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)))
        } catch {
          streamClosed = true
        }
      }

      try {
        // Parse document text early (needed for PDF/DOCX extraction + summary)
        let resolvedDocumentText = documentText as string | undefined
        if (!resolvedDocumentText && fileBase64) {
          resolvedDocumentText = await extractDocumentTextFromBase64(
            fileBase64 as string,
            (fileName as string) || "upload"
          )
        }

        const isImageUpload = Boolean(fileBase64?.startsWith("data:image/"))
        if (!isImageUpload) {
          const validationError = validateDocumentText(resolvedDocumentText)
          if (validationError) {
            send("error", {
              error: "Text extraction failed",
              detail: validationError,
              code: "TEXT_EXTRACTION_FAILED",
            })
            return
          }
        }

        // Start KB search in parallel with extraction (overlaps embedding latency)
        const kbSearchQuery = [
          fileName,
          resolvedDocumentText?.slice(0, 1500),
        ]
          .filter(Boolean)
          .join("\n")

        const kbSearchPromise: Promise<KnowledgeSearchResult> = kbSearchQuery
          ? searchKnowledgeChunks(session.workspaceId, kbSearchQuery, { limit: 5 })
          : Promise.resolve({ chunks: [], searchType: "keyword" })

        // Set session to processing (session was already upserted above)
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
              image_url: { url: fileBase64 as string, detail: "high" },
            })
            userContent.push({
              type: "text",
              text: instructions
                ? `Extract all data. File: ${fileName || "upload"}. Instructions: ${instructions}`
                : `Extract all data. File: ${fileName || "upload"}`,
            })
          } else if (resolvedDocumentText) {
            userContent.push({
              type: "text",
              text: instructions
                ? `Extract all data from this document (${fileName || "upload"}):\n\n${resolvedDocumentText.slice(0, 8000)}\n\nInstructions: ${instructions}`
                : `Extract all data from this document (${fileName || "upload"}):\n\n${resolvedDocumentText.slice(0, 8000)}`,
            })
          } else {
            userContent.push({
              type: "text",
              text: instructions
                ? `Extract all data. File: ${fileName || "upload"}. Instructions: ${instructions}`
                : `Extract all data. File: ${fileName || "upload"}`,
            })
          }
        } else if (resolvedDocumentText) {
          userContent.push({
            type: "text",
            text: instructions
              ? `Extract all data:\n\n${resolvedDocumentText.slice(0, 8000)}\n\nInstructions: ${instructions}`
              : `Extract all data:\n\n${resolvedDocumentText.slice(0, 8000)}`,
          })
        }

        messages.push({ role: "user", content: userContent })

        send("thinking", { text: "Sending document to AI for analysis..." })

        // ── Try AI extraction, fallback to mock template if no API key ──
        let extracted: {
          documentType?: string
          title?: string
          rows?: Array<{ field: string; value: string }>
          metadata?: Record<string, unknown>
          confidence?: number
        } = {}
        let modelUsed = "unknown"

        try {
          const result = await callAI({
            model,
            temperature: 0.2,
            maxTokens: 3000,
            responseFormat: "json",
            tools: [EXTRACTION_TOOL],
            messages: messages as Array<{ role: string; content: unknown[] }>,
          })

          modelUsed = result.model

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
        } catch (aiErr) {
          console.warn("AI stream extraction unavailable, using mock template:", (aiErr as Error).message)
          const mock = mockReportExtraction(fileName)
          extracted = {
            documentType: mock.documentType,
            title: mock.title,
            rows: mock.rows,
            metadata: mock.metadata,
            confidence: mock.confidence,
          }
          modelUsed = mock.model
        }

        const rows = (extracted.rows || []) as ExtractRow[]
        const highlightRows = selectHighlightRows(rows)

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

        // Send extraction result immediately so PDF highlights can start
        send("result", {
          result: {
            sessionId: effectiveSessionId,
            rows,
            highlightRows,
            documentType: extracted.documentType,
            title: extracted.title,
            metadata: extracted.metadata,
            confidence: extracted.confidence,
            model: modelUsed,
            applied: true,
            appliedAt: new Date().toISOString(),
          },
        })

        // Persist to DB — await to ensure it completes
        await saveStreamExtraction(
          session,
          effectiveSessionId,
          fileName as string | undefined,
          rows,
          extracted as Record<string, unknown>
        ).catch((err) => console.error("Failed to save stream extraction:", err))

        // Step 2: KB-aware summary (KB search already in flight)
        send("trace", {
          trace: {
            id: "report-summary-start",
            at: new Date().toISOString(),
            stage: "summary",
            status: "running",
            title: "Generating summary",
            detail: "Using knowledge base context",
          },
        })

        send("thinking", { text: "正在產生知識庫關聯要點摘要…" })

        const kbSearchResult = await kbSearchPromise

        const kbPhrases = extractKbHighlightPhrases(kbSearchResult.chunks)
        send("kbHighlights", {
          phrases: kbPhrases,
          searchType: kbSearchResult.chunks.length > 0 ? kbSearchResult.searchType : "none",
        })

        const summaryResult = await performReportSummary(session, {
          documentText: resolvedDocumentText,
          fileName: fileName as string | undefined,
          documentType: extracted.documentType,
          title: extracted.title,
          rows: rows as Array<{ field: string; value: string }>,
          kbSearchResult,
        })

        send("trace", {
          trace: {
            id: "report-summary-done",
            at: new Date().toISOString(),
            stage: "summary",
            status: "complete",
            title: "Summary complete",
            detail: `${summaryResult.keyPoints.length} key points`,
          },
        })

        send("summary", { summary: summaryResult })

        // Persist summary to DB so it's available on subsequent page loads
        try {
          await prisma.reportSession.update({
            where: { id: effectiveSessionId },
            data: { summary: summaryResult as unknown as Prisma.InputJsonValue },
          })
        } catch (err) {
          console.error("Failed to persist summary to session:", err)
        }
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
  const { rows, documentText, fileName, documentType, title } = body

  const hasRows = Array.isArray(rows) && rows.length > 0
  const hasText = typeof documentText === "string" && documentText.trim().length > 0

  if (!hasRows && !hasText) {
    return NextResponse.json(
      { error: "documentText or rows required" },
      { status: 400 }
    )
  }

  const summaryResult = await performReportSummary(session, {
    documentText: documentText as string | undefined,
    fileName: fileName as string | undefined,
    documentType: documentType as string | undefined,
    title: title as string | undefined,
    rows: hasRows ? (rows as Array<{ field: string; value: string }>) : undefined,
  })

  return NextResponse.json(summaryResult)
}

// ── Generate Full Report ──────────────────────────────────────

const REPORT_GENERATE_PROMPT = `你是香港企業的高級分析師，負責撰寫可直接呈交上司的正式內部報告（繁體中文）。

要求：
1. 語氣專業、客觀、簡潔，結論先行；像資深同事寫給管理層的備忘錄，而非 AI 分析摘要
2. 禁止使用：「AI 分析」「知識庫搜尋」「產生時間」「本報告由…生成」等元描述
3. 以 Markdown 格式輸出正文（## 章節標題），建議章節：
   - 報告標題（一句話）
   - 背景及目的
   - 主要發現（引用具體數據與事實，條列）
   - 風險與合規事項
   - 建議行動
   - 結論
4. 政策／合規內容自然融入正文，不要單獨列出「參考條文清單」或技術性附錄
5. 每章節 2–5 段或條列，可直接複製到 Word 使用
6. 僅回傳 Markdown 正文，不要 JSON，不要 code fence`

async function performReportGenerate(
  session: { workspaceId: string },
  params: {
    documentText?: string
    fileName?: string
    documentType?: string
    title?: string
    rows?: Array<{ field: string; value: string }>
    reportSummary?: ReportSummaryResult
    emailContext?: { subject?: string; sender?: string; body?: string }
  }
): Promise<{ docxBase64: string; fileName: string }> {
  const { documentText, fileName, documentType, title, rows, reportSummary, emailContext } = params

  let reportContent = documentText?.trim() || ""
  if (!reportContent && rows && rows.length > 0) {
    reportContent = rows.map((r) => `${r.field}: ${r.value}`).join("\n")
  }
  if (!reportContent && reportSummary?.summary) {
    reportContent = reportSummary.summary
  }

  const searchQuery = [
    emailContext?.subject,
    title,
    documentType,
    reportContent.slice(0, 2000),
    reportSummary?.keyPoints?.join("\n"),
  ]
    .filter(Boolean)
    .join("\n")

  const kbResult = await searchKnowledgeChunks(session.workspaceId, searchQuery, { limit: 8 })
  const chunks = kbResult.chunks

  const kbContext =
    chunks.length > 0
      ? chunks
          .map(
            (c, i) =>
              `[${i + 1}] ${c.articleTitle} (${c.knowledgeBaseName})\n${c.excerpt}`
          )
          .join("\n\n")
      : "（知識庫中未找到相關條文）"

  const extractedFields =
    rows && rows.length > 0
      ? rows.map((r) => `- ${r.field}: ${r.value}`).join("\n")
      : "（無抽取欄位）"

  const summaryBlock = reportSummary
    ? [
        "── 既有摘要 ──",
        reportSummary.summary,
        "",
        reportSummary.keyPoints.length > 0
          ? "要點：\n" + reportSummary.keyPoints.map((p) => `- ${p}`).join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : ""

  const emailBlock = emailContext
    ? [
        "── 郵件背景 ──",
        `主旨：${emailContext.subject || "（未知）"}`,
        `寄件人：${emailContext.sender || "（未知）"}`,
        emailContext.body ? `內容：\n${emailContext.body.slice(0, 3000)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : ""

  const userPrompt = [
    fileName ? `檔案：${fileName}` : "",
    documentType ? `類型：${documentType}` : "",
    title ? `標題：${title}` : "",
    emailBlock,
    summaryBlock,
    "",
    "── 抽取欄位 ──",
    extractedFields,
    "",
    "── 報告內容 ──",
    reportContent.slice(0, 6000),
    "",
    "── 知識庫參考 ──",
    kbContext,
  ]
    .filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""))
    .join("\n")

  const baseName = fileName || emailContext?.subject || "document"
  const safeName = baseName.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 60)

  try {
    const result = await callAI({
      model: "qwen-flash",
      temperature: 0.4,
      maxTokens: 4000,
      responseFormat: "text",
      messages: [
        { role: "system", content: REPORT_GENERATE_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    let bodyText = result.messageContent.trim()
    bodyText = bodyText.replace(/^```(?:markdown|md)?\s*|\s*```$/g, "").trim()

    const reportTitle = title || fileName || emailContext?.subject || "內部報告"
    const docxBuffer = await buildReportDocx({
      title: reportTitle.replace(/\.[^.]+$/, ""),
      bodyText,
    })

    return {
      docxBase64: docxBuffer.toString("base64"),
      fileName: `report-${safeName}-${Date.now()}.docx`,
    }
  } catch (err) {
    console.warn("Report generate AI unavailable:", (err as Error).message)

    const fallbackBody = [
      "## 背景及目的",
      emailContext
        ? `本報告就「${emailContext.subject || "相關郵件"}」所附文件作出摘要，供管理層審閱。`
        : fileName
          ? `本報告就「${fileName}」所載內容作出摘要，供管理層審閱。`
          : "本報告就相關文件內容作出摘要，供管理層審閱。",
      "",
      "## 主要發現",
      reportSummary?.summary || reportContent.slice(0, 500) || "請參閱附件及抽取欄位。",
      "",
      extractedFields !== "（無抽取欄位）" ? extractedFields : "",
      "",
      "## 風險與合規事項",
      reportSummary?.keyPoints?.map((p) => `- ${p}`).join("\n") || "請人工覆核相關合規要求。",
      "",
      "## 建議行動",
      "- 請管理層確認上述重點及建議後，指示後續跟進。",
      "",
      "## 結論",
      reportSummary?.summary?.slice(0, 200) || "綜上，建議按上述行動跟進。",
    ]
      .filter(Boolean)
      .join("\n")

    const docxBuffer = await buildReportDocx({
      title: (title || fileName || "內部報告").replace(/\.[^.]+$/, ""),
      bodyText: fallbackBody,
    })

    return {
      docxBase64: docxBuffer.toString("base64"),
      fileName: `report-${safeName}-${Date.now()}.docx`,
    }
  }
}

async function handleGenerateReport(
  session: { sub: string; workspaceId: string },
  body: Record<string, unknown>
) {
  const { rows, documentText, fileName, documentType, title, reportSummary, emailContext } = body

  const hasRows = Array.isArray(rows) && rows.length > 0
  const hasText = typeof documentText === "string" && documentText.trim().length > 0
  const hasSummary =
    reportSummary &&
    typeof reportSummary === "object" &&
    typeof (reportSummary as ReportSummaryResult).summary === "string"

  if (!hasRows && !hasText && !hasSummary) {
    return NextResponse.json(
      { error: "documentText, rows, or reportSummary required" },
      { status: 400 }
    )
  }

  const result = await performReportGenerate(session, {
    documentText: documentText as string | undefined,
    fileName: fileName as string | undefined,
    documentType: documentType as string | undefined,
    title: title as string | undefined,
    rows: hasRows ? (rows as Array<{ field: string; value: string }>) : undefined,
    reportSummary: hasSummary ? (reportSummary as ReportSummaryResult) : undefined,
    emailContext: emailContext as
      | { subject?: string; sender?: string; body?: string }
      | undefined,
  })

  return NextResponse.json(result)
}
