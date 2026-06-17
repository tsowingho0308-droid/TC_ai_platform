"""DashScope AI API client — OpenAI-compatible streaming interface."""
from openai import AsyncOpenAI
from .config import DASHSCOPE_BASE_URL, DASHSCOPE_API_KEY

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """Get or create the shared DashScope (OpenAI-compatible) client."""
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=DASHSCOPE_API_KEY,
            base_url=DASHSCOPE_BASE_URL,
        )
    return _client


async def stream_completion(
    model: str,
    messages: list[dict],
    tools: list[dict] | None = None,
):
    """Stream a completion from DashScope, yielding chunks as they arrive.

    Each yielded chunk is a raw OpenAI ChatCompletionChunk delta.
    Tool calls MUST be accumulated by the caller across chunks.
    """
    client = get_client()
    kwargs = dict(
        model=model,
        messages=messages,
        temperature=0.3,
        max_tokens=2000,
        stream=True,
        stream_options={"include_usage": True},
    )
    if tools:
        kwargs["tools"] = tools

    stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        yield chunk
