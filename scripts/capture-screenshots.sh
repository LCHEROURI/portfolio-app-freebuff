#!/usr/bin/env bash
#
# Regenerate every README gallery screenshot in one command.
#
# The gallery is captured from a deployed Vercel build (so the PNGs match what
# visitors see at the live link, not a local dev server). Pass --url to point
# at a different source (a preview deployment, or http://localhost:3000 in demo
# mode). Chrome must be installed; Node is required for the CDP driver.
#
# Usage:
#   ./scripts/capture-screenshots.sh                 # deployed production build
#   ./scripts/capture-screenshots.sh --url http://localhost:3000
#   ./scripts/capture-screenshots.sh --out /tmp/gallery
#   ./scripts/capture-screenshots.sh --header 'x-vercel-protection-bypass: <secret>'
#   ./scripts/capture-screenshots.sh --diff          # only rewrite PNGs whose pixels changed
#
# Exit codes: 0 = all cells captured, 1 = any cell skipped or missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="screenshots"
URL="https://portfolio-app-freebuff.vercel.app"
EXPECTED=18
DIFF=0
HEADERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="${2:?--url needs a value}"; shift 2 ;;
    --out) OUT="${2:?--out needs a value}"; shift 2 ;;
    --header) HEADERS+=("${2:?--header needs a value}"); shift 2 ;;
    --diff) DIFF=1; shift ;;
    -h|--help)
      sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

cd "$ROOT"

# ── Prerequisites ────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "node is required." >&2; exit 1; }
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at $CHROME (set CHROME_PATH to override)." >&2
  exit 1
fi

# ── Source reachability ──────────────────────────────────────────────────────
# curl -I follows the redirect; a 200 means the source answers. If the deployed
# URL is unreachable (offline / auth wall), fall back to a local dev server so
# the script still works in offline development. Any --header values are sent
# on the probe too, so protection-gated preview deployments pass the check.
reachable() {
  local args=(-s -o /dev/null -m 10 -w '%{http_code}' -L)
  local h
  if [[ ${#HEADERS[@]} -gt 0 ]]; then
    for h in "${HEADERS[@]}"; do args+=(-H "$h"); done
  fi
  curl "${args[@]}" "$1" 2>/dev/null | grep -q '^200$'
}
if ! reachable "$URL"; then
  if reachable "http://localhost:3000"; then
    echo "Deployed URL unreachable ($URL); falling back to http://localhost:3000" >&2
    URL="http://localhost:3000"
  else
    echo "Neither $URL nor http://localhost:3000 answered HTTP 200." >&2
    if [[ ${#HEADERS[@]} -eq 0 ]]; then
      echo "Hint: if the target is a protection-gated preview, add" >&2
      echo "  --header 'x-vercel-protection-bypass: <secret>'">&2
    fi
    exit 1
  fi
fi

# ── Capture ──────────────────────────────────────────────────────────────────
# In --diff mode capture into a throwaway temp dir, then copy a PNG into OUT
# only when its pixels actually changed, so trivial re-runs leave the git tree
# clean. Without --diff the driver writes straight into OUT as before.
CAPTURE_DIR="$OUT"
if [[ "$DIFF" == "1" ]]; then
  CAPTURE_DIR="$(mktemp -d)"
  trap 'rm -rf "$CAPTURE_DIR"' EXIT
fi

echo "Capturing $EXPECTED gallery cells from $URL into $CAPTURE_DIR/ ..."
CAPTURE_LOG="$(mktemp)"
DRIVER_ARGS=(--url "$URL" --out "$CAPTURE_DIR")
if [[ ${#HEADERS[@]} -gt 0 ]]; then
  for hdr in "${HEADERS[@]}"; do DRIVER_ARGS+=(--header "$hdr"); done
fi
node scripts/capture-gallery.mjs "${DRIVER_ARGS[@]}" 2>&1 | tee "$CAPTURE_LOG"
PIPE_STATUS="${PIPESTATUS[0]}"

# ── Stale-gallery guard ──────────────────────────────────────────────────────
COUNT="$(find "$CAPTURE_DIR" -maxdepth 1 -name '*.png' 2>/dev/null | wc -l | tr -d ' ')"
SKIPPED="$(grep -c '^SKIP ' "$CAPTURE_LOG" || true)"

if [[ "$COUNT" -lt "$EXPECTED" ]]; then
  echo "FAIL: expected $EXPECTED PNGs in $CAPTURE_DIR/, found $COUNT — gallery is incomplete." >&2
  exit 1
fi
if [[ "$SKIPPED" -gt 0 ]]; then
  echo "NOTE: $SKIPPED cell(s) were skipped (auth gate or shell not rendered); the gallery may not match the current UI." >&2
  exit 1
fi
if [[ "$PIPE_STATUS" -ne 0 ]]; then
  echo "FAIL: capture driver exited with $PIPE_STATUS." >&2
  exit 1
fi

# ── Contact sheet ────────────────────────────────────────────────────────────
# The driver emits screenshots.html next to the PNGs; relocate it to docs/ so
# the gallery is browsable locally without opening the README, rewriting the
# src paths to point at the repo's screenshots/ folder.
mkdir -p "$ROOT/docs"
if [[ -f "$CAPTURE_DIR/screenshots.html" ]]; then
  sed 's|src="\./|src="../screenshots/|g' "$CAPTURE_DIR/screenshots.html" > "$ROOT/docs/screenshots.html"
  echo "contact sheet → docs/screenshots.html"
fi

# ── Merge (--diff only) ──────────────────────────────────────────────────────
if [[ "$DIFF" == "1" ]]; then
  CHANGED=0
  KEPT=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ -f "$OUT/$f" ]] && cmp -s "$CAPTURE_DIR/$f" "$OUT/$f"; then
      KEPT=$((KEPT + 1))
    else
      cp "$CAPTURE_DIR/$f" "$OUT/$f"
      CHANGED=$((CHANGED + 1))
    fi
  done < <(grep '^captured ' "$CAPTURE_LOG" | awk '{print $2}')
  echo "OK: $COUNT screenshots captured, $CHANGED updated, $KEPT unchanged — tree stays clean when nothing moved."
else
  echo "OK: $COUNT screenshots captured. Review with: git status --short screenshots/ docs/"
fi
rm -f "$CAPTURE_LOG"
