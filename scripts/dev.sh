#!/usr/bin/env bash
# Dev server: first startup can take 10–15s while Tailwind/Vite warm up.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
echo "Starting Vite on http://localhost:$PORT/ (first load may take 10–15s)..."
exec ./node_modules/.bin/vite --port="$PORT" --host=0.0.0.0
