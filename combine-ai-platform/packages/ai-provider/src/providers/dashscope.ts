// Alibaba Cloud Model Studio (百炼) AI Provider
// Hong Kong acceleration node: https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1
// International node (fallback): https://dashscope-intl.aliyuncs.com/compatible-mode/v1

import type {
  IAiProvider,
  CompletionRequest,
  CompletionResponse,
  ChatMessage,
  StreamHandlers,
  ContentPart,
} from "../index.js"

// ── Model definitions ────────────────────────────────────────────

export const DASHSCOPE_MODELS = {
  /** Complex reasoning, 3-way match, deep analysis (Finance / Tender Agent) */
  complex: [
    { value: "qwen3.7-max", label: "Qwen3.7 Max (深度推理)", description: "複雜推理、三單匹配、深度分析" },
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro (深度推理)", description: "複雜推理、三單匹配、深度分析" },
  ],
  /** General knowledge QA, report generation (Helpdesk / Report Agent) */
  general: [
    { value: "qwen3.6-plus", label: "Qwen3.6 Plus (通用)", description: "一般知識庫問答、報告生成" },
  ],
  /** Low latency fast classification (Email Agent) */
  fast: [
    { value: "qwen-flash", label: "Qwen Flash (快速分流)", description: "低延遲快速分類" },
  ],
} as const

/** All available models as a flat array for UI selectors */
export const ALL_MODELS = [
  ...DASHSCOPE_MODELS.complex,
  ...DASHSCOPE_MODELS.general,
  ...DASHSCOPE_MODELS.fast,
]

/** Models that support deep thinking (enable_thinking) */
const THINKING_MODELS = new Set(["qwen3.7-max", "deepseek-v4-pro"])

/** Default model for each agent type */
export const DEFAULT_MODELS: Record<string, string> = {
  finance: "qwen3.7-max",
  tender: "qwen3.7-max",
  report: "qwen3.6-plus",
  helpdesk: "qwen3.6-plus",
  email: "qwen-flash",
  workflow: "qwen3.6-plus",
}

// ── Configuration ─────────────────────────────────────────────────

function getConfig() {
  const baseUrl =
    process.env.DASHSCOPE_BASE_URL ||
    "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1"

  const apiKey = process.env.DASHSCOPE_API_KEY || ""
  const defaultModel = process.env.DASHSCOPE_DEFAULT_MODEL || "qwen3.6-plus"

  return { baseUrl, apiKey, defaultModel }
}

// ── Provider Implementation ───────────────────────────────────────

export class DashScopeProvider implements IAiProvider {
  private baseUrl: string
  private apiKey: string
  private defaultModel: string

  constructor() {
    const config = getConfig()
    this.baseUrl = config.baseUrl
    this.apiKey = config.apiKey
    this.defaultModel = config.defaultModel
  }

