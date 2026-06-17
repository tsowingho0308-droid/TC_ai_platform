"""Configuration for the Python Helpdesk Worker.
All values have sensible defaults for local development.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from monorepo root:
#   config.py → src/ → python-worker/ → apps/ → combine-ai-platform/
_env_path = Path(__file__).resolve().parent.parent.parent.parent / ".env"
load_dotenv(_env_path)

# ── Redis ────────────────────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# ── DashScope AI API ─────────────────────────────────────────────────
DASHSCOPE_BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_DEFAULT_MODEL = os.getenv("DASHSCOPE_DEFAULT_MODEL", "qwen3.6-plus")

# ── Node.js Internal API ─────────────────────────────────────────────
NODE_INTERNAL_API_URL = os.getenv(
    "NODE_INTERNAL_API_URL",
    "http://localhost:3000/api/helpdesk/internal",
)
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "dev-secret-change-me")

# ── Worker ───────────────────────────────────────────────────────────
MAX_WORKERS = int(os.getenv("MAX_WORKERS", "3"))
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "3"))
TASK_TTL = 300  # 5 minutes — matches Node.js side

# ── Redis Keys (must match Node.js helpdesk-queue.ts) ────────────────
QUEUE_KEY = "helpdesk:queue"
PROCESSING_BACKUP_KEY = "helpdesk:processing-backup"
STREAM_PREFIX = "helpdesk:stream:"
RESULT_PREFIX = "helpdesk:result:"
STATUS_PREFIX = "helpdesk:status:"
HEARTBEAT_PREFIX = "helpdesk:heartbeat:"
DEAD_LETTER_KEY = "helpdesk:dead-letter"
