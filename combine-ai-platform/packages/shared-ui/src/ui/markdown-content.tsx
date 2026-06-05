"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "../utils"

// ── JSON Fence Stripping ──────────────────────────────────────

/**
 * Strip markdown code fences and detect pure JSON payloads.
 * If content is wrapped in ```json ... ```, unwrap it.
 * If content IS pure JSON, format it nicely instead of raw rendering.
 */
function preprocessContent(content: string): { text: string; isJson: boolean } {
  if (!content) return { text: "", isJson: false }

  // Try to detect and unwrap ```json ... ``` blocks
  const jsonFenceMatch = content.match(
    /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i
  )
  if (jsonFenceMatch) {
    const inner = jsonFenceMatch[1].trim()
    // If the unwrapped content is valid JSON, format it
    try {
      const parsed = JSON.parse(inner)
      return {
        text: "```json\n" + JSON.stringify(parsed, null, 2) + "\n```",
        isJson: true,
      }
    } catch {
      // Not valid JSON, treat as regular text
      return { text: inner, isJson: false }
    }
  }

  // If entire content is a JSON object/array (no fence), wrap in code block
  const trimmed = content.trim()
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    trimmed.length > 50
  ) {
    try {
      const parsed = JSON.parse(trimmed)
      return {
        text: "```json\n" + JSON.stringify(parsed, null, 2) + "\n```",
        isJson: true,
      }
    } catch {
      // Not valid JSON, leave as-is
    }
  }

  return { text: content, isJson: false }
}

// ── Component ─────────────────────────────────────────────────

interface MarkdownContentProps {
  children: string
  className?: string
  /** Use smaller prose size. Default true for chat contexts. */
  compact?: boolean
}

export function MarkdownContent({
  children,
  className,
  compact = true,
}: MarkdownContentProps) {
  const { text } = preprocessContent(children)

  if (!text) {
    return (
      <p className="text-sm text-muted-foreground italic">No content</p>
    )
  }

  return (
    <div
      className={cn(
        "prose dark:prose-invert max-w-none",
        compact && "prose-sm",
        // Ensure tables don't overflow on mobile
        "[&_table]:w-full [&_table]:overflow-x-auto [&_table]:block md:[&_table]:table",
        // Table styling
        "[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:bg-muted/50",
        "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5",
        "[&_table]:rounded-md [&_table]:border [&_table]:border-border",
        // Code blocks
        "[&_pre]:bg-muted/50 [&_pre]:rounded-md [&_pre]:text-xs",
        "[&_code]:bg-muted/50 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
