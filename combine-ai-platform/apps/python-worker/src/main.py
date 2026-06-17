"""Helpdesk Python Worker — main entry point.

Listens on the Redis queue "helpdesk:queue" via BRPOP, deserializes tasks,
and dispatches them to the TaskProcessor's ThreadPoolExecutor for concurrent
AI processing.

Graceful shutdown: SIGINT/SIGTERM stop the BRPOP loop; in-flight tasks
are allowed to complete (or timeout).
"""
import asyncio
import json
import signal
import sys

from .config import QUEUE_KEY
from .redis_client import get_redis, close_redis
from .worker import TaskProcessor

# ── Global state ──────────────────────────────────────────────────────
running = True
active_tasks: set[asyncio.Task] = set()


async def main():
    """Main loop: BRPOP from Redis → spawn processing task."""
    global running

    processor = TaskProcessor()
    redis = await get_redis()

    # Verify connectivity
    pong = await redis.ping()
    print(f"Redis connected: {pong}")
    print(f"DashScope base URL: (configured via env)")
    print(f"Max workers: {processor.executor._max_workers}")
    print(f"Listening on queue: {QUEUE_KEY}")
    print("-" * 50)

    while running:
        try:
            # BRPOP with 5s timeout for graceful shutdown responsiveness
            result = await redis.brpop(QUEUE_KEY, timeout=5)
            if result is None:
                continue

            _, task_data = result
            task = json.loads(task_data)
            task_id = task.get("taskId", "unknown")
            print(f"[DEQUEUE] {task_id} — room={task.get('conversationId', '?')[:8]}")

            # Spawn as asyncio task for concurrent processing
            t = asyncio.create_task(processor.process_task(task))
            active_tasks.add(t)
            t.add_done_callback(lambda fut: active_tasks.discard(fut))

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[ERR] Main loop error: {e}", file=sys.stderr)
            await asyncio.sleep(1)  # avoid tight loop on persistent errors

    # ── Graceful shutdown ──────────────────────────────────────────
    print("\nShutting down...")
    print(f"Waiting for {len(active_tasks)} in-flight tasks to complete...")

    # Give in-flight tasks up to 30s to finish
    if active_tasks:
        done, pending = await asyncio.wait(
            active_tasks,
            timeout=30.0,
        )
        if pending:
            print(f"Cancelling {len(pending)} tasks that didn't finish in time")
            for t in pending:
                t.cancel()

    processor.executor.shutdown(wait=True)
    await close_redis()
    print("Worker stopped.")


def shutdown(signum=None, frame=None):
    """Signal handler for graceful shutdown."""
    global running
    if not running:
        return  # already shutting down
    print(f"\nReceived signal {signum}. Shutting down gracefully...")
    running = False


if __name__ == "__main__":
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
