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
#
# This script classifies the NEWEST rollout and prints the verdict:
#
#   healthy   — newest rollout SUCCEEDED, the live /api/version endpoint
#               returns a real commit, and it serves the latest car-app commit
#   failed    — newest rollout is FAILED (previous build still serving)
#   stuck     — PROGRESSING for over STUCK_MINUTES (default 25)
#   stale     — SUCCEEDED but an older car-app commit than main's latest
#               (only when the rollout carries a commit-sha label)
#
# Output: "outcome=<verdict>" plus human-readable detail lines. The calling
# workflow files/updates one open issue labeled deploy-failure (shared with
# the deploy workflow's run-level alerts, so a single failure produces a
# single issue) and closes it on recovery.
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
    echo "detail=newest rollout $ROLLOUT_ID FAILED (created $CREATE) — the previous build is still serving"
    exit 0
    ;;
  PROGRESSING|QUEUED)
    CREATE_EPOCH="$(date -u -d "$CREATE" +%s)"
    CUTOFF_EPOCH="$(date -u -d "$STUCK_MINUTES minutes ago" +%s)"
    AGE_MINUTES="$(( ($(date -u +%s) - CREATE_EPOCH) / 60 ))"
    if [ "$CREATE_EPOCH" -lt "$CUTOFF_EPOCH" ]; then
      echo "outcome=stuck"
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
  echo "detail=rollout $ROLLOUT_ID is SUCCEEDED but $VERSION_URL did not answer — serving is down while Firebase reports healthy"
  exit 0
fi
if [ "$HTTP_CODE" != "200" ] || [ -z "$VERSION_COMMIT" ]; then
  echo "outcome=unprovenanced"
  echo "detail=$VERSION_URL answered HTTP ${HTTP_CODE:-none} with commit='${VERSION_COMMIT:-null}' — serving is broken or the cloud build lacks provenance env"
  exit 0
fi
echo "serving check: $VERSION_URL returned commit $VERSION_COMMIT (HTTP $HTTP_CODE)"

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
      echo "detail=live rollout $ROLLOUT_ID serves ${LIVE_SHA::7} but main's latest car-app commit is ${LAST_SHA::7} ($LAST_DATE) — a deploy was cancelled or skipped"
      exit 0
    fi
  fi
fi

echo "outcome=healthy"
echo "detail=rollout $ROLLOUT_ID SUCCEEDED, $VERSION_URL self-reports commit ${VERSION_COMMIT}, and it serves the latest car-app commit ${LIVE_SHA:+(${LIVE_SHA::7})}"
