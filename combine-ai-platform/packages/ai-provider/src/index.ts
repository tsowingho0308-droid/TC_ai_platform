// Unified AI Provider abstraction

export interface CompletionRequest {
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  responseFormat?: "json" | "text"
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | ContentPart[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  name?: string
}

export interface ContentPart {
  type: "text" | "image_url"
  text?: string
  image_url?: {
    url: string
    detail?: "auto" | "low" | "high"
  }
}

export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export interface CompletionResponse {
  messageContent: string
  toolCalls: ToolCall[]
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface StreamHandlers {
  onToken?: (text: string) => void
  onThinkingToken?: (text: string) => void
  onTrace?: (event: AgentTraceEvent) => void
  signal?: AbortSignal
}

export interface AgentTraceEvent {
  id: string
  at: string
  stage: string
  status: "pending" | "running" | "complete" | "error"
  title: string
  detail?: string
}

export interface IAiProvider {
  createCompletion(req: CompletionRequest): Promise<CompletionResponse>
  createStreamingCompletion(
    req: CompletionRequest,
    handlers?: StreamHandlers
  ): Promise<CompletionResponse>
}

// ── Embedding & Chunking Utilities ──────────────────────────

export function getEmbeddingDimensions(): number {
  const parsed = Number(process.env.EMBEDDING_DIMENSIONS || 1536)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1536
}

/**
 * Generate an embedding vector for the given text using the configured embedding API.
 * Uses OpenAI-compatible /embeddings endpoint.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiUrl =
    process.env.EMBEDDING_API_URL ||
    process.env.DASHSCOPE_BASE_URL ||
    process.env.LLM_API_URL ||
    "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1"
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.LLM_API_KEY || ""
  const model = process.env.EMBEDDING_MODEL || "text-embedding-v4"
  const dimensions = getEmbeddingDimensions()

  if (!apiKey) {
    throw new Error("DASHSCOPE_API_KEY or LLM_API_KEY not configured. Cannot generate embeddings.")
  }

  const response = await fetch(`${apiUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text, dimensions }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(
      `Embedding API error: ${response.status} - ${errorText}`
    )
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>
  }
  const embedding = data.data[0]?.embedding
  if (!embedding?.length) {
    throw new Error("Embedding API returned an empty vector")
  }
  if (embedding.length !== dimensions) {
    throw new Error(
      `Embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}. Check EMBEDDING_DIMENSIONS and EMBEDDING_MODEL.`
    )
  }
  return embedding
}

/**
 * Split text into overlapping chunks suitable for embedding.
 * Splits on paragraph boundaries first, then subdivides if a chunk exceeds maxChars.
 *
 * @param text - The text to chunk
 * @param maxChars - Maximum characters per chunk (default 2000, ~500 tokens for CJK)
 * @param overlapChars - Character overlap between consecutive chunks (default 400)
 * @returns Array of text chunks
 */
export function chunkText(
  text: string,
  maxChars: number = 800,
  overlapChars: number = 100
): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean)
  const chunks: string[] = []
  let current = ""

  for (const p of paragraphs) {
    const candidate = current ? current + "\n\n" + p : p

    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current.trim())

      // Create overlap: keep last overlapChars of current + the new paragraph
      const overlap = current.slice(-overlapChars)
      current = overlap ? overlap + "\n\n" + p : p

      // If a single paragraph is longer than maxChars, split it further
      while (current.length > maxChars) {
        const splitPoint = current.lastIndexOf(" ", maxChars)
        const cut =
          splitPoint > maxChars * 0.7 ? splitPoint : maxChars
        chunks.push(current.slice(0, cut).trim())
        current = current.slice(Math.max(cut - overlapChars, 0)).trim()
      }
    } else {
      current = candidate
    }
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}

// ── Client-safe Exports (models / constants) ─────────────────

export { DASHSCOPE_MODELS, ALL_MODELS, DEFAULT_MODELS } from "./models"

// ── Server-only Exports (provider) ────────────────────────────

export { DashScopeProvider, getDashScopeProvider } from "./providers/dashscope"
