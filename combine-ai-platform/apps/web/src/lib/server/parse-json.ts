// Robust JSON parser for AI responses.
// Uses jsonrepair for fault-tolerant parsing of broken JSON
// (trailing commas, missing quotes, unclosed brackets, etc.)

import { jsonrepair } from "jsonrepair"

/**
 * Parse potentially malformed JSON from an LLM response.
 * Handles markdown code fences, leading/trailing noise, and structural errors.
 *
 * @returns The parsed object, or null if parsing is completely impossible.
 */
export function parseAIJson(content: string): Record<string, unknown> | null {
  if (!content || typeof content !== "string") return null

  // Step 1: Strip markdown code fences aggressively
  let cleaned = content
    .replace(/```[\w]*\s*[\n\r]*/gi, "") // opening fences
    .replace(/[\n\r]*\s*```/g, "")        // closing fences
    .trim()

  // Step 2: Skip text before the first { or [
  const firstBrace = cleaned.indexOf("{")
  const firstBracket = cleaned.indexOf("[")
  const jsonStart =
    firstBrace >= 0 && firstBracket >= 0
      ? Math.min(firstBrace, firstBracket)
      : Math.max(firstBrace, firstBracket)
  if (jsonStart > 0 && jsonStart < Infinity) {
    cleaned = cleaned.slice(jsonStart)
  }

  if (!cleaned) return null

  // Step 3: Direct parse
  try {
    return JSON.parse(cleaned)
  } catch {
    // Step 4: jsonrepair
    try {
      const repaired = jsonrepair(cleaned)
      return JSON.parse(repaired)
    } catch {
      return null
    }
  }
}
