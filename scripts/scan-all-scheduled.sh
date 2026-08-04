#!/usr/bin/env bash
# ============================================================================
# scripts/scan-all-scheduled.sh — scheduled scan-all wrapper.
#
# Runs `npm run scan:all -- --notify` under launchd/cron, which run with a
# minimal PATH (no Homebrew node), and logs to .freebuff/scan-all.log. A lock
# file prevents overlapping runs if the previous scan is still in flight.
#
# Usage:
#   /bin/bash scripts/scan-all-scheduled.sh
#
# Point the scanner at a specific API with SCAN_ALL_API (defaults to the local
# dev server):   SCAN_ALL_API=https://portfolio-app-freebuff.vercel.app/api/scanner
# ============================================================================
set -euo pipefail

# launchd/cron inherit a minimal PATH — surface the common Node locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_ROOT}/.freebuff/scan-all.log"
LOCK_FILE="${PROJECT_ROOT}/.freebuff/scan-all.lock"

mkdir -p "$(dirname "${LOG_FILE}")"

# Overlapping-run guard (flock ships on macOS and Linux).
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date '+%F %T')] another scan-all run is in progress — skipping." >> "${LOG_FILE}"
  exit 0
fi

echo "[$(date '+%F %T')] scan-all scheduled run starting" >> "${LOG_FILE}"
cd "${PROJECT_ROOT}"
if [[ -n "${SCAN_ALL_API:-}" ]]; then
  SCANNER_EXTRA_ARGS=("--api" "${SCAN_ALL_API}")
else
  SCANNER_EXTRA_ARGS=()
fi
node scripts/scan-all.mjs --notify "${SCANNER_EXTRA_ARGS[@]}" >> "${LOG_FILE}" 2>&1
echo "[$(date '+%F %T')] scan-all scheduled run finished (exit $?)" >> "${LOG_FILE}"
