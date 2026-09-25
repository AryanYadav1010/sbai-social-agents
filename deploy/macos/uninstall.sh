#!/bin/bash
set -euo pipefail
LABEL="com.sbaisystems.socialworker"

echo "Removing system LaunchDaemon (if present)..."
sudo launchctl bootout system/"$LABEL" 2>/dev/null || true
sudo rm -f "/Library/LaunchDaemons/$LABEL.plist"

echo "Removing user LaunchAgent (if present)..."
launchctl bootout gui/"$(id -u)"/"$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"

echo "Uninstalled. The worker process itself has been stopped; .env and logs were left in place."
