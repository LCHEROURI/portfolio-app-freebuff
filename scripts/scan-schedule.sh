#!/usr/bin/env bash
# ============================================================================
# scripts/scan-schedule.sh — install/uninstall/status for the daily scan-all
# launchd agent (plus a cron alternative).
#
# Schedules `scripts/scan-all-scheduled.sh` (which runs scan-all --notify) every
# morning BEFORE the 07:00 daily report so local repo facts are always fresh
# when the email sends. Default 06:30 local time; override with SCAN_HOUR and
# SCAN_MINUTE.
#
# Usage:
#   npm run scan:schedule install      # write ~/Library/LaunchAgents plist + load
#   npm run scan:schedule uninstall    # bootout + remove the plist
#   npm run scan:schedule status       # show agent state + recent log tail
#   npm run scan:schedule cron         # print the crontab alternative line
# ============================================================================
set -euo pipefail

LABEL="com.appportfoliocommandcenter.scan-all"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WRAPPER="${PROJECT_ROOT}/scripts/scan-all-scheduled.sh"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_FILE="${PROJECT_ROOT}/.freebuff/scan-all.log"
HOUR="${SCAN_HOUR:-6}"
MINUTE="${SCAN_MINUTE:-30}"

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
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
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
  echo "Schedule: daily at ${HOUR}:${MINUTE} local (before the 07:00 daily report)."
  echo "Log: ${LOG_FILE}"
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
    echo "Schedule: daily at $(defaults read "${PLIST_PATH%.plist}" StartCalendarInterval 2>/dev/null | tr -d '\n ' || echo "${HOUR}:${MINUTE}")"
  else
    echo "No launchd plist installed (run: npm run scan:schedule install)."
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
    echo "No scan log yet at ${LOG_FILE}"
  fi
}

cron_line() {
  echo "# Add this line to crontab -e (same 06:30 default):"
  echo "30 6 * * * /bin/bash ${WRAPPER} >> ${LOG_FILE} 2>&1"
  echo "# Or run the wrapper with an explicit API target:"
  echo "# 30 6 * * * SCAN_ALL_API=https://portfolio-app-freebuff.vercel.app/api/scanner /bin/bash ${WRAPPER}"
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
