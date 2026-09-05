#!/usr/bin/env bash
# ============================================================================
# scripts/check-rollout-health.sh — state-level health check for the
# freebuff-car-app Firebase App Hosting backend.
#
# The deploy workflow alerts when ITS OWN run fails, but that cannot catch:
#   - FAILED rollouts created outside Actions (e.g. native git rollouts once
#     the Console repo link exists, or manual CLI deploys)
#   - rollouts stuck PROGRESSING well past any normal deploy duration
#   - a STALE deployment: main's last car-app-touching commit is newer than
#     what the live rollout serves (a cancelled/skipped deploy)
#   - SERVING-level failures the rollout API cannot see: the live /api/version
#     endpoint is unreachable, returns non-200/non-JSON, or reports a null
#     commit (App Hosting says SUCCEEDED but traffic is broken)
#   - APP-LAYER degradation: /status must report "All checks passed" — its
#     loopback self-check catches in-process failures (e.g. a route 500ing)
#     that a 200 from /api/version alone cannot
#   - STALE BUILD MARKER: the live /advisor page must carry the
#     "freebuff-car-app deploy marker" footer that every deploy since PR #49
#     ships. Its absence means traffic is being served by a pre-marker
#     build (misrouted/wrong domain, a stale cache, or an old backend
#     still answering) even when /api/version and /status look fine
#
# This script classifies the NEWEST rollout and prints the verdict:
#
#   healthy       — newest rollout SUCCEEDED, the live /api/version endpoint
#                   returns a real commit, and it serves the latest car-app
#                   commit. (Also used for PROGRESSING/QUEUED rollouts still
#                   younger than STUCK_MINUTES — a deploy in flight, not an
#                   alert — with a "deploy is in flight" detail line.)
#   failed        — newest rollout is FAILED (previous build still serving)
#   stuck         — PROGRESSING/QUEUED for over STUCK_MINUTES (default 25)
#   stale         — SUCCEEDED but an older car-app commit than main's latest
#                   (only when the rollout carries a commit-sha label)
#   unreachable   — rollout SUCCEEDED but the live /api/version endpoint did
#                   not answer at all (serving down while Firebase reports
#                   healthy)
#   unprovenanced — /api/version answered non-200 or with a null commit (the
#                   cloud build lacks provenance env, or serving is broken)
#   degraded      — /status does not report "All checks passed" (in-process
#                   app failure), or /advisor lacks the deploy-marker footer
#                   (traffic served by a pre-marker build)
#
# Every verdict carries a SEVERITY used for alert routing:
#   page      — deploy failures and serving outages: the pipeline is broken
#               or traffic is broken (failed / stuck / unreachable /
#               unprovenanced / degraded). Wakes someone up.
#   warning   — rollout-stale (main advanced past what serves, e.g. a
#               cancelled deploy): the app still works; record it quietly.
#
# Output: "outcome=<verdict>" plus "severity=<page|warning>" (healthy emits
# severity=page so the caller's default path stays simple) plus human-readable
# detail lines. The calling workflow files/updates one open issue labeled
# deploy-failure (shared with the deploy workflow's run-level alerts, so a
# single failure produces a single issue) and closes it on recovery.
# Requires: gcloud auth (token), GH_TOKEN for the staleness commit lookup.
# ============================================================================
set -euo pipefail

PROJECT="${PROJECT:-portfolio-app-freebuff2}"
LOCATION="${LOCATION:-us-central1}"
BACKEND="${BACKEND:-freebuff-car-app}"
STUCK_MINUTES="${STUCK_MINUTES:-25}"
API="https://firebaseapphosting.googleapis.com/v1beta"
CAR_APP_PATH="${CAR_APP_PATH:-freebuff-car-app}"

auth() { curl -sfS -m 60 -H "Authorization: Bearer $(gcloud auth print-access-token)" "$@"; }

# ── Newest rollout by createTime (the list is NOT newest-first) ─────────────
ROLLOUTS="$(auth "$API/projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/rollouts?pageSize=50")"
NEWEST="$(printf '%s' "$ROLLOUTS" | jq -r '[.rollouts[]] | sort_by(.createTime) | reverse | .[0] // empty')"

