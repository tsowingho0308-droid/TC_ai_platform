"""Async Redis connection manager."""
import redis.asyncio as aioredis
from .config import REDIS_URL

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Get or create the shared Redis connection."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def close_redis():
    """Close the Redis connection on shutdown."""
    global _redis
    if _redis:
        await _redis.close()
        _redis = None
