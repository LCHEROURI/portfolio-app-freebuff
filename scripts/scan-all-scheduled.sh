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
# Authenticate Firestore writes with SCAN_ALL_TOKEN (the CRON_SECRET value),
# which the deployed /api/scanner requires as `Authorization: Bearer`:
#   SCAN_ALL_TOKEN=<cron-secret>   # same value as CRON_SECRET in Vercel
# ============================================================================
set -euo pipefail

# launchd/cron inherit a minimal PATH — surface the common Node locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_ROOT}/.freebuff/scan-all.log"
LOCK_DIR="${PROJECT_ROOT}/.freebuff/scan-all.lockdir"

mkdir -p "$(dirname "${LOG_FILE}")"

# Overlapping-run guard. flock is not shipped on macOS, so use a portable
# mkdir-based lock: mkdir succeeds only when no other run holds the lock. A
# lock older than 2h is treated as stale (a crashed run) and broken, so a dead
# process can never wedge the schedule.
acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    return 0
  fi
  # Stale lock from a crashed run? Break it and retry once.
  if find "${LOCK_DIR}" -maxdepth 0 -mmin +120 2>/dev/null | grep -q .; then
    rm -rf "${LOCK_DIR}"
    if mkdir "${LOCK_DIR}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if ! acquire_lock; then
  echo "[$(date '+%F %T')] another scan-all run is in progress — skipping." >> "${LOG_FILE}"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || rm -rf "${LOCK_DIR}"' EXIT

echo "[$(date '+%F %T')] scan-all scheduled run starting" >> "${LOG_FILE}"
cd "${PROJECT_ROOT}"
# macOS bash 3.2 cannot expand an empty array under `set -u`, so pass flags as
# plain strings when set (SCAN_ALL_API / SCAN_ALL_TOKEN) and as nothing
# otherwise. SCAN_ALL_TOKEN is the bearer token the deployed /api/scanner
# requires for Firestore writes (the same value as CRON_SECRET) — the scanner
# forwards it as `Authorization: Bearer`.
ARGS=(--notify)
if [[ -n "${SCAN_ALL_API:-}" ]]; then
  ARGS+=(--api "${SCAN_ALL_API}")
fi
if [[ -n "${SCAN_ALL_TOKEN:-}" ]]; then
  ARGS+=(--token "${SCAN_ALL_TOKEN}")
fi
node scripts/scan-all.mjs "${ARGS[@]}" >> "${LOG_FILE}" 2>&1
STATUS=$?
echo "[$(date '+%F %T')] scan-all scheduled run finished (exit ${STATUS})" >> "${LOG_FILE}"
exit ${STATUS}
