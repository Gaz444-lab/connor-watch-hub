#!/bin/zsh
# Pull latest app code from GitHub (keeps Connor's browser data)
set -e
cd "$(dirname "$0")"

echo ""
echo "=== Updating Watch Hub ==="
echo "Your watchlist, ratings and reviews stay in the browser — only the app code updates."
echo ""

# Stop running server if any
PID_FILE=".server.pid"
PORT=8766
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Stopping running server…"
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  sleep 1
fi
if lsof -ti :$PORT >/dev/null 2>&1; then
  lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
fi

if [ -d .git ]; then
  echo "Pulling latest code from GitHub…"
  git pull --ff-only || {
    echo "git pull failed. Check internet, or run setup again."
    read -r "?Press Enter… "
    exit 1
  }
else
  echo "No git repo — skipped pull."
fi

chmod +x *.command launch.sh scripts/*.sh 2>/dev/null || true

if [ -f VERSION ]; then
  echo "Version: $(cat VERSION)"
fi
echo "Commit:  $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"

echo ""
echo "=== Update complete ==="
echo "Double-click Watch Hub.command to open again."
echo ""
read -r "?Press Enter to close… "
