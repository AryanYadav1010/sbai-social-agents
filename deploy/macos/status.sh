#!/bin/bash
set -euo pipefail
LABEL="com.sbaisystems.socialworker"

echo "== System LaunchDaemon =="
if sudo launchctl print system/"$LABEL" 2>/dev/null | head -20; then
  :
else
  echo "Not installed as a LaunchDaemon."
fi

echo ""
echo "== User LaunchAgent =="
if launchctl print gui/"$(id -u)"/"$LABEL" 2>/dev/null | head -20; then
  :
else
  echo "Not installed as a LaunchAgent."
fi

echo ""
echo "== Database view (requires DATABASE_URL to be resolvable, e.g. .env present) =="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
(cd "$PROJECT_DIR" && npm run worker:status) || echo "(could not query the database -- check .env / network)"
