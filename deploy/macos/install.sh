#!/bin/bash
# Installs the always-on worker as a macOS launchd service.
#
#   ./install.sh            installs a system LaunchDaemon (default,
#                            recommended for a dedicated Mac mini -- starts
#                            at boot even if nobody logs in)
#   ./install.sh --agent    installs a per-user LaunchAgent instead (only
#                            starts once the user actually logs into a GUI
#                            session -- use only if auto-login is set up)
#
# Repeatable: re-running this after a code update does NOT require
# reinstalling unless deploy/macos/*.template changed -- see
# docs/always-on-worker.md "Upgrade/deployment workflow".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.sbaisystems.socialworker"
MODE="daemon"
if [ "${1:-}" = "--agent" ]; then
  MODE="agent"
fi

echo "== SB AI Systems always-on worker installer =="
echo "Project directory: $PROJECT_DIR"
echo "Mode: $MODE"

# --- Discover the real Node executable -----------------------------------
# launchd plists need an absolute path -- it cannot rely on the shell PATH
# a logged-in Terminal session happens to have. Checks common install
# locations (Apple Silicon Homebrew, Intel Homebrew, nvm, system) rather
# than assuming one architecture.
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "$HOME/.nvm/current/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  # nvm installs live under versioned directories -- check the most recent
  if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_BIN=$(find "$HOME/.nvm/versions/node" -maxdepth 2 -name node -type f 2>/dev/null | sort -V | tail -1)
  fi
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "ERROR: could not find a node executable. Install Node.js first (nodejs.org, or 'brew install node'), then re-run this script." >&2
  exit 1
fi
NODE_BIN_DIR="$(dirname "$NODE_BIN")"
echo "Found node: $NODE_BIN"

# --- Determine which user the daemon should run as ------------------------
if [ "$MODE" = "daemon" ]; then
  RUN_AS_USER="$(stat -f%Su /dev/console 2>/dev/null || echo "${SUDO_USER:-$(whoami)}")"
else
  RUN_AS_USER="$(whoami)"
fi
echo "Will run as user: $RUN_AS_USER"

# --- Sanity checks ----------------------------------------------------------
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "WARNING: $PROJECT_DIR/.env does not exist yet. The worker will fail to start until it's created -- see .env.example."
fi
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "node_modules not found -- running 'npm ci' first..."
  (cd "$PROJECT_DIR" && npm ci)
fi

mkdir -p "$PROJECT_DIR/deploy/macos/logs"

# --- Render run-worker.sh (into a gitignored local copy, never overwrite
# the committed template -- keeps the repo clean across machines with
# different Node install paths) ---------------------------------------------
RENDERED_RUN_SCRIPT="$SCRIPT_DIR/run-worker.local.sh"
sed -e "s#__PROJECT_DIR__#$PROJECT_DIR#g" -e "s#__NODE_BIN_DIR__#$NODE_BIN_DIR#g" \
  "$SCRIPT_DIR/run-worker.sh.template" > "$RENDERED_RUN_SCRIPT"
chmod +x "$RENDERED_RUN_SCRIPT"

# --- Render and install the plist ------------------------------------------
if [ "$MODE" = "daemon" ]; then
  TEMPLATE="$SCRIPT_DIR/com.sbaisystems.socialworker.plist.template"
  DEST="/Library/LaunchDaemons/$LABEL.plist"
  RENDERED="$SCRIPT_DIR/.rendered-daemon.plist"
  sed -e "s#__PROJECT_DIR__#$PROJECT_DIR#g" -e "s#__RUN_AS_USER__#$RUN_AS_USER#g" "$TEMPLATE" > "$RENDERED"

  echo "Installing system LaunchDaemon to $DEST (requires sudo)..."
  sudo cp "$RENDERED" "$DEST"
  sudo chown root:wheel "$DEST"
  sudo chmod 644 "$DEST"
  rm -f "$RENDERED"

  # bootstrap is the modern replacement for the deprecated `launchctl load`
  sudo launchctl bootout system/"$LABEL" 2>/dev/null || true
  sudo launchctl bootstrap system "$DEST"
  sudo launchctl enable system/"$LABEL"
  echo "Installed and started (system LaunchDaemon)."
else
  TEMPLATE="$SCRIPT_DIR/com.sbaisystems.socialworker.agent.plist.template"
  DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  sed -e "s#__PROJECT_DIR__#$PROJECT_DIR#g" "$TEMPLATE" > "$DEST"

  launchctl bootout gui/"$(id -u)"/"$LABEL" 2>/dev/null || true
  launchctl bootstrap gui/"$(id -u)" "$DEST"
  launchctl enable gui/"$(id -u)"/"$LABEL"
  echo "Installed and started (user LaunchAgent -- only runs while $RUN_AS_USER is logged in)."
fi

echo ""
echo "Next steps:"
echo "  1. Check it's actually running:  ./deploy/macos/status.sh"
echo "  2. Watch the logs:                ./deploy/macos/logs.sh"
echo "  3. Verify DB/config are correct:  npm run worker:check"
echo "  4. On the dashboard's Automation page, confirm the worker shows as online."
