// Shared Helpdesk module: system prompt, tool definitions, tool execution, AI caller
// Extracted from apps/web/src/app/api/helpdesk/agent/route.ts
// Used by both the synchronous chat-stream handler and the async chat-async flow
import { prisma } from "@/lib/server/prisma"
import { DEFAULT_MODELS } from "@combine-ai/ai-provider"
import { getDashScopeProvider } from "@combine-ai/ai-provider/server"
import type { ChatMessage, ToolDefinition } from "@combine-ai/ai-provider"
import {
  searchKnowledgeBase,
  formatSourcesText,
} from "@/features/helpdesk/api/helpdesk-search"
import { parseAIJson } from "@/lib/server/parse-json"
import type { SearchResult } from "@/features/helpdesk/api/helpdesk-search"

// ══════════════════════════════════════════════════════════════════════
// AI Call Wrapper
// ══════════════════════════════════════════════════════════════════════

export async function callAI(req: {
  model?: string
  temperature?: number
  maxTokens?: number
  messages: ChatMessage[]
  tools?: ToolDefinition[]
}) {
  const provider = getDashScopeProvider()
  const result = await provider.createCompletion({
    model: req.model || DEFAULT_MODELS.helpdesk,
    temperature: req.temperature ?? 0.3,
    maxTokens: req.maxTokens ?? 2000,
    messages: req.messages,
    tools: req.tools,
  })
  return {
    messageContent: result.messageContent,
    toolCalls: result.toolCalls,
    model: result.model,
  }
}

// ══════════════════════════════════════════════════════════════════════
// System Prompt
// ══════════════════════════════════════════════════════════════════════

export const HELPDESK_SYSTEM_PROMPT = `You are a professional internal helpdesk assistant for a Hong Kong enterprise. Your name is "Combine AI Helpdesk". You help employees find information from company policies and procedures, answer their questions, and escalate issues when necessary.

## Personality & Tone
- Professional, friendly, and respectful — treat every employee with patience
- Respond in the SAME LANGUAGE as the user (Traditional Chinese / Cantonese style for Chinese, or English)
- Be concise but thorough — give enough detail to be genuinely helpful
- If unsure, be honest: state what you know AND what you cannot confirm
- Use bullet points for lists, keep paragraphs short for readability

## Behavior Rules
- Answer based ONLY on the provided knowledge sources and search results
- If the answer IS found in sources: provide a clear answer and cite the article title(s)
- If the answer is NOT found: clearly state that, explain what information is missing, and recommend escalation
- NEVER fabricate policies, procedures, numbers, or deadlines
- NEVER disclose confidential information about other employees
- When an employee seems frustrated, acknowledge their feelings and offer to escalate

## Escalation Triggers
Call create_ticket when ANY of these are true:
1. The question cannot be answered from available knowledge sources
2. The question requires human judgment or approval (exceptions, discretionary decisions, appeals)
3. The employee explicitly asks to speak to a human
4. The question involves sensitive personal data (salary, discipline, performance reviews, medical)
5. After 2+ follow-up questions, the issue remains unresolved and needs hands-on support

## Required Reading for Process Questions
When the user asks about a multi-step business process (onboarding, leave application, procurement, IT setup, etc.):
1. Check if any result is marked as PLAYBOOK or PROCESS_MAP — these are navigation documents that describe complete processes
2. If a playbook exists for the process, list its recommended steps IN ORDER
3. Include a "requiredReading" array in your JSON response containing all documents referenced by the playbook
4. Present each process step with the specific article/source that covers it in detail

## Context-Aware Answering
- If results contain PLAYBOOK or PROCESS_MAP documents, follow their guidance as the authoritative source
- If only GENERAL department articles match but the user's department is specific (HR, IT, etc.), DO NOT say "not found"
- Instead: present the GENERAL information as a starting point, note it may vary by department, and suggest escalation for department-specific confirmation
- If ALL search results come from GENERAL KB and the user is in a specific department, acknowledge this and recommend checking department-specific policies

## Available Tools
You have access to tools. Use them proactively:
- **search_knowledge_base**: Search for relevant policies and procedures. Use this when the initial context does NOT contain the answer. Provide a specific search query. **IMPORTANT: Only call this ONCE. If it returns no results, do NOT search again — tell the user the information is not in the knowledge base and call create_ticket.**
- **create_ticket**: Escalate to a human team. Include a clear reason for escalation and any partial answer you've gathered.
- **check_ticket_status**: Look up the current status of an existing ticket by its ID.
- **trigger_workflow**: Start a business workflow process for the user. Use this when the user explicitly asks to perform an action that matches a known workflow (employee onboarding, leave application, expense reimbursement, equipment/asset request, offboarding, procurement/purchase request).

## Workflow Intent Recognition
You are an intelligent workflow trigger. When a user describes a task that requires a multi-department process, you MUST proactively call the trigger_workflow tool instead of just explaining the process.

### Workflow Categories & When to Trigger:
- **ONBOARDING**: "I need to onboard a new employee", "set up a new hire", "new staff joining", "someone new starting next week"
- **OFFBOARDING**: "someone is leaving", "offboard an employee", "last day procedures", "exit process"
- **LEAVE_APPROVAL**: "apply for leave", "annual leave request", "sick leave", "maternity/paternity leave"
- **PROCUREMENT**: "request new equipment", "order laptops", "purchase office supplies", "procurement request", "need to buy"
- **CUSTOM**: Any other structured multi-step process the user describes

### Workflow Trigger Rules:
1. If the user's request clearly matches a workflow category → call trigger_workflow immediately (do NOT just explain the process)
2. Pass the appropriate "category" parameter to find the right template
3. If the user mentions a specific person (e.g., "new hire John Smith"), include their info in "targetPerson"
4. After triggering, tell the user: "✅ 我已成功為您啟動【流程名稱】，目前進度已更新至第一步：{first_step_title}（負責部門：{department}）。您可以在 Workflow Agent 中追蹤進度。"
5. If NO matching template exists, tell the user and suggest escalation or manual process
6. Only skip trigger_workflow if the user is just asking a general question (not requesting an action)

## Current Knowledge Context
{sources}

## Final Response Format
After using any necessary tools, provide your final answer as a JSON object with this shape:
{
  "answer": "Your detailed answer to the employee (markdown allowed for formatting)",
  "sources": [{"articleId": "...", "articleTitle": "...", "excerpt": "..."}],
  "confidence": 0.0-1.0,
  "needsEscalation": false,
  "suggestedDepartment": "HR|IT|ADMIN|FINANCE|GENERAL",
  "requiredReading": [{"articleId": "...", "articleTitle": "...", "reason": "Why this document is needed"}],
  "processSteps": [{"step": 1, "title": "...", "description": "...", "sourceArticleTitle": "..."}]
}

Include "requiredReading" when the answer depends on multiple documents (e.g., playbook references).
Include "processSteps" ONLY when answering a multi-step process question and a playbook/process map was found.
Include "workflowRunId" when a workflow was triggered (the run ID from trigger_workflow result).`

