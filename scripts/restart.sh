#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for port in 3000 3001 5173; do
  for pid in $(lsof -ti ":$port" 2>/dev/null || true); do
    kill -9 "$pid" 2>/dev/null || true
  done
done
sleep 2
exec npm run dev
