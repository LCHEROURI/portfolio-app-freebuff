#!/usr/bin/env bash
# ============================================================================
# scripts/conv-db-maintain-scheduled.sh — scheduled WAL-maintenance wrapper.
#
# Runs `npm run maintain:conv-db` under launchd/cron, which run with a minimal
# PATH (no Homebrew node), and logs to .freebuff/conv-db-maintain.log. A lock
# file prevents overlapping runs if the previous maintenance is still in
# flight. This is the periodic shrinker for the conversation DB's WAL file
# (see scripts/maintain-conv-db.mjs for the root cause and the busy-retry
# contract).
#
# TCC CAVEAT (same wall chrome-watch documents): launchd-spawned processes are
# blocked from reading scripts/data under ~/Documents, and this repo lives
# under ~/Documents (cron is not exempt either). The schedule installer prints
# this; if the job dies with "Operation not permitted", run the command
# manually (`npm run maintain:conv-db`) from a terminal that has Documents
# access, or grant the launcher Full Disk Access in System Settings → Privacy
# & Security → Full Disk Access.
#
# Usage:
#   /bin/bash scripts/conv-db-maintain-scheduled.sh
# Overrides pass through: CONV_DB_PATH, CONV_DB_MAINTAIN_THRESHOLD,
# CONV_DB_MAINTAIN_RETRIES, CONV_DB_MAINTAIN_RETRY_DELAY.
# ============================================================================
set -euo pipefail

# launchd/cron inherit a minimal PATH — surface the common Node locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_FILE="${PROJECT_ROOT}/.freebuff/conv-db-maintain.log"
LOCK_DIR="${PROJECT_ROOT}/.freebuff/conv-db-maintain.lockdir"

mkdir -p "$(dirname "${LOG_FILE}")"

# Overlapping-run guard (portable mkdir lock, same as scan-all-scheduled.sh).
# A lock older than 2h is treated as stale (a crashed run) and broken.
acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    return 0
  fi
  if find "${LOCK_DIR}" -maxdepth 0 -mmin +120 2>/dev/null | grep -q .; then
    rm -rf "${LOCK_DIR}"
    if mkdir "${LOCK_DIR}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if ! acquire_lock; then
  echo "[$(date '+%F %T')] another maintenance run is in progress — skipping." >> "${LOG_FILE}"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || rm -rf "${LOCK_DIR}"' EXIT

echo "[$(date '+%F %T')] conv-db WAL maintenance starting" >> "${LOG_FILE}"
cd "${PROJECT_ROOT}"
node scripts/maintain-conv-db.mjs >> "${LOG_FILE}" 2>&1
STATUS=$?
echo "[$(date '+%F %T')] conv-db WAL maintenance finished (exit ${STATUS})" >> "${LOG_FILE}"
exit ${STATUS}