// ══════════════════════════════════════════════════════════════════════
// Tool Definitions
// ══════════════════════════════════════════════════════════════════════

const SEARCH_KB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_knowledge_base",
    description:
      "Search the company knowledge base for policies, procedures, and information relevant to the employee's question. Use this when the pre-loaded context doesn't have the answer, or when the employee asks about a topic not covered in the initial sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Specific search query — use key terms from the employee's question",
        },
        department: {
          type: "string",
          enum: ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"],
          description: "Optional department to narrow the search",
        },
      },
      required: ["query"],
    },
  },
}

const CREATE_TICKET_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_ticket",
    description:
      "Create an escalation ticket when the question cannot be fully answered from knowledge sources, requires human judgment, or the employee explicitly asks to speak to a human. Call this INSTEAD of setting needsEscalation=true in the JSON response.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The employee's original question or request",
        },
        department: {
          type: "string",
          enum: ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"],
          description: "Which department should handle this escalation",
        },
        reason: {
          type: "string",
          description:
            "Clear explanation of why this needs human intervention (e.g., 'policy not found in KB', 'requires manager approval')",
        },
        aiAnswer: {
          type: "string",
          description: "Any partial answer or context you've already gathered for the employee",
        },
      },
      required: ["question", "department", "reason"],
    },
  },
}

const CHECK_TICKET_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "check_ticket_status",
    description:
      "Check the current status of an existing helpdesk ticket. Use when an employee asks about a previously created ticket.",
    parameters: {
      type: "object",
      properties: {
        ticketId: {
          type: "string",
          description: "The full ticket ID to look up (e.g., 'cm1234567890abc')",
        },
      },
      required: ["ticketId"],
    },
  },
}

