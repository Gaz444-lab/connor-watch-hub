#!/bin/zsh
# Start a local server and open Watch Hub in the browser
set -e
cd "$(dirname "$0")"

PORT=8766
PID_FILE=".server.pid"
URL="http://127.0.0.1:${PORT}/"

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
  echo "python3 not found — opening files directly."
  open "index.html"
  exit 0
fi

python3 -m http.server "$PORT" >/tmp/connor-watch-hub-server.log 2>&1 &
echo $! > "$PID_FILE"
sleep 0.5
open "$URL"
echo "Watch Hub → $URL (PID $(cat "$PID_FILE"))"
