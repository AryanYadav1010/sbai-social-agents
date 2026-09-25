#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

if [ ! -d "$LOG_DIR" ]; then
  echo "No logs yet -- has the worker been installed and started? See install.sh."
  exit 1
fi

echo "Tailing $LOG_DIR/worker.out.log and worker.err.log (Ctrl+C to stop)..."
tail -n 100 -f "$LOG_DIR/worker.out.log" "$LOG_DIR/worker.err.log"
