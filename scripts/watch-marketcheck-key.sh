#!/usr/bin/env bash
# ============================================================================
# scripts/watch-marketcheck-key.sh — armed watcher for the MarketCheck key.
#
# Polls the GitHub secret list for MARKETCHECK_API_KEY. The moment it
# appears:
#   1. dispatches deploy-car-app.yml (which bakes the key into .env.production)
#   2. waits for the deploy to finish
#   3. probes the live /api/inventory twice:
#        with budget params  -> expects source=marketcheck
#        without key-bearing semantics (plain) -> also marketcheck
#      If the upstream key is invalid, the route answers demo/upstream-error
#      and the watcher reports KEY_INVALID (exit 4) after a single retry.
#   4. appends a timestamped line to the state file and exits
#
# Exit codes: 0 live | 2 timeout waiting for secret | 3 deploy failed |
#             4 key rejected upstream
# Logs:   /tmp/marketcheck-watcher.log   State: /tmp/marketcheck-watcher.state
# ============================================================================
set -u
REPO_DIR="/Users/laredjchehrouri/Documents/freebuff meal planner/portfolio-app-freebuff"
LIVE="https://freebuff-car-app--portfolio-app-freebuff2.us-central1.hosted.app"
POLL_SECS=30
MAX_POLLS=2016            # one week of 30s polls
LOG="/tmp/marketcheck-watcher.log"
STATE="/tmp/marketcheck-watcher.state"

export HOME="$HOME"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$REPO_DIR" || exit 1

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $*" >> "$LOG"; }

report() { # $1 = code, $2 = message
  log "$2"
  echo "$(date '+%Y-%m-%dT%H:%M:%S')|$1|$2" >> "$STATE"
  case "$1" in
    0) curl -sfS -X POST -H 'Content-Type: application/json' \
         -d "{\"text\":\"✅ MarketCheck key detected → deployed → Step 2 is LIVE: $2\"}" \
         "${ALERT_WEBHOOK_URL:-}" >/dev/null 2>&1 || true ;;
    *) curl -sfS -X POST -H 'Content-Type: application/json' \
         -d "{\"text\":\"⚠️ MarketCheck watcher: $2\"}" \
         "${ALERT_WEBHOOK_URL:-}" >/dev/null 2>&1 || true ;;
  esac
  exit "$1"
}

log "watcher armed (pid $$)"

n=0
until [ "$n" -ge "$MAX_POLLS" ]; do
  n=$((n+1))
  if gh secret list -R LCHEROURI/portfolio-app-freebuff 2>>"$LOG" | grep -qi '^MARKETCHECK_API_KEY'; then
    log "secret detected on poll $n — dispatching deploy"
    if ! gh workflow run deploy-car-app.yml -R LCHEROURI/portfolio-app-freebuff 2>>"$LOG"; then
      report 3 "failed to dispatch deploy workflow"
    fi
    sleep 20
    RUN_ID=$(gh run list -R LCHEROURI/portfolio-app-freebuff \
      --workflow=deploy-car-app.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>>"$LOG")
    log "watching deploy run $RUN_ID"
    for _ in $(seq 1 60); do
      S=$(gh run view "$RUN_ID" -R LCHEROURI/portfolio-app-freebuff \
        --json status,conclusion -q '.status+":"+(.conclusion//"")' 2>>"$LOG")
      case "$S" in
        completed:success) break ;;
        completed:*)        report 3 "deploy run $RUN_ID ended: $S" ;;
      esac
      sleep 20
    done
    [ "$S" = "completed:success" ] || report 3 "deploy run $RUN_ID still not terminal: $S"

    # Probe live: with and without the budget triple.
    sleep 10
    B=$(curl -sfS -m 30 "${LIVE}/api/inventory?budget=4500&down=5000&credit=good&zip=60601&bodyType=suv" 2>>"$LOG") \
      || report 3 "deploy success but /api/inventory probe failed"
    SRC_B=$(echo "$B" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("source",""))' 2>>"$LOG")
    REASON_B=$(echo "$B" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("demoReason","none"))' 2>>"$LOG")
    P=$(curl -sfS -m 30 "${LIVE}/api/inventory?zip=60601" 2>>"$LOG") \
      || report 3 "deploy success but plain /api/inventory probe failed"
    SRC_P=$(echo "$P" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("source",""))' 2>>"$LOG")

    if [ "$SRC_B" = "marketcheck" ] && [ "$SRC_P" = "marketcheck" ]; then
      COUNT=$(echo "$B" | /usr/bin/python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("vehicles",[])))' 2>>"$LOG")
      report 0 "source=marketcheck on both probes (budget-filtered probe returned $COUNT vehicles)"
    fi

    # First failure might be upstream hiccup; retry once after 60s.
    log "probe showed source=${SRC_B:-?}/${SRC_P:-?} (reason=${REASON_B:-?}) — retrying once in 60s"
    sleep 60
    B2=$(curl -sfS -m 30 "${LIVE}/api/inventory?budget=4500&down=5000&credit=good" 2>>"$LOG") || B2=""
    SRC_B2=$(echo "$B2" | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin).get("source",""))' 2>>"$LOG") || SRC_B2=""
    if [ "$SRC_B2" = "marketcheck" ]; then
      report 0 "source=marketcheck on retry"
    fi
    report 4 "key detected and deployed but upstream answers demo/${REASON_B:-error} — key likely invalid"
  fi
  sleep "$POLL_SECS"
done

report 2 "gave up waiting for MARKETCHECK_API_KEY after a week of polling"