if [ -z "$NEWEST" ]; then
  echo "outcome=failed"
  echo "severity=page"
  echo "detail=no rollouts found for backend $BACKEND — something is very wrong"
  exit 0
fi

NAME="$(printf '%s' "$NEWEST" | jq -r '.name')"
ROLLOUT_ID="${NAME##*/}"
STATE="$(printf '%s' "$NEWEST" | jq -r '.state')"
CREATE="$(printf '%s' "$NEWEST" | jq -r '.createTime')"
LIVE_SHA="$(printf '%s' "$NEWEST" | jq -r '.labels["commit-sha"] // empty')"
echo "newest rollout: $ROLLOUT_ID state=$STATE created=$CREATE live_sha=${LIVE_SHA:-none}"

# ── Verdict ──────────────────────────────────────────────────────────────────
case "$STATE" in
  FAILED)
    echo "outcome=failed"
    echo "severity=page"
    echo "detail=newest rollout $ROLLOUT_ID FAILED (created $CREATE) — the previous build is still serving"
    exit 0
    ;;
  PROGRESSING|QUEUED)
    CREATE_EPOCH="$(date -u -d "$CREATE" +%s)"
    CUTOFF_EPOCH="$(date -u -d "$STUCK_MINUTES minutes ago" +%s)"
    AGE_MINUTES="$(( ($(date -u +%s) - CREATE_EPOCH) / 60 ))"
    if [ "$CREATE_EPOCH" -lt "$CUTOFF_EPOCH" ]; then
      echo "outcome=stuck"
      echo "severity=page"
      echo "detail=rollout $ROLLOUT_ID has been $STATE since $CREATE (over ${STUCK_MINUTES}m) — deploy pipeline wedged"
    else
      echo "outcome=healthy"
      echo "detail=rollout $ROLLOUT_ID is $STATE but only ${AGE_MINUTES}m old — a deploy is in flight"
    fi
    exit 0
    ;;
esac

if [ "$STATE" != "SUCCEEDED" ]; then
  echo "outcome=failed"
  echo "severity=page"
  echo "detail=newest rollout $ROLLOUT_ID is in unexpected state $STATE"
  exit 0
fi

# ── Serving check: does the deployed app actually answer and self-report? ───
# The rollout API can say SUCCEEDED while serving is broken (traffic
# misconfiguration, runtime crash, an environment serving a non-deployed
# build). The app's /api/version endpoint is the ground truth: it must be
# reachable and return a non-null commit — a null means the cloud build never
# received the provenance env (a broken deploy path), not merely an old one.
VERSION_URL="${VERSION_URL:-https://freebuff-car-app--portfolio-app-freebuff2.us-central1.hosted.app/api/version}"
VERSION_JSON="$(curl -sS -m 30 -w '\n%{http_code}' "$VERSION_URL" 2>&1 || true)"
HTTP_CODE="$(printf '%s' "$VERSION_JSON" | tail -n 1)"
VERSION_BODY="$(printf '%s' "$VERSION_JSON" | sed '$d')"
VERSION_COMMIT="$(printf '%s' "$VERSION_BODY" | jq -r '.commit // empty' 2>/dev/null || true)"
if [ -z "$HTTP_CODE" ] || [ "$HTTP_CODE" = "000" ]; then
  echo "outcome=unreachable"
  echo "severity=page"
  echo "detail=rollout $ROLLOUT_ID is SUCCEEDED but $VERSION_URL did not answer — serving is down while Firebase reports healthy"
  exit 0
fi
if [ "$HTTP_CODE" != "200" ] || [ -z "$VERSION_COMMIT" ]; then
  echo "outcome=unprovenanced"
  echo "severity=page"
  echo "detail=$VERSION_URL answered HTTP ${HTTP_CODE:-none} with commit='${VERSION_COMMIT:-null}' — serving is broken or the cloud build lacks provenance env"
  exit 0
