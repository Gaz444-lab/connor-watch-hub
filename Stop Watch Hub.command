#!/bin/zsh
# Stop the local Watch Hub server
cd "$(dirname "$0")"
PID_FILE=".server.pid"
PORT=8766

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "Stopped Watch Hub (PID $PID)."
  else
    echo "Server was not running."
  fi
  rm -f "$PID_FILE"
else
  echo "No PID file — checking port $PORT…"
fi

if lsof -ti :$PORT >/dev/null 2>&1; then
  lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
  echo "Cleared port $PORT."
fi

echo "Done."
read -r "?Press Enter… "
