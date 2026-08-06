#!/usr/bin/env bash
# ============================================================================
# scripts/chrome-watch.sh — launchd watchdog that revives a crashed Chrome.
#
# Polls every 30s (StartInterval in com.freebuff.chrome-watch.plist). When the
# GUI Chrome process is gone AND a fresh crash report (.ips) exists, it revives
# Chrome (sweeps headless strays, clears stale Singleton locks, relaunches).
# A deliberate quit (no crash report) is left alone.
#
# WHY IT IS SELF-CONTAINED AND INSTALLED INTO ~/Library:
# macOS privacy protection (TCC) blocks launchd-spawned processes from reading
# scripts under ~/Documents — a launchd job pointed at a script in this repo
# dies with "/bin/bash: …: Operation not permitted" (verified Aug 2026, and the
# pre-existing scan-all agent now hits the same wall). Scripts under
# ~/Library/Application Support run fine. So `install` copies this script AND
# scripts/chrome-revive.sh into ~/Library/Application Support/freebuff-watch/
# and points the plist at the installed copy, which resolves its sibling
# chrome-revive.sh relative to its own directory. Both copies are byte-identical
# to the repo sources, so re-running `install` re-syncs them after edits.
#
# Usage:
#   npm run chrome:watch check        # run one watchdog check (what the plist calls)
#   npm run chrome:watch install      # copy to ~/Library + write plist + load agent
#   npm run chrome:watch uninstall    # bootout + remove plist + installed copy
#   npm run chrome:watch status       # agent state + recent log tail
#   npm run chrome:watch log          # tail the watchdog log
# ============================================================================
set -euo pipefail

LABEL="com.freebuff.chrome-watch"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
INSTALL_DIR="${HOME}/Library/Application Support/freebuff-watch"
INSTALLED_SCRIPT="${INSTALL_DIR}/chrome-watch.sh"
INSTALLED_REVIVE="${INSTALL_DIR}/chrome-revive.sh"
LOG_FILE="${CHROME_WATCH_LOG:-${HOME}/Library/Logs/freebuff-chrome-watch.log}"
HEARTBEAT_STATE="${INSTALL_DIR}/.chrome-watch-heartbeat"
DIAG_DIR="${HOME}/Library/Logs/DiagnosticReports"
# Only revive when a crash report is this fresh — an old .ips from a long-ago
# crash must not relaunch Chrome after the user deliberately quit.
FRESH_SECONDS="${CHROME_WATCH_FRESH_SECONDS:-600}"
CHROME_APP="${CHROME_APP_PATH:-/Applications/Google Chrome.app}"
CHROME_BIN="${CHROME_APP}/Contents/MacOS/Google Chrome"

log() { echo "[$(date '+%F %T')] $*" >> "${LOG_FILE}"; }

# The watchdog polls every 30s; heartbeat lines prove the agent is alive
# without spamming the log (at most one per 15 min). State changes (revive /
# deliberate quit) always log immediately.
heartbeat() {
  local now last
  now="$(date +%s)"
  last="$(cat "${HEARTBEAT_STATE}" 2>/dev/null || echo 0)"
  if (( now - last >= 900 )); then
    echo "${now}" > "${HEARTBEAT_STATE}"
    log "watchdog alive — Chrome running"
  fi
}

# A real GUI Chrome main process is one whose command line carries the main
# binary path WITHOUT --headless (mirrors chrome-revive.sh).
gui_running() {
  local pid
  for pid in $(pgrep -f "${CHROME_BIN}" 2>/dev/null || true); do
    if ! ps -p "${pid}" -o command= 2>/dev/null | grep -q -- '--headless'; then
      return 0
    fi
  done
  return 1
}

fresh_crash_report() {
  local newest now age
  newest="$(ls -t "${DIAG_DIR}"/Google Chrome*.ips 2>/dev/null | head -1 || true)"
  [[ -n "${newest}" ]] || return 1
  now="$(date +%s)"
  age=$(( now - $(stat -f %m "${newest}" 2>/dev/null || echo 0) ))
  (( age <= FRESH_SECONDS ))
}

check_once() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  if gui_running; then
    heartbeat
    return 0 # healthy — nothing to do
  fi
  if fresh_crash_report; then
    log "Chrome process gone with a fresh crash report — reviving"
    # Delegate to the sibling revive script (same dir: repo or installed copy).
    local revive="${SCRIPT_DIR}/chrome-revive.sh"
    if [[ ! -x "${revive}" ]]; then
      log "chrome-revive.sh not found next to watchdog (${revive})"
      return 1
    fi
    bash "${revive}" >> "${LOG_FILE}" 2>&1 || log "chrome-revive.sh exited $? — will retry next poll"
  else
    # Process gone but no fresh crash → the user quit Chrome on purpose.
    log "Chrome not running, no fresh crash report — leaving it alone"
  fi
}

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
    <string>${INSTALLED_SCRIPT}</string>
    <string>check</string>
  </array>
  <key>StartInterval</key>
  <integer>30</integer>
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
  # Copy this watchdog + the revive script to a launchd-readable location
  # (TCC blocks launchd from reading scripts under ~/Documents).
  mkdir -p "${INSTALL_DIR}"
  cp -f "${SCRIPT_DIR}/chrome-watch.sh" "${INSTALLED_SCRIPT}"
  cp -f "${SCRIPT_DIR}/chrome-revive.sh" "${INSTALLED_REVIVE}"
  chmod 755 "${INSTALLED_SCRIPT}" "${INSTALLED_REVIVE}"
  echo "Installed watchdog + revive into ${INSTALL_DIR}"

  write_plist
  # Modern launchctl bootstrap (macOS 13+); fall back to legacy load otherwise.
  if launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null; then
    echo "Loaded launchd agent ${LABEL}."
  else
    launchctl load -w "${PLIST_PATH}"
    echo "Loaded launchd agent ${LABEL} (legacy load)."
  fi
  echo "Polling every 30s; revives Chrome when it dies with a fresh crash report."
  echo "Log: ${LOG_FILE}"
}

uninstall_agent() {
  if launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null; then
    echo "Unloaded launchd agent ${LABEL}."
  else
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    echo "Unloaded launchd agent ${LABEL} (legacy unload)."
  fi
  rm -f "${PLIST_PATH}" "${INSTALLED_SCRIPT}" "${INSTALLED_REVIVE}"
  rmdir "${INSTALL_DIR}" 2>/dev/null || true
  echo "Removed ${PLIST_PATH} and installed copies."
}

status_agent() {
  echo "=== launchd agent ==="
  if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | grep -E 'state|last exit code|program =' | head -4
    echo "→ agent loaded (runs ${INSTALLED_SCRIPT})"
  else
    echo "→ agent NOT loaded"
  fi
  echo
  echo "=== recent log ==="
  tail -15 "${LOG_FILE}" 2>/dev/null || echo "(no log yet — first check runs on the next 30s tick)"
}

case "${1:-check}" in
  check) check_once ;;
  install) install_agent ;;
  uninstall) uninstall_agent ;;
  status) status_agent ;;
  log) tail -40 "${LOG_FILE}" 2>/dev/null || echo "(no log yet)" ;;
  *) echo "Usage: $0 {check|install|uninstall|status|log}" >&2; exit 2 ;;
esac
