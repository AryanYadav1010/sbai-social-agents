#!/bin/bash
# Restarts the running service without reinstalling it -- use this after
# `git pull && npm ci && npm run build && npm run db:migrate` for a normal
# code update (see docs/always-on-worker.md "Upgrade/deployment workflow").
# Re-run install.sh instead only if deploy/macos/*.template actually changed.
set -euo pipefail
LABEL="com.sbaisystems.socialworker"

if sudo launchctl print system/"$LABEL" >/dev/null 2>&1; then
  echo "Restarting system LaunchDaemon..."
  sudo launchctl kickstart -k system/"$LABEL"
  echo "Done."
elif launchctl print gui/"$(id -u)"/"$LABEL" >/dev/null 2>&1; then
  echo "Restarting user LaunchAgent..."
  launchctl kickstart -k gui/"$(id -u)"/"$LABEL"
  echo "Done."
else
  echo "Service is not installed -- run install.sh first." >&2
  exit 1
fi
