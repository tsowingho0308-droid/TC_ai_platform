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
} from "../index"
import { THINKING_MODELS } from "../models"

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
  /**
   * Non-streaming completion — used for simple classification / extraction.
   */
  async createCompletion(req: CompletionRequest): Promise<CompletionResponse> {
    const { baseUrl, apiKey, defaultModel } = getConfig()
    const model = req.model || defaultModel

    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY not configured. Set it in .env (DASHSCOPE_API_KEY=...)")
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

    // Enable deep thinking for supported models (text-only requests)
    if (THINKING_MODELS.has(model) && !messagesContainImages(req)) {
      body.extra_body = { enable_thinking: true }
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
    const { baseUrl, apiKey, defaultModel } = getConfig()
    const model = req.model || defaultModel

    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY not configured. Set it in .env (DASHSCOPE_API_KEY=...)")
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

    // Enable deep thinking for supported models (text-only requests)
    if (THINKING_MODELS.has(model) && !messagesContainImages(req)) {
      body.extra_body = { enable_thinking: true }
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
        },
      }
    }
    return part as unknown as Record<string, unknown>
  })
}

function messagesContainImages(req: CompletionRequest): boolean {
  for (const msg of req.messages) {
    if (Array.isArray(msg.content) && msg.content.some((part) => part.type === "image_url")) {
      return true
    }
  }
  return false
}

/** Singleton provider instance */
let instance: DashScopeProvider | null = null

export function getDashScopeProvider(): DashScopeProvider {
  if (!instance) {
    instance = new DashScopeProvider()
  }
  return instance
}
