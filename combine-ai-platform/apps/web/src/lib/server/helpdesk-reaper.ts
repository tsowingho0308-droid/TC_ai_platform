// Timeout Reaper — recovers tasks abandoned by crashed Python workers.
//
// Every 30 seconds, scans helpdesk:status:* keys for tasks stuck in
// "processing" state for >60 seconds with no heartbeat. Re-enqueues
// them into helpdesk:queue so another worker can pick them up.
//
// Tasks that have been retried >3 times are moved to the dead-letter list.

import { ensureRedisConnected, redis } from "@/lib/server/redis"

const REAP_INTERVAL_MS = 30_000 // scan every 30s
const PROCESSING_TIMEOUT_S = 60 // task considered dead after 60s
const MAX_RETRIES = 3

let reaperTimer: ReturnType<typeof setInterval> | null = null

export function startReaper(): void {
  if (reaperTimer) return // already running

  console.log("[Reaper] Starting timeout reaper (interval: 30s, timeout: 60s)")

  reaperTimer = setInterval(async () => {
    try {
      await ensureRedisConnected()
      await reap()
    } catch (err) {
      console.error("[Reaper] Scan failed:", err)
    }
  }, REAP_INTERVAL_MS)

  // Don't keep the process alive just for the reaper
  if (reaperTimer.unref) {
    reaperTimer.unref()
  }
}

export function stopReaper(): void {
  if (reaperTimer) {
    clearInterval(reaperTimer)
    reaperTimer = null
    console.log("[Reaper] Stopped")
  }
}

async function reap(): Promise<void> {
  let cursor = 0
  let recovered = 0

  do {
    // SCAN avoids blocking Redis (unlike KEYS *)
    const [nextCursor, keys] = (await redis.scan(
      cursor,
      "MATCH",
      "helpdesk:status:*",
      "COUNT",
      100
    )) as [string, string[]]

    cursor = parseInt(nextCursor, 10)

    for (const statusKey of keys) {
      const taskId = statusKey.replace("helpdesk:status:", "")
      const status = await redis.get(statusKey)

      if (status !== "processing") continue

      // Check heartbeat — if missing, the worker is dead
      const heartbeat = await redis.get(`helpdesk:heartbeat:${taskId}`)
      if (heartbeat === "alive") continue // worker is still alive

      // Check how long this task has been stuck
      const statusTtl = await redis.ttl(statusKey)
      // TTL was set to 300s; if < 240s remain, it's been >60s
      const elapsed = 300 - statusTtl
      if (elapsed < PROCESSING_TIMEOUT_S) continue

      // Check retry count
      const retryKey = `helpdesk:retry:${taskId}`
      const retryCount = parseInt((await redis.get(retryKey)) || "0", 10)

      if (retryCount >= MAX_RETRIES) {
        // Move to dead-letter
        const deadData = await recoverTaskData(taskId)
        if (deadData) {
          await redis.lpush("helpdesk:dead-letter", deadData)
        }
        await redis.del(statusKey)
        await redis.del(retryKey)
        await redis.del(`helpdesk:heartbeat:${taskId}`)
        console.log(`[Reaper] Task ${taskId.slice(0, 12)}… dead-letter (retries: ${retryCount})`)
        continue
      }

      // Recover task from processing-backup and re-enqueue
      const taskData = await recoverTaskData(taskId)
      if (taskData) {
        await redis.lpush("helpdesk:queue", taskData)
        // Reset status + increment retry
        await redis.setex(statusKey, 300, "queued")
        await redis.setex(retryKey, 600, String(retryCount + 1))
        await redis.del(`helpdesk:heartbeat:${taskId}`)
        recovered++
        console.log(`[Reaper] Recovered task ${taskId.slice(0, 12)}… (retry ${retryCount + 1}/${MAX_RETRIES})`)
      }
    }
  } while (cursor !== 0)

  if (recovered > 0) {
    console.log(`[Reaper] Recovered ${recovered} abandoned task(s)`)
  }
}

/** Try to find the original task payload from the processing-backup list. */
async function recoverTaskData(taskId: string): Promise<string | null> {
  // Scan the backup list for the task (limited scan — backup list should be small)
  const backupItems = await redis.lrange("helpdesk:processing-backup", 0, -1)
  for (const item of backupItems) {
    try {
      const parsed = JSON.parse(item)
      if (parsed.taskId === taskId) {
        // Remove from backup (it'll be re-added by the new worker)
        await redis.lrem("helpdesk:processing-backup", 1, item)
        return item
      }
    } catch {
      // corrupted entry — skip
    }
  }
  return null
}
