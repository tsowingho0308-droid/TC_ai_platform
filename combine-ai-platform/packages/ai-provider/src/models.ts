// Model definitions for Alibaba Cloud Model Studio (百炼)
// This file is safe for both client and server components

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
export const THINKING_MODELS = new Set(["qwen3.7-max", "deepseek-v4-pro"])

/** Default model for each agent type */
export const DEFAULT_MODELS: Record<string, string> = {
  finance: "qwen3.7-max",
  tender: "qwen3.7-max",
  report: "qwen3.6-plus",
  helpdesk: "qwen3.6-plus",
  email: "qwen-flash",
  workflow: "qwen3.6-plus",
}
