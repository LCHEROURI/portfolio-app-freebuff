#!/usr/bin/env bash
# ============================================================================
# scripts/conv-db-maintain-schedule.sh — install/uninstall/status for the
# periodic conversation-DB WAL-maintenance launchd agent (plus a cron
# alternative).
#
# Schedules `scripts/conv-db-maintain-scheduled.sh` (which runs
# `maintain:conv-db` — a TRUNCATE checkpoint when the WAL file exceeds the
# 4 MiB threshold, with busy-retry) every 10 minutes via StartInterval. The
# app's own read transaction blocks the automatic PASSIVE checkpoint from
# resetting the WAL (confirmed Aug 2026), so an idle-period TRUNCATE is what
# keeps the file bounded. Default every 600s; override with MAINTAIN_INTERVAL.
#
# TCC caveat: launchd-spawned processes cannot read scripts/data under
# ~/Documents, and this repo lives under ~/Documents (the same wall that
# chrome-watch and scan-all hit). If the agent dies with "Operation not
# permitted", grant the launcher Full Disk Access, or run the command manually
# (`npm run maintain:conv-db`) from a terminal that already has Documents
# access.
#
# Usage:
#   npm run conv-db:schedule install      # write ~/Library/LaunchAgents plist + load
#   npm run conv-db:schedule uninstall    # bootout + remove the plist
#   npm run conv-db:schedule status       # show agent state + recent log tail
#   npm run conv-db:schedule cron         # print the crontab alternative line
# ============================================================================
set -euo pipefail

LABEL="com.freebuff.conv-db-maintain"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WRAPPER="${PROJECT_ROOT}/scripts/conv-db-maintain-scheduled.sh"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_FILE="${PROJECT_ROOT}/.freebuff/conv-db-maintain.log"
INTERVAL="${MAINTAIN_INTERVAL:-600}"

write_plist() {
  mkdir -p "${PLIST_DIR}"
  cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WRAPPER}</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF
  echo "Wrote ${PLIST_PATH}"
}

install_agent() {
  write_plist
  # Modern launchctl bootstrap (macOS 13+); fall back to legacy load otherwise.
  if launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null; then
    echo "Loaded launchd agent ${LABEL}."
  else
    launchctl load -w "${PLIST_PATH}"
    echo "Loaded launchd agent ${LABEL} (legacy load)."
  fi
  echo "Schedule: TRUNCATE checkpoint every ${INTERVAL}s when the WAL exceeds 4 MiB."
  echo "Log: ${LOG_FILE}"
  echo
  echo "NOTE: launchd agents cannot read files under ~/Documents by default (TCC), and"
  echo "cron is not exempt either. This repo is under ~/Documents — if the log shows"
  echo "'Operation not permitted', run 'npm run maintain:conv-db' from a terminal that has"
  echo "Documents access, or grant the launcher Full Disk Access (System Settings → Privacy"
  echo "& Security → Full Disk Access)."
}

uninstall_agent() {
  if launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null; then
    echo "Unloaded launchd agent ${LABEL}."
  else
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    echo "Unloaded launchd agent ${LABEL} (legacy unload)."
  fi
  rm -f "${PLIST_PATH}"
  echo "Removed ${PLIST_PATH}"
}

status_agent() {
  if [[ -f "${PLIST_PATH}" ]]; then
    echo "Plist exists: ${PLIST_PATH}"
    echo "Interval: $(defaults read "${PLIST_PATH%.plist}" StartInterval 2>/dev/null || echo "${INTERVAL}")s"
  else
    echo "No launchd plist installed (run: npm run conv-db:schedule install)."
  fi
  if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    echo "Agent loaded: YES"
  else
    echo "Agent loaded: no"
  fi
  if [[ -f "${LOG_FILE}" ]]; then
    echo "--- last 15 log lines ---"
    tail -15 "${LOG_FILE}"
  else
    echo "No maintenance log yet at ${LOG_FILE}"
  fi
}

cron_line() {
  echo "# Add this line to crontab -e (same 10-minute default):"
  echo "*/10 * * * * /bin/bash ${WRAPPER} >> ${LOG_FILE} 2>&1"
  echo "# cron is NOT automatically exempt from TCC either on modern macOS — if it dies with"
  echo "# 'Operation not permitted', run the command from a terminal that has Documents access,"
  echo "# or grant the launcher Full Disk Access."
  echo "# Tune the threshold via CONV_DB_MAINTAIN_THRESHOLD (bytes)."
}

case "${1:-}" in
  install)   install_agent ;;
  uninstall) uninstall_agent ;;
  status)    status_agent ;;
  cron)      cron_line ;;
  *)
    echo "Usage: $0 {install|uninstall|status|cron}" >&2
    exit 1
    ;;
esac
