import { prisma } from "./prisma"
import { chunkText } from "@combine-ai/ai-provider"
import { generateEmbedding } from "@combine-ai/ai-provider/server"

// ══════════════════════════════════════════════════════════════════════
// Table-Aware Chunking
// ══════════════════════════════════════════════════════════════════════

/**
 * Detect whether text is tabular (CSV/TSV-like structure).
 * Returns the delimiter if tabular, null otherwise.
 */
function detectTabular(text: string): string | null {
  const lines = text.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length < 3) return null

  // Try common delimiters
  for (const delim of [",", "\t", "|"]) {
    const counts = lines.map((l) => (l.match(new RegExp(`\\${delim}`, "g")) || []).length)
    const mode = getMode(counts)
    if (mode === undefined || mode < 1) continue

    // >80% of lines have the same number of delimiters → tabular
    const consistent = counts.filter((c) => c === mode).length
    if (consistent > lines.length * 0.8) return delim
  }
  return null
}

function getMode(arr: number[]): number | undefined {
  const freq = new Map<number, number>()
  for (const n of arr) freq.set(n, (freq.get(n) || 0) + 1)
  let best: number | undefined, bestCount = 0
  for (const [n, c] of freq) {
    if (c > bestCount) { best = n; bestCount = c }
  }
  return best
}

/**
 * Convert a raw CSV/TSV text into self-describing chunks.
 * Each chunk includes the header row + 1 data row, so the embedding
 * captures both the column name AND the value in one semantic unit.
 *
 * Before: "HR,500000,200000,150000" (meaningless numbers)
 * After:  "部門: HR | 差旅費: 500000 | 加班費: 200000 | 設備費: 150000"
 */
function structureTableChunks(text: string, delimiter: string): string[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ""))
  const chunks: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ""))
    const rowPairs = headers
      .map((header, j) => {
        const val = (cells[j] || "").trim()
        if (!val) return ""
        return `${header}: ${val}`
      })
      .filter((p) => p.length > 0)
    if (rowPairs.length > 0) {
      chunks.push(rowPairs.join(" | "))
    }
  }

  return chunks
}

/**
 * Extract text from a file buffer based on MIME type.
 * Supported formats: PDF, DOCX, XLSX, TXT
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  // TXT - direct decode
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    return buffer.toString("utf-8")
  }

  // PDF
  if (mimeType === "application/pdf") {
    try {
      // Dynamic import to avoid build issues if pdf-parse is not installed
      const { PDFParse } = await import("pdf-parse")
      const parser = new PDFParse(new Uint8Array(buffer))
      const data = await parser.getText()
      return data?.text || ""
    } catch (err) {
      console.error("PDF parsing failed:", err)
      throw new Error(
        `PDF parsing failed: ${err instanceof Error ? err.message : "Unknown error"}`
      )
    }
  }

  // DOCX
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    try {
      const mammoth = await import("mammoth")
      const result = await mammoth.extractRawText({ buffer })
      return result.value || ""
    } catch (err) {
      console.error("DOCX parsing failed:", err)
      throw new Error(
        `DOCX parsing failed: ${err instanceof Error ? err.message : "Unknown error"}`
      )
    }
  }

  // XLSX / Excel
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    try {
      const XLSX = await import("xlsx")
      const workbook = XLSX.read(buffer, { type: "buffer" })
      const sheets = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name]
        const csv = XLSX.utils.sheet_to_csv(sheet, { forceQuotes: false })
        return `[Sheet: ${name}]\n${csv}`
      })
      return sheets.join("\n\n") || ""
    } catch (err) {
      console.error("XLSX parsing failed:", err)
      throw new Error(
        `XLSX parsing failed: ${err instanceof Error ? err.message : "Unknown error"}`
      )
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

/**
 * Full document processing pipeline:
 * Extract text → Chunk → Generate embeddings → Store in database
 */
export async function processDocument(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  knowledgeBaseId: string,
  workspaceId: string,
  title?: string,
  metadata?: {
    targetAudience?: string
    businessProcesses?: string[]
    documentType?: string
    linkedArticleIds?: string[]
    languageCode?: string
  }
): Promise<{ articleId: string; chunkCount: number }> {
  // 1. Extract text
  const text = await extractText(fileBuffer, mimeType)

  if (!text.trim()) {
    throw new Error("No text content could be extracted from the file")
  }

  // 2. Chunk the text — table-aware if tabular data is detected
  const tableDelim = detectTabular(text)
  const chunks = tableDelim
    ? structureTableChunks(text, tableDelim)
    : chunkText(text)

  console.log(
    `[processDocument] ${tableDelim ? "table" : "text"} mode: ${chunks.length} chunks from "${fileName}"`
  )

  // 3. Create the KnowledgeArticle
  const fileExt = fileName.split(".").pop()?.toLowerCase()
  const article = await prisma.knowledgeArticle.create({
    data: {
      knowledgeBaseId,
      title: title || fileName.replace(/\.[^.]+$/, ""),
      content: text,
      tags: [fileExt || "document"],
      language: "zh-HK",
      sourceDocName: fileName,
      targetAudience: (metadata?.targetAudience as never) || "ALL_EMPLOYEES",
      businessProcesses: metadata?.businessProcesses || [],
      documentType: (metadata?.documentType as never) || "STANDARD",
      linkedArticleIds: metadata?.linkedArticleIds || [],
      languageCode: (metadata?.languageCode as never) || "ZH_HK",
    },
  })

  // 4. Create chunks with embeddings
  let embeddingErrors = 0
  for (let i = 0; i < chunks.length; i++) {
    try {
      const chunkContent = chunks[i]
      const embedding = await generateEmbedding(chunkContent)

      const created = await prisma.knowledgeChunk.create({
        data: {
          articleId: article.id,
          content: chunkContent,
          chunkIndex: i,
          tokenCount: Math.ceil(chunkContent.length / 4),
        },
      })

      // Store embedding via raw SQL (Prisma doesn't support vector type)
      await prisma.$executeRaw`
        UPDATE "KnowledgeChunk"
        SET embedding = ${embedding}::vector
        WHERE id = ${created.id}
      `
    } catch (err) {
      console.error(`Failed to embed chunk ${i} of article ${article.id}:`, err)
      embeddingErrors++
      // Continue with remaining chunks
    }
  }

  if (embeddingErrors > 0) {
    console.warn(
      `${embeddingErrors}/${chunks.length} chunks failed to embed for article ${article.id}`
    )
  }

  return {
    articleId: article.id,
    chunkCount: chunks.length - embeddingErrors,
  }
}
