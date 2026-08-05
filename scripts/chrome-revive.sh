#!/usr/bin/env bash
# ============================================================================
# scripts/chrome-revive.sh — revive a Chrome that silently won't open.
#
# When Chrome's main process dies uncleanly (a crash, a force quit, a kernel
# panic), it leaves stale Singleton lock files behind in the real profile,
# pointing at the now-dead process. Chrome then thinks another instance is
# running and exits silently: no window, no error dialog, nothing. That is the
# exact failure this script fixes.
#
# It also sweeps the leftover headless capture instances that the gallery and
# verification scripts (capture-gallery.mjs, verify-prod-signin.mjs,
# verify-prod-matrix.mjs, tour-live.mjs) can leave behind when interrupted.
#
# Usage:
#   ./scripts/chrome-revive.sh             # clean up + relaunch Chrome
#   ./scripts/chrome-revive.sh --no-launch # clean up only, do not relaunch
#
# Exit codes: 0 = Chrome healthy or revived, 1 = could not revive, 2 = usage.
# ============================================================================
set -euo pipefail

CHROME_APP="${CHROME_APP_PATH:-/Applications/Google Chrome.app}"
CHROME_BIN="$CHROME_APP/Contents/MacOS/Google Chrome"
PROFILE_DIR="$HOME/Library/Application Support/Google/Chrome"
LAUNCH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-launch) LAUNCH=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

# A real GUI Chrome main process is one whose command line carries the main
# binary path WITHOUT --headless. Headless instances (and their helpers) all
# include --headless in their args, so this filter never mistakes them for the
# windowed app.
gui_running() {
  local pid
  for pid in $(pgrep -f "$CHROME_BIN" 2>/dev/null || true); do
    if ! ps -p "$pid" -o command= 2>/dev/null | grep -q -- '--headless'; then
      return 0
    fi
  done
  return 1
}

# ── 1. Sweep leftover headless capture instances ─────────────────────────────
echo "── 1/3 Sweeping leftover headless Chrome capture instances"
pkill -f 'Google Chrome.*--headless=new' 2>/dev/null || true
pkill -f 'gallery-capture-chrome' 2>/dev/null || true
pkill -f 'prod-matrix-chrome' 2>/dev/null || true
pkill -f 'prod-signin-chrome' 2>/dev/null || true
pkill -f 'tour-live-chrome' 2>/dev/null || true
sleep 1
echo "   done."

# ── 2. If the GUI is already running, there is nothing to revive ─────────────
if gui_running; then
  echo "✓ Chrome is already running (PID $(gui_running >/dev/null; pgrep -f "$CHROME_BIN" | head -1)) — nothing to revive."
  exit 0
fi

# ── 3. Remove stale Singleton locks (only when no GUI Chrome is alive) ───────
echo "── 2/3 Removing stale Singleton locks from $PROFILE_DIR"
if [[ ! -d "$PROFILE_DIR" ]]; then
  echo "✗ profile dir not found: $PROFILE_DIR" >&2
  exit 1
fi
rm -f "$PROFILE_DIR/SingletonCookie" "$PROFILE_DIR/SingletonLock" "$PROFILE_DIR/SingletonSocket"
echo "   removed (Chrome recreates them fresh on its next clean start)."

# ── 4. Relaunch Chrome ───────────────────────────────────────────────────────
if [[ "$LAUNCH" == "1" ]]; then
  echo "── 3/3 Relaunching Chrome"
  open -a "$(basename "$CHROME_APP" .app)" 2>/dev/null || open "$CHROME_APP"
  for _ in $(seq 1 10); do
    sleep 1
    if gui_running; then
      echo "✓ Chrome is running again."
      exit 0
    fi
  done
  echo "✗ Chrome did not come back up within 10s. Check ~/Library/Logs/DiagnosticReports/Google Chrome*.ips" >&2
  exit 1
fi

echo "✓ Cleanup complete (--no-launch)."
