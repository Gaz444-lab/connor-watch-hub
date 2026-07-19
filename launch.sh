#!/bin/zsh
# Start Watch Hub control server and open the browser
set -e
cd "$(dirname "$0")"

PORT=8766
PID_FILE=".server.pid"
URL="http://127.0.0.1:${PORT}/"
LOG="/tmp/connor-watch-hub-server.log"

# Already running?
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Watch Hub already running — opening browser…"
  open "$URL"
  exit 0
fi

if lsof -ti :$PORT >/dev/null 2>&1; then
  echo "Port $PORT busy — opening existing server…"
  open "$URL"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found — opening files directly (disk save unavailable)."
  open "index.html"
  exit 0
fi

# Prefer durable server.py (static + /api/state); fall back to plain http.server
if [ -f server.py ]; then
  python3 server.py >>"$LOG" 2>&1 &
else
  python3 -m http.server "$PORT" --bind 127.0.0.1 >>"$LOG" 2>&1 &
fi
echo $! > "$PID_FILE"
sleep 0.5
open "$URL"
echo "Watch Hub → $URL (PID $(cat "$PID_FILE"))"
