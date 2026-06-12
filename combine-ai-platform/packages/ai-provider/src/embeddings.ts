import { readEnv } from "./env"

export function getEmbeddingDimensions(): number {
  const parsed = Number(readEnv("EMBEDDING_DIMENSIONS") || 1536)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1536
}

/**
 * Generate an embedding vector for the given text using the configured embedding API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiUrl =
    readEnv("EMBEDDING_API_URL") ||
    readEnv("DASHSCOPE_BASE_URL") ||
    readEnv("LLM_API_URL") ||
    "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1"
  const apiKey = readEnv("DASHSCOPE_API_KEY") || readEnv("LLM_API_KEY")
  const model = readEnv("EMBEDDING_MODEL") || "text-embedding-v4"
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
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`)
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
