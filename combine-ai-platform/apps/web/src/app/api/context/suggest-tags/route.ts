import { NextResponse, type NextRequest } from "next/server"
import { requireSession } from "@/lib/server/auth-helpers"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import { getDashScopeProvider } from "@combine-ai/ai-provider/server"
import { buildTaxonomyPrompt, PREDEFINED_TAGS } from "@/lib/server/tag-taxonomy"

export const dynamic = "force-dynamic"

const SUGGEST_TAGS_PROMPT = `You are a document classification assistant. Given a document's text content, suggest the most relevant tags from the taxonomy below.

Rules:
- Select 3-8 tags that best describe the document's content
- Only suggest tags that are in the taxonomy list below
- Include a confidence score (0.0-1.0) for each tag
- If no tags match well, return an empty array
- Respond ONLY with valid JSON — no markdown, no explanation

{buildTaxonomyPrompt}

Return format:
{ "tags": [{"tag": "tag-name", "confidence": 0.9, "reason": "one-line reason"}], "suggestedDepartment": "HR|IT|ADMIN|FINANCE|GENERAL", "suggestedDocumentType": "STANDARD|PLAYBOOK|PROCESS_MAP|FAQ", "summary": "one-line summary of the document" }`

export async function POST(request: NextRequest) {
  const session = await requireSession().catch(() => null)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = (await request.json()) as Record<string, unknown>
    const text = body.text as string

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text content required" }, { status: 400 })
    }

    // Only send first 4000 chars to save tokens
    const truncatedText = text.slice(0, 4000)

    const provider = getDashScopeProvider()
    const taxonomyText = buildTaxonomyPrompt()
    const systemPrompt = SUGGEST_TAGS_PROMPT.replace("{buildTaxonomyPrompt}", taxonomyText)

    const result = await provider.createCompletion({
      model: DEFAULT_MODELS.email, // qwen-flash for speed
      temperature: 0.1,
      maxTokens: 600,
      responseFormat: "json",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyze this document and suggest tags:\n\n${truncatedText}${text.length > 4000 ? "\n\n[Document truncated — showing first 4000 characters]" : ""}`,
        },
      ],
    })

    // Parse AI response
    let suggestion: {
      tags: Array<{ tag: string; confidence: number; reason: string }>
      suggestedDepartment: string
      suggestedDocumentType: string
      summary: string
    } = { tags: [], suggestedDepartment: "GENERAL", suggestedDocumentType: "STANDARD", summary: "" }

    try {
      const cleaned = result.messageContent
        .replace(/```json\s*|\s*```/g, "")
        .trim()
      const parsed = JSON.parse(cleaned)
      suggestion = {
        tags: parsed.tags || [],
        suggestedDepartment: parsed.suggestedDepartment || "GENERAL",
        suggestedDocumentType: parsed.suggestedDocumentType || "STANDARD",
        summary: parsed.summary || "",
      }
    } catch {
      // Fallback: return empty suggestions
    }

    // Validate tags against taxonomy — only include known tags
    const validTags = new Set(PREDEFINED_TAGS.map((t) => t.tag))
    const filteredTags = suggestion.tags.filter((t) => validTags.has(t.tag))

    return NextResponse.json({
      tags: filteredTags,
      suggestedDepartment: suggestion.suggestedDepartment,
      suggestedDocumentType: suggestion.suggestedDocumentType,
      summary: suggestion.summary,
    })
  } catch (error) {
    console.error("Suggest tags API error:", error)
    return NextResponse.json(
      { error: "Tag suggestion failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
