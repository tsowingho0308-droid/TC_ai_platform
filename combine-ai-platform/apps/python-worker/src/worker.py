"""Task processor — pulls from Redis, calls DashScope AI, publishes results.

Uses ThreadPoolExecutor to process multiple tasks concurrently. Each task
runs a tool-calling loop (max 3 rounds) against the DashScope API.

Tool execution is delegated to the Node.js internal API so the Python
worker doesn't need database access.
"""
import asyncio
import json
import traceback
from concurrent.futures import ThreadPoolExecutor

import httpx

from .config import (
    MAX_WORKERS,
    MAX_TOOL_ROUNDS,
    DASHSCOPE_DEFAULT_MODEL,
    NODE_INTERNAL_API_URL,
    INTERNAL_API_SECRET,
    STATUS_PREFIX,
    RESULT_PREFIX,
    STREAM_PREFIX,
    TASK_TTL,
    DEAD_LETTER_KEY,
)
from .redis_client import get_redis
from .dashscope_client import stream_completion
from .parse_json import parse_ai_json


class TaskProcessor:
    """Processes helpdesk tasks concurrently via ThreadPoolExecutor."""

    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)
        self._running_tasks: set[asyncio.Task] = set()

    async def process_task(self, task: dict):
        """Process a single task: AI call + tool loop → publish result.

        This is the main entry point for each dequeued task. It runs
        in an asyncio task so multiple tasks can be in-flight concurrently.
        """
        task_id = task.get("taskId", "unknown")
        redis = await get_redis()
        task_data_str = json.dumps(task)

        # Mark as processing
        await redis.setex(f"{STATUS_PREFIX}{task_id}", TASK_TTL, "processing")

        # Heartbeat: refresh TTL every 10s so the Reaper knows we're alive
        async def heartbeat_loop():
            while True:
                await asyncio.sleep(10)
                await redis.setex(f"helpdesk:heartbeat:{task_id}", 30, "alive")

        heartbeat_task = asyncio.create_task(heartbeat_loop())

        messages: list[dict] = task.get("messages", [])
        tools: list[dict] | None = task.get("tools")
        model: str = task.get("model", DASHSCOPE_DEFAULT_MODEL)
        workspace_id: str = task.get("workspaceId", "")
        user_id: str = task.get("userId", "")

        accumulated_content = ""
        accumulated_thinking = ""

        try:
            active_tools = list(tools) if tools else None
            searched_kb = False

            for round_num in range(MAX_TOOL_ROUNDS):
                tool_calls_accumulator: dict[int, dict] = {}
                current_tool_call_deltas: list[dict] = []

                # Stream from DashScope
                async for chunk in stream_completion(
                    model,
                    messages,
                    active_tools,
                ):
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if not delta:
                        continue

                    # Thinking tokens (reasoning_content from deepseek-r1 style models)
                    reasoning = getattr(delta, "reasoning_content", None) or ""
                    if reasoning:
                        accumulated_thinking += reasoning
                        await redis.publish(
                            f"{STREAM_PREFIX}{task_id}",
                            json.dumps({"event": "thinking", "text": reasoning}),
                        )

                    # Content tokens
                    if delta.content:
                        accumulated_content += delta.content
                        await redis.publish(
                            f"{STREAM_PREFIX}{task_id}",
                            json.dumps({"event": "token", "text": delta.content}),
                        )

                    # Tool call deltas (accumulate across chunks)
                    if delta.tool_calls:
                        for tc_delta in delta.tool_calls:
                            idx = tc_delta.index
                            if idx not in tool_calls_accumulator:
                                tool_calls_accumulator[idx] = {
                                    "id": tc_delta.id or "",
                                    "type": "function",
                                    "function": {"name": "", "arguments": ""},
                                }
                            acc = tool_calls_accumulator[idx]
                            if tc_delta.id:
                                acc["id"] = tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    acc["function"]["name"] += tc_delta.function.name
                                if tc_delta.function.arguments:
                                    acc["function"]["arguments"] += tc_delta.function.arguments

                # Check if AI returned tool calls
                final_tool_calls = [
                    tool_calls_accumulator[i]
                    for i in sorted(tool_calls_accumulator.keys())
                ]

                if not final_tool_calls:
                    # No tool calls → this is the final answer
                    break

                # Append assistant message with tool calls
                messages.append({
                    "role": "assistant",
                    "content": accumulated_content or "",
                    "toolCalls": final_tool_calls,
                })
                accumulated_content = ""  # Reset for next round

                # Execute each tool call
                for tc in final_tool_calls:
                    fn_name = tc["function"]["name"]

                    # Track search_knowledge_base — remove after first use
                    if fn_name == "search_knowledge_base":
                        searched_kb = True
                        if active_tools:
                            active_tools = [
                                t for t in active_tools
                                if t.get("function", {}).get("name") != "search_knowledge_base"
                            ]

                    # Notify stream about tool use
                    try:
                        args = json.loads(tc["function"]["arguments"])
                    except (json.JSONDecodeError, KeyError):
                        args = {}
                    await redis.publish(
                        f"{STREAM_PREFIX}{task_id}",
                        json.dumps({
                            "event": "tool_use",
                            "name": fn_name,
                            "args": args,
                        }),
                    )

                    # Execute tool via Node.js internal API
                    tool_result = await self._execute_tool(
                        task_id, tc, workspace_id, user_id
                    )

                    # Notify stream about tool result
                    summary = tool_result.get("summary", "Done")
                    await redis.publish(
                        f"{STREAM_PREFIX}{task_id}",
                        json.dumps({
                            "event": "tool_result",
                            "name": fn_name,
                            "summary": summary,
                        }),
                    )

                    # Append tool result messages to conversation
                    tool_msgs = tool_result.get("messages", [])
                    messages.extend(tool_msgs)

            # ── Build final result ─────────────────────────────────
            # Try to parse as JSON (the AI is instructed to return JSON).
            # Uses parse_ai_json which handles markdown code fences,
            # leading/trailing noise, and malformed JSON — mirroring
            # parseAIJson() in apps/web/src/lib/server/parse-json.ts
            result_data: dict = {}
            parsed = parse_ai_json(accumulated_content) if accumulated_content else None
            if parsed:
                result_data = parsed
            else:
                result_data = {
                    "answer": accumulated_content or "No response generated.",
                    "confidence": 0.5,
                    "needsEscalation": False,
                }

            final_result = {
                "answer": result_data.get("answer", accumulated_content or "Done"),
                "thinking": accumulated_thinking or None,
                "sources": result_data.get("sources"),
                "confidence": result_data.get("confidence", 0.5),
                "needsEscalation": result_data.get("needsEscalation", False),
                "suggestedDepartment": result_data.get("suggestedDepartment"),
                "ticketId": result_data.get("ticketId"),
                "conversationId": task.get("conversationId", ""),
            }

            # Store result + mark completed
            await redis.setex(
                f"{RESULT_PREFIX}{task_id}",
                TASK_TTL,
                json.dumps(final_result),
            )
            await redis.setex(f"{STATUS_PREFIX}{task_id}", TASK_TTL, "completed")
            await redis.publish(
                f"{STREAM_PREFIX}{task_id}",
                json.dumps({"event": "result", "result": final_result}),
            )

            print(f"[OK] Task {task_id} completed")

        except Exception as e:
            error_detail = f"{type(e).__name__}: {e}"
            traceback.print_exc()
            print(f"[ERR] Task {task_id} failed: {error_detail}")

            error_result = {
                "answer": f"Sorry, something went wrong: {error_detail}",
                "thinking": accumulated_thinking or None,
                "conversationId": task.get("conversationId", ""),
                "error": error_detail,
            }

            # Store error result
            await redis.setex(
                f"{RESULT_PREFIX}{task_id}",
                TASK_TTL,
                json.dumps(error_result),
            )
            await redis.setex(f"{STATUS_PREFIX}{task_id}", TASK_TTL, "error")
            await redis.publish(
                f"{STREAM_PREFIX}{task_id}",
                json.dumps({"event": "error", "detail": error_detail}),
            )

            # Move to dead-letter for inspection
            dead_entry = {
                **task,
                "error": error_detail,
                "failedAt": str(asyncio.get_event_loop().time()),
            }
            await redis.lpush(DEAD_LETTER_KEY, json.dumps(dead_entry))

        finally:
            # Cancel heartbeat
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass

            # Remove from processing backup (task is done, no longer at risk)
            await redis.lrem("helpdesk:processing-backup", 0, task_data_str)
            # Clean up heartbeat key
            await redis.delete(f"helpdesk:heartbeat:{task_id}")

    async def _execute_tool(
        self,
        task_id: str,
        tool_call: dict,
        workspace_id: str,
        user_id: str,
    ) -> dict:
        """Execute a tool call by POSTing to the Node.js internal API.

        Retries up to 2 times with exponential backoff.
        """
        url = f"{NODE_INTERNAL_API_URL}/execute-tool"
        payload = {
            "taskId": task_id,
            "toolCall": tool_call,
            "session": {
                "workspaceId": workspace_id,
                "sub": user_id,
            },
        }
        headers = {
            "X-Internal-Secret": INTERNAL_API_SECRET,
            "Content-Type": "application/json",
        }

        last_error = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    return response.json()
            except Exception as e:
                last_error = e
                if attempt < 2:
                    backoff = (2 ** attempt) * 1.0  # 1s, 2s, 4s
                    await asyncio.sleep(backoff)
                continue

        # All retries exhausted — return error as tool result
        return {
            "messages": [
                {
                    "role": "tool",
                    "toolCallId": tool_call.get("id", ""),
                    "name": tool_call.get("function", {}).get("name", "unknown"),
                    "content": json.dumps({
                        "error": f"Tool execution failed after 3 attempts: {last_error}",
                    }),
                }
            ],
            "summary": f"Tool execution failed: {last_error}",
        }
