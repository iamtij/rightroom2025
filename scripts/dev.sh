#!/usr/bin/env bash
# Dev server: first startup can take 10–15s while Tailwind/Vite warm up.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
# Free the dev port so Vite does not silently fall back to 3001 (stale node/vite is common).
for pid in $(lsof -ti ":$PORT" 2>/dev/null || true); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1
echo "Starting Vite on http://localhost:$PORT/ (first load may take 10–15s)..."
exec ./node_modules/.bin/vite --port="$PORT" --host=0.0.0.0
