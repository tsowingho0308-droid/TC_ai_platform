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
