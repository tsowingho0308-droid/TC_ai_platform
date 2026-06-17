// Redis client singleton — follows the same pattern as lib/server/prisma.ts
import Redis from "ioredis"

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
  subscriberRedis: Redis | undefined
}

function createRedisClient(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) return null // stop retrying in dev
      return Math.min(times * 200, 2000)
    },
    lazyConnect: true,
  })
}

export const redis: Redis =
  globalForRedis.redis ?? createRedisClient()

// Dedicated subscriber connection for Pub/Sub (cannot be used for other commands)
export function getSubscriber(): Redis {
  if (!globalForRedis.subscriberRedis) {
    globalForRedis.subscriberRedis = createRedisClient()
  }
  return globalForRedis.subscriberRedis
}

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis
}

/** Ensures the main Redis client is connected. Safe to call multiple times. */
export async function ensureRedisConnected(): Promise<void> {
  if (redis.status === "wait" || redis.status === "end" || redis.status === "close") {
    await redis.connect()
  }
}

/** Pings Redis to verify connectivity. Throws on failure. */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    await ensureRedisConnected()
    const pong = await redis.ping()
    return pong === "PONG"
  } catch {
    return false
  }
}
