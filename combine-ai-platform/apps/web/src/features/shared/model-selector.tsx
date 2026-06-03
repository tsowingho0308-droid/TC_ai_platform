"use client"

import { ALL_MODELS } from "@combine-ai/ai-provider"

interface ModelSelectorProps {
  value: string
  onChange: (model: string) => void
  className?: string
}

export function ModelSelector({ value, onChange, className }: ModelSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className || "rounded-md border bg-transparent px-3 py-1.5 text-sm"}
    >
      <optgroup label="深度推理 (Complex Reasoning)">
        {ALL_MODELS.filter((m) => m.value === "qwen3.7-max" || m.value === "deepseek-v4-pro").map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="通用問答 (General QA)">
        {ALL_MODELS.filter((m) => m.value === "qwen3.6-plus").map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="快速分類 (Fast Classification)">
        {ALL_MODELS.filter((m) => m.value === "qwen-flash").map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </optgroup>
    </select>
  )
}
