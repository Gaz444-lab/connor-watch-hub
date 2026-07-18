#!/bin/zsh
# Double-click to start Connor's Watch Hub
cd "$(dirname "$0")"
./launch.sh
echo ""
echo "Watch Hub is running. Leave this window open while using the app."
echo "To stop later: double-click Stop Watch Hub.command"
echo ""
read -r "?Press Enter to close this window… "