const TRIGGER_WORKFLOW_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "trigger_workflow",
    description:
      "Start a workflow process for the user based on their request. Use this when the user asks to perform a business process that matches a known workflow template (e.g., employee onboarding, leave application, expense reimbursement, equipment request, offboarding). This creates a new workflow run with all the required steps assigned to the correct departments. The user can then track the progress of their request.",
    parameters: {
      type: "object",
      properties: {
        templateId: {
          type: "string",
          description:
            "Optional: The specific template ID to use. If omitted, the system will search for the best matching template based on the user's request intent.",
        },
        category: {
          type: "string",
          enum: ["ONBOARDING", "OFFBOARDING", "PROCUREMENT", "LEAVE_APPROVAL", "CUSTOM"],
          description:
            "The category of workflow to trigger. Used to find the matching template if templateId is not provided.",
        },
        targetPerson: {
          type: "object",
          description:
            "Optional: Information about the person who is the subject of this workflow (e.g., the new employee for onboarding, the person going on leave). Include name, department, and any other relevant details the user provided.",
        },
        title: {
          type: "string",
          description:
            "Optional: A descriptive title for this workflow run. If not provided, one will be generated.",
        },
      },
      required: [],
    },
  },
}

export const HELPDESK_TOOLS = [SEARCH_KB_TOOL, CREATE_TICKET_TOOL, CHECK_TICKET_TOOL, TRIGGER_WORKFLOW_TOOL]

// ══════════════════════════════════════════════════════════════════════
// Tool Execution Result Types
// ══════════════════════════════════════════════════════════════════════

export interface ToolCallResult {
  result: unknown
  messages: ChatMessage[]
}

export interface SessionContext {
  workspaceId: string
  sub: string
}

// ══════════════════════════════════════════════════════════════════════
// Tool Execution
// ══════════════════════════════════════════════════════════════════════