  /**
   * Non-streaming completion — used for simple classification / extraction.
   */
  async createCompletion(req: CompletionRequest): Promise<CompletionResponse> {
    const model = req.model || this.defaultModel

    if (!this.apiKey) {
      throw new Error("DASHSCOPE_API_KEY not configured. Set it in .env.local")
    }

    const body: Record<string, unknown> = {
      model,
      messages: buildMessages(req),
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 2000,
    }

    if (req.responseFormat === "json") {
      body.response_format = { type: "json_object" }
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools
    }

    // Enable deep thinking for supported models
    if (THINKING_MODELS.has(model)) {
      body.extra_body = { enable_thinking: true }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`DashScope API error: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0]
    const message = choice?.message as Record<string, unknown> | undefined

    return {
      messageContent: (message?.content as string) || "",
      toolCalls: (message?.tool_calls as CompletionResponse["toolCalls"]) || [],
      model,
      usage: data.usage as CompletionResponse["usage"],
    }
  }

  /**
   * Streaming completion — used for agent UIs that need real-time thinking + answer display.
   *
   * For qwen3.7-max / deepseek-v4-pro:
   *   - `chunk.choices[0].delta.reasoning_content` → thinking process
   *   - `chunk.choices[0].delta.content` → final answer
   *
   * Events emitted via handlers:
   *   - `onToken(text)` — content token (final answer)
   *   - `onThinkingToken(text)` — reasoning token (thinking process)
   *   - `onTrace(event)` — stage trace events
   */
  async createStreamingCompletion(
    req: CompletionRequest,
    handlers?: StreamHandlers
  ): Promise<CompletionResponse> {
    const model = req.model || this.defaultModel

    if (!this.apiKey) {
      throw new Error("DASHSCOPE_API_KEY not configured. Set it in .env.local")
    }

    const body: Record<string, unknown> = {
      model,
      messages: buildMessages(req),
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 2000,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (req.responseFormat === "json") {
      body.response_format = { type: "json_object" }
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools
    }

    // Enable deep thinking for supported models
    if (THINKING_MODELS.has(model)) {
      body.extra_body = { enable_thinking: true }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: handlers?.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(`DashScope API error: ${response.status} - ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error("DashScope API returned no readable stream")
    }

    const decoder = new TextDecoder()
    let fullContent = ""
    let fullThinking = ""
    const toolCalls: CompletionResponse["toolCalls"] = []
    let usageInfo: CompletionResponse["usage"] | undefined

    try {
      while (true) {
        if (handlers?.signal?.aborted) break

        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith("data:")) continue

          const jsonStr = trimmed.slice("data:".length).trim()
          if (jsonStr === "[DONE]") continue

          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>
            const choices = parsed.choices as Array<Record<string, unknown>> | undefined
            const delta = choices?.[0]?.delta as Record<string, unknown> | undefined

            if (delta) {
              // Reasoning / thinking content (deep thinking models)
              if (delta.reasoning_content) {
                const thinkingText = delta.reasoning_content as string
                fullThinking += thinkingText
                handlers?.onThinkingToken?.(thinkingText)
              }

              // Final content token
              if (delta.content) {
                const contentText = delta.content as string
                fullContent += contentText
                handlers?.onToken?.(contentText)
              }

              // Tool calls accumulation
              if (delta.tool_calls) {
                const tcArray = delta.tool_calls as Array<Record<string, unknown>>
                for (const tc of tcArray) {
                  const idx = (tc.index as number) ?? toolCalls.length
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = {
                      id: (tc.id as string) || `call_${idx}`,
                      type: "function",
                      function: { name: "", arguments: "" },
                    }
                  }
                  if (tc.id) toolCalls[idx].id = tc.id as string
                  if (tc.function) {
                    const fn = tc.function as Record<string, unknown>
                    if (fn.name) toolCalls[idx].function.name += fn.name as string
                    if (fn.arguments) toolCalls[idx].function.arguments += fn.arguments as string
                  }
                }
              }
            }

            // Capture usage from final chunk
            if (parsed.usage) {
              const usage = parsed.usage as Record<string, number>
              usageInfo = {
                promptTokens: usage.prompt_tokens ?? 0,
                completionTokens: usage.completion_tokens ?? 0,
                totalTokens: usage.total_tokens ?? 0,
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return {
      messageContent: fullContent,
      toolCalls,
      model,
      usage: usageInfo,
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function buildMessages(req: CompletionRequest): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []

  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt })
  }

  for (const msg of req.messages) {
    messages.push({
      role: msg.role,
      content: serializeContent(msg.content),
      ...(msg.toolCalls ? { tool_calls: msg.toolCalls } : {}),
      ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {}),
      ...(msg.name ? { name: msg.name } : {}),
    })
  }

  return messages
}

function serializeContent(content: string | ContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content

  return content.map((part): Record<string, unknown> => {
    if (part.type === "text") {
      return { type: "text", text: part.text }
    }
    if (part.type === "image_url") {
      return {
        type: "image_url",
        image_url: {
          url: part.image_url!.url,
          detail: part.image_url!.detail ?? "high",
        },
      }
    }
    return part as unknown as Record<string, unknown>
  })
}

/** Singleton provider instance */
let instance: DashScopeProvider | null = null

export function getDashScopeProvider(): DashScopeProvider {
  if (!instance) {
    instance = new DashScopeProvider()
  }
  return instance
}