fi
echo "serving check: $VERSION_URL returned commit $VERSION_COMMIT (HTTP $HTTP_CODE)"

# ── App-layer check: /status must report its self-check as passing ──────────
# /status runs a loopback self-check inside the serving process (endpoint
# answers AND self-reports THIS build). A rollout can serve /api/version
# fine while another route is broken; the page verdict catches that class.
STATUS_URL="${STATUS_URL:-https://freebuff-car-app--portfolio-app-freebuff2.us-central1.hosted.app/status}"
STATUS_HTML="$(curl -sS -m 30 "$STATUS_URL" 2>&1 || true)"
if ! printf '%s' "$STATUS_HTML" | grep -q 'All checks passed'; then
  echo "outcome=degraded"
  echo "severity=page"
  echo "detail=$STATUS_URL does not report 'All checks passed' — the app's own self-check is failing while the rollout API reports healthy"
  exit 0
fi
echo "app-layer check: $STATUS_URL reports All checks passed"

# ── Build-marker check: does the served /advisor carry the deploy marker? ──
# Every build since PR #49 ships a small footer reading "freebuff-car-app
# deploy marker". It is static JSX, so it appears in the SSR HTML shell of
# /advisor — no hydration needed. If the live page lacks it, traffic is being
# served by a pre-marker build (a misrouted host, stale cache, or old backend
# still answering) even when /api/version and /status both pass — e.g. a
# different deployment serving an older rollout. A 200 with the marker absent
# is an app-content regression, not a healthy rollout.
ADVISOR_URL="${ADVISOR_URL:-https://freebuff-car-app--portfolio-app-freebuff2.us-central1.hosted.app/advisor}"
ADVISOR_HTML="$(curl -sS -m 30 "$ADVISOR_URL" 2>&1 || true)"
if ! printf '%s' "$ADVISOR_HTML" | grep -q 'freebuff-car-app deploy marker'; then
  echo "outcome=degraded"
  echo "severity=page"
  echo "detail=$ADVISOR_URL did not contain the 'freebuff-car-app deploy marker' footer — serving a pre-marker build while the rollout API reports healthy"
  exit 0
fi
echo "build-marker check: $ADVISOR_URL carries the 'freebuff-car-app deploy marker' footer"

# ── Staleness: does the live rollout serve main's latest car-app commit? ────
# Only meaningful when the rollout carries a commit-sha label (all rollouts
# created by scripts/deploy-car-app.sh do). Compare against the last commit
# that actually touched the car app — parent-only pushes need no deploy.
if [ -n "$LIVE_SHA" ] && [ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  LAST="$(gh api "repos/$GITHUB_REPOSITORY/commits?path=$CAR_APP_PATH&per_page=1" --jq '.[0]')"
  LAST_SHA="$(printf '%s' "$LAST" | jq -r '.sha')"
  LAST_DATE="$(printf '%s' "$LAST" | jq -r '.commit.committer.date')"
  if [ -n "$LAST_SHA" ] && [ "$LAST_SHA" != "$LIVE_SHA" ]; then
    LAST_EPOCH="$(date -u -d "$LAST_DATE" +%s)"
    CREATE_EPOCH="$(date -u -d "$CREATE" +%s)"
    if [ "$LAST_EPOCH" -gt "$CREATE_EPOCH" ]; then
      echo "outcome=stale"
      echo "severity=warning"
      echo "detail=live rollout $ROLLOUT_ID serves ${LIVE_SHA::7} but main's latest car-app commit is ${LAST_SHA::7} ($LAST_DATE) — a deploy was cancelled or skipped"
      exit 0
    fi
  fi
fi

echo "outcome=healthy"
echo "severity=page"
echo "detail=rollout $ROLLOUT_ID SUCCEEDED, $VERSION_URL self-reports commit ${VERSION_COMMIT}, /status reports All checks passed, $ADVISOR_URL carries the deploy marker, and it serves the latest car-app commit ${LIVE_SHA:+(${LIVE_SHA::7})}"
