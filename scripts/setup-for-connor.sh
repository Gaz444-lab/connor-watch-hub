#!/bin/bash
# One-time setup on Connor's MacBook (same pattern as School Hub).
# After Xcode CLT / git is installed:
#
#   curl -fsSL https://raw.githubusercontent.com/Gaz444-lab/connor-watch-hub/main/scripts/setup-for-connor.sh | bash
#
set -euo pipefail

REPO_URL="https://github.com/Gaz444-lab/connor-watch-hub.git"
INSTALL_DIR="${HOME}/Documents/connor-watch-hub"
DESKTOP="${HOME}/Desktop"

echo ""
echo "🍿 Setting up Connor's Watch Hub…"
echo ""

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required. Finish Xcode Command Line Tools first, then re-run:"
  echo "  xcode-select --install"
  echo "  curl -fsSL https://raw.githubusercontent.com/Gaz444-lab/connor-watch-hub/main/scripts/setup-for-connor.sh | bash"
  exit 1
fi

if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "Already installed — updating…"
  git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
  git -C "$INSTALL_DIR" fetch origin main
  git -C "$INSTALL_DIR" checkout main 2>/dev/null || git -C "$INSTALL_DIR" checkout -B main origin/main
  git -C "$INSTALL_DIR" reset --hard origin/main
else
  echo "Downloading to ${INSTALL_DIR}…"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
chmod +x *.command launch.sh scripts/*.sh 2>/dev/null || true

# Desktop: Open
cat > "${DESKTOP}/Watch Hub.command" << EOF
#!/bin/zsh
cd "${INSTALL_DIR}"
exec "${INSTALL_DIR}/Watch Hub.command"
EOF

# Desktop: Update
cat > "${DESKTOP}/Update Watch Hub.command" << EOF
#!/bin/zsh
cd "${INSTALL_DIR}"
exec "${INSTALL_DIR}/Update Watch Hub.command"
EOF

chmod +x "${DESKTOP}/Watch Hub.command" "${DESKTOP}/Update Watch Hub.command"
xattr -dr com.apple.quarantine "${DESKTOP}/Watch Hub.command" 2>/dev/null || true
xattr -dr com.apple.quarantine "${DESKTOP}/Update Watch Hub.command" 2>/dev/null || true
xattr -dr com.apple.quarantine "${INSTALL_DIR}" 2>/dev/null || true

echo ""
echo "✅ Done!"
echo ""
echo "On Connor's Desktop:"
echo "  • Watch Hub.command          — open the app"
echo "  • Update Watch Hub.command   — after Dad pushes updates"
echo ""
echo "App folder: ${INSTALL_DIR}"
if [ -f VERSION ]; then echo "Version:    $(cat VERSION)"; fi
echo "Commit:     $(git rev-parse --short HEAD)"
echo ""
echo "First open may ask macOS to allow Terminal — click Open."
echo ""
