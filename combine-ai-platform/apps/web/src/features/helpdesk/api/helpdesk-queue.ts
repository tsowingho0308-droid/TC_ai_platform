// Redis-backed async task queue for Helpdesk Agent
// Provides push, poll, and result retrieval for chat-async flow
import { ensureRedisConnected, redis } from "@/lib/server/redis"
import type { ChatMessage, ToolDefinition } from "@combine-ai/ai-provider"

// ── Queue Keys ──────────────────────────────────────────────────────

const QUEUE_KEY = "helpdesk:queue"
const STATUS_PREFIX = "helpdesk:status:"
const RESULT_PREFIX = "helpdesk:result:"
const DEAD_LETTER_KEY = "helpdesk:dead-letter"
const TASK_TTL = 300 // 5 minutes

// ── Task Status ─────────────────────────────────────────────────────

export type TaskStatus = "queued" | "processing" | "completed" | "error" | "expired"

// ── Task Payload (pushed to Redis List) ─────────────────────────────

export interface QueueTaskPayload {
  taskId: string
  conversationId: string
  workspaceId: string
  userId: string
  department: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  systemPrompt: string
  createdAt: string
}

// ── Task Result (stored in Redis after completion) ──────────────────

export interface TaskResult {
  answer: string
  thinking?: string
  sources?: Array<{ articleId: string; articleTitle: string; excerpt: string }>
  confidence?: number
  needsEscalation?: boolean
  suggestedDepartment?: string
  ticketId?: string
  conversationId: string
  error?: string
}

// ── Push ────────────────────────────────────────────────────────────

/** Push a task to the Redis queue. Sets initial status to "queued". */
export async function pushTask(payload: QueueTaskPayload): Promise<void> {
  await ensureRedisConnected()

  await redis
    .multi()
    .lpush(QUEUE_KEY, JSON.stringify(payload))
    .setex(`${STATUS_PREFIX}${payload.taskId}`, TASK_TTL, "queued")
    .exec()
}

// ── Status Polling ──────────────────────────────────────────────────

/** Get the current status of a task. Returns null if task not found or expired. */
export async function getTaskStatus(taskId: string): Promise<TaskStatus | null> {
  await ensureRedisConnected()

  const raw = await redis.get(`${STATUS_PREFIX}${taskId}`)
  if (!raw) return null
  return raw as TaskStatus
}

// ── Result Retrieval ────────────────────────────────────────────────

/** Get the completed result for a task. Returns null if not yet completed or expired. */
export async function getTaskResult(taskId: string): Promise<TaskResult | null> {
  await ensureRedisConnected()

  const raw = await redis.get(`${RESULT_PREFIX}${taskId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as TaskResult
  } catch {
    return null
  }
}

// ── Status Update (called by internal endpoints) ─────────────────────

/** Update the status of a task. Used by the Python worker via internal API. */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<void> {
  await ensureRedisConnected()
  await redis.setex(`${STATUS_PREFIX}${taskId}`, TASK_TTL, status)
}

/** Store the final result for a task. Used by the Python worker via internal API. */
export async function storeTaskResult(
  taskId: string,
  result: TaskResult
): Promise<void> {
  await ensureRedisConnected()

  await redis
    .multi()
    .setex(`${RESULT_PREFIX}${taskId}`, TASK_TTL, JSON.stringify(result))
    .setex(`${STATUS_PREFIX}${taskId}`, TASK_TTL, "completed")
    .exec()
}

/** Move a failed task to the dead-letter list after max retries. */
export async function moveToDeadLetter(
  taskId: string,
  payload: QueueTaskPayload,
  error: string
): Promise<void> {
  await ensureRedisConnected()

  const deadEntry = {
    ...payload,
    error,
    failedAt: new Date().toISOString(),
  }

  await redis
    .multi()
    .lpush(DEAD_LETTER_KEY, JSON.stringify(deadEntry))
    .del(`${STATUS_PREFIX}${taskId}`)
    .exec()
}

// ── Queue Stats (for monitoring) ─────────────────────────────────────

/** Get approximate queue depth. */
export async function getQueueDepth(): Promise<number> {
  await ensureRedisConnected()
  return redis.llen(QUEUE_KEY)
}
