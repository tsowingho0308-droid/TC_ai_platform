#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Stopping processes on port 3000..."
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -t -i:3000 2>/dev/null || true)
  if [ -n "${PIDS}" ]; then
    echo "    Killing PIDs: ${PIDS}"
    kill -9 ${PIDS} 2>/dev/null || true
  fi
fi

pkill -9 -f "next dev" 2>/dev/null || true
sleep 2

if lsof -i:3000 >/dev/null 2>&1; then
  echo "ERROR: Port 3000 is still in use."
  echo "Run this manually in Terminal:"
  echo "  kill -9 \$(lsof -t -i:3000)"
  exit 1
fi

echo "==> Raising file descriptor limit (fixes EMFILE errors)..."
ulimit -n 10240 2>/dev/null || true

echo "==> Starting dev server..."
export WATCHPACK_POLLING=true
npm run dev