export async function executeToolCall(
  toolCall: NonNullable<Awaited<ReturnType<typeof callAI>>["toolCalls"]>[number],
  session: SessionContext
): Promise<ToolCallResult> {
  const fn = toolCall.function
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(fn.arguments)
  } catch {
    return {
      result: null,
      messages: [
        {
          role: "tool" as const,
          toolCallId: toolCall.id,
          name: fn.name,
          content: JSON.stringify({ error: "Invalid JSON arguments" }),
        },
      ],
    }
  }

  switch (fn.name) {
    // ── search_knowledge_base ──
    case "search_knowledge_base": {
      const { articles, searchMethod } = await searchKnowledgeBase(
        args.query as string,
        {
          workspaceId: session.workspaceId,
          department: args.department as string | undefined,
          topK: 5,
          minSimilarity: 0.42,
        }
      )

      const noResultsHint =
        articles.length === 0
          ? "IMPORTANT: No results found. Do NOT call search_knowledge_base again. Instead, call create_ticket to escalate to a human team."
          : ""

      const userDept = (args.department as string) || "GENERAL"
      const allFromGeneral = articles.length > 0 && articles.every((a) => a.department === "GENERAL")
      const contextAwareHint =
        allFromGeneral && userDept !== "GENERAL"
          ? `NOTE: All ${articles.length} results are from the GENERAL knowledge base. The user's context is ${userDept}. Present these as general guidance and mention that ${userDept}-specific policies may differ. Recommend checking with ${userDept} department for full accuracy.`
          : ""

      let playbookContext: Record<string, unknown> | undefined
      const playbookArticle = articles.find(
        (a) => a.documentType === "PLAYBOOK" || a.documentType === "PROCESS_MAP"
      )
      if (playbookArticle) {
        try {
          const fullArticle = await prisma.knowledgeArticle.findUnique({
            where: { id: playbookArticle.id },
            select: { linkedArticleIds: true, businessProcesses: true },
          })
          if (fullArticle?.linkedArticleIds?.length) {
            const linkedArticles = await prisma.knowledgeArticle.findMany({
              where: { id: { in: fullArticle.linkedArticleIds } },
              select: { id: true, title: true, documentType: true },
            })
            playbookContext = {
              playbookTitle: playbookArticle.title,
              playbookId: playbookArticle.id,
              businessProcesses: fullArticle.businessProcesses || [],
              requiredReading: linkedArticles.map((la) => ({
                articleId: la.id,
                articleTitle: la.title,
                documentType: la.documentType,
              })),
            }
          }
        } catch (err) {
          console.warn("Failed to resolve playbook linked articles:", err)
        }
      }

      const resultContent: Record<string, unknown> = {
        query: args.query,
        totalResults: articles.length,
        searchMethod,
        noResultsHint: noResultsHint || undefined,
        contextAwareHint: contextAwareHint || undefined,
        playbookContext: playbookContext || undefined,
        results: articles.map((a) => ({
          id: a.id,
          title: a.title,
          content: a.content.slice(0, 8000), // was 2000 — too short for CSV/XLSX data
          department: a.department,
          knowledgeBaseName: a.knowledgeBaseName,
          similarity: a.similarity,
          documentType: a.documentType,
          businessProcesses: a.businessProcesses,
        })),
      }

      return {
        result: articles,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    // ── create_ticket ──
    case "create_ticket": {
      const dep = (args.department as string) || "GENERAL"
      const validDepartments = ["HR", "IT", "ADMIN", "FINANCE", "GENERAL"]

      let kb = null
      try {
        kb = await prisma.knowledgeBase.findFirst({
          where: {
            workspaceId: session.workspaceId,
            department: validDepartments.includes(dep)
              ? (dep as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL")
              : "GENERAL",
          },
        })
      } catch {
        // KB lookup is best-effort
      }

      const ticket = await prisma.helpdeskTicket.create({
        data: {
          workspaceId: session.workspaceId,
          userId: session.sub,
          question: (args.question as string) || "Escalated from Helpdesk",
          aiAnswer: (args.aiAnswer as string) || null,
          aiConfidence: null,
          status: "OPEN",
          department: validDepartments.includes(dep)
            ? (dep as "HR" | "IT" | "ADMIN" | "FINANCE" | "GENERAL")
            : "GENERAL",
          knowledgeBaseId: kb?.id || null,
        },
      })

      const shortId = ticket.id.slice(0, 8)
      const resultContent = {
        ticketId: ticket.id,
        status: "OPEN",
        message: `Ticket #${shortId} has been created. The ${dep} team will follow up with you. You can reference ticket ID ${shortId} to check status later.`,
      }

      return {
        result: ticket,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    // ── check_ticket_status ──
    case "check_ticket_status": {
      const ticketId = args.ticketId as string
      const ticket = await prisma.helpdeskTicket.findFirst({
        where: { id: ticketId, workspaceId: session.workspaceId },
        select: {
          id: true,
          status: true,
          department: true,
          question: true,
          humanReply: true,
          createdAt: true,
          resolvedAt: true,
        },
      })

      const resultContent = ticket
        ? {
            found: true,
            ticketId: ticket.id,
            shortId: ticket.id.slice(0, 8),
            status: ticket.status,
            department: ticket.department,
            question: ticket.question.slice(0, 200),
            humanReply: ticket.humanReply?.slice(0, 500) || null,
            createdAt: ticket.createdAt,
            resolvedAt: ticket.resolvedAt,
          }
        : {
            found: false,
            message: `No ticket found with ID "${ticketId}". Please double-check the ID and try again.`,
          }

      return {
        result: ticket,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    // ── trigger_workflow ──
    case "trigger_workflow": {
      const templateId = args.templateId as string | undefined
      const category = (args.category as string) || undefined
      const targetPerson = args.targetPerson as Record<string, unknown> | undefined
      const customTitle = args.title as string | undefined

      let template: {
        id: string
        name: string
        description: string | null
        category: string
        steps: Array<{ stepIndex: number; title: string; department: string; slaHours?: number | null }>
      } | null = null

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (templateId) {
        template = await (prisma as any).workflowTemplate.findFirst({
          where: { id: templateId, workspaceId: session.workspaceId },
        })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!template && category) {
        template = await (prisma as any).workflowTemplate.findFirst({
          where: { workspaceId: session.workspaceId, category: category as never },
          orderBy: { isDefault: "desc" },
        })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!template) {
        template = await (prisma as any).workflowTemplate.findFirst({
          where: { workspaceId: session.workspaceId },
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        })
      }

      if (!template) {
        return {
          result: null,
          messages: [
            {
              role: "tool" as const,
              toolCallId: toolCall.id,
              name: fn.name,
              content: JSON.stringify({
                error: "No workflow template found",
                message:
                  "There are no workflow templates configured yet. Please ask an admin to set up workflow templates first, then try again.",
              }),
            },
          ],
        }
      }

      const stepsData = (template.steps || []) as Array<{
        stepIndex: number
        title: string
        department: string
        slaHours?: number | null
      }>

      const run = await prisma.workflowRun.create({
        data: {
          workspaceId: session.workspaceId,
          userId: session.sub,
          title:
            customTitle ||
            `${template.name} - ${new Date().toLocaleDateString("zh-HK")}`,
          category: template.category as "ONBOARDING" | "OFFBOARDING" | "PROCUREMENT" | "LEAVE_APPROVAL" | "CUSTOM",
          templateId: template.id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          targetPerson: (targetPerson || undefined) as any,
          steps: {
            create: stepsData.map((s) => ({
              stepIndex: s.stepIndex,
              title: s.title,
              department: s.department,
              slaHours: s.slaHours || null,
            })),
          },
        },
        include: { steps: true },
      })

      const stepList = stepsData
        .map(
          (s, i) =>
            `${i + 1}. **${s.title}** → ${s.department}${s.slaHours ? ` (SLA: ${s.slaHours}h)` : ""}`
        )
        .join("\n")

      const resultContent = {
        success: true,
        runId: run.id,
        title: run.title,
        category: run.category,
        totalSteps: run.steps.length,
        steps: stepList,
        message: `Workflow "${template.name}" has been started with ${run.steps.length} steps. The first step has been assigned to the ${stepsData[0]?.department || "relevant"} department.`,
        nextStep: stepsData[0]
          ? {
              title: stepsData[0].title,
              department: stepsData[0].department,
            }
          : null,
        templateName: template.name,
      }

      await prisma.agentRun.create({
        data: {
          workspaceId: session.workspaceId,
          kind: "WORKFLOW_EXECUTION",
          status: "COMPLETED",
          input: {
            triggeredFrom: "HELPDESK_QA",
            templateId: template.id,
            templateName: template.name,
            category: template.category,
          } as never,
          output: {
            runId: run.id,
            stepCount: run.steps.length,
          } as never,
        },
      }).catch((err) => console.error("Failed to log workflow trigger:", err))

      return {
        result: run,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify(resultContent),
          },
        ],
      }
    }

    default:
      return {
        result: null,
        messages: [
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            name: fn.name,
            content: JSON.stringify({ error: `Unknown tool: ${fn.name}` }),
          },
        ],
      }
  }
}

// ══════════════════════════════════════════════════════════════════════
// Result Parsing
// ══════════════════════════════════════════════════════════════════════

export function parseJsonResult(content: string): Record<string, unknown> {
  const parsed = parseAIJson(content)
  return parsed ?? { answer: content, confidence: 0.5, needsEscalation: false }
}

// ══════════════════════════════════════════════════════════════════════
// KB Context Builder (shared between sync and async paths)
// ══════════════════════════════════════════════════════════════════════

export async function buildKBContext(
  userQuestion: string,
  workspaceId: string,
  department?: string,
  articles?: SearchResult[],
  suggestions?: SearchResult[],
  maxScore?: number,
  searchTier?: string
): Promise<string> {
  if (searchTier === "suggestions" && suggestions && suggestions.length > 0) {
    const sugTitles = suggestions.map(
      (s) => `"${s.title}" (${s.department}, ${Math.round((s.similarity ?? 0) * 100)}% match)`
    ).join(", ")
    return `⚠️ SUGGESTIONS FALLBACK — These documents are the CLOSEST matches found (best score: ${Math.round((maxScore ?? 0) * 100)}%).

You MUST follow these IRON RULES:
1. You MUST NOT say "找不到相關資料" / "未找到" / "I cannot find" / "not found" — these phrases are FORBIDDEN.
2. You MUST acknowledge the closest match and present it helpfully.
3. You MUST respond in this EXACT format (adapt language to match the user):

"沒有找到完全100%匹配的文件，但為您找到最接近的相關文件如下：

📄 **${suggestions[0]?.title || "[文件標題]"}**（${suggestions[0]?.department || ""}，相關度 ${Math.round((suggestions[0]?.similarity ?? 0) * 100)}%）
> ${suggestions[0]?.content.slice(0, 200) || ""}...
${suggestions.length > 1 ? `\n📄 **${suggestions[1]?.title || "[文件標題]"}**（${suggestions[1]?.department || ""}，相關度 ${Math.round((suggestions[1]?.similarity ?? 0) * 100)}%）\n> ${suggestions[1]?.content.slice(0, 200) || ""}...` : ""}

這份就是目前知識庫中最接近您需求的內容。請問需要我為您：
- 📖 提供這份文件的完整摘要？
- 🎫 建立工單請相關部門提供更精確的文件？
- 🔍 用其他關鍵字重新搜尋？"

4. Do NOT call search_knowledge_base. Do NOT call create_ticket unless user explicitly requests it.
5. Do NOT answer the user's original question — you don't have enough info. Focus on presenting the closest match.
6. Respond in the SAME LANGUAGE as the user.`
  }

  return formatSourcesText(articles || [])
}
