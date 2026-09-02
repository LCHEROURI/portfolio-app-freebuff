#!/usr/bin/env bash
# ============================================================================
# scripts/deploy-car-app.sh — labeled Firebase App Hosting deploy for
# freebuff-car-app.
#
# `firebase deploy --only apphosting` creates rollouts with no commit
# metadata (local-source rollouts carry empty commit fields and the CLI
# exposes no label flags), so this script performs the SAME steps the CLI
# performs internally (mirrored from firebase-tools'
# lib/deploy/apphosting/{prepare,release}.js and lib/gcp/apphosting.js):
#
#   1. zip the car-app source, honoring .gitignore
#   2. upload to the App Hosting sources GCS bucket
#   3. builds.create   — labeled with commit SHA, run URL, workflow
#   4. rollouts.create (validate-only, then real) — same labels
#   5. poll build + rollout operations to a terminal state
#
# Result: every rollout in the Firebase Console history self-describes with
# the commit that produced it. Required env: GITHUB_SHA, RUN_URL, and auth
# (GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key file).
# Optional env: CAR_APP_DIR (default freebuff-car-app), BACKEND/PROJECT/
# LOCATION/BUCKET (sane defaults below).
# ============================================================================
set -euo pipefail

PROJECT="${PROJECT:-portfolio-app-freebuff2}"
LOCATION="${LOCATION:-us-central1}"
BACKEND="${BACKEND:-freebuff-car-app}"
BUCKET="${BUCKET:-firebaseapphosting-sources-952213217375-us-central1}"
CAR_APP_DIR="${CAR_APP_DIR:-freebuff-car-app}"
API="https://firebaseapphosting.googleapis.com/v1beta"

: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${RUN_URL:?RUN_URL is required}"

# ── 0. Auth ─────────────────────────────────────────────────────────────────
# Uses the ambient gcloud credentials (in CI: the service account activated
# by the workflow's activate step; locally: the developer's user ADC).
auth() { curl -sfS -m 60 -H "Authorization: Bearer $(gcloud auth print-access-token)" "$@"; }

# List a collection across ALL pages — a page-one scan misses today's
# newest entries once a backend crosses 100 rollouts, and the derived id
# then collides with ALREADY_EXISTS.
list_all() { # $1 = collection path relative to $API
  local url="$API/$1?pageSize=100" resp token
  while :; do
    resp="$(auth "$url")"
    printf '%s\n' "$resp"
    token="$(printf '%s' "$resp" | jq -r '.nextPageToken // empty')"
    [ -z "$token" ] && break
    url="$API/$1?pageSize=100&pageToken=$token"
  done
}

# ── 1. Build id — same scheme as the CLI (build-YYYY-MM-DD-NNN). Computed
# FIRST so it can be baked into the app itself (the /api/version endpoint
# reports it). The CLI derives the next suffix from BOTH the rollouts and
# builds lists; scanning builds alone collides with existing ids (400).
TODAY="$(date -u +%Y-%m-%d)"
LAST_ID="$( { list_all "projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/builds"; \
              list_all "projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/rollouts"; } \
  | jq -s -r --arg t "$TODAY" '[ .[] | (.builds[]?, .rollouts[]?) | select(.name | test("build-" + $t + "-(\\d+)$")) | .name | capture("-(?<n>[0-9]+)$").n | tonumber ] | max // 0')"
NEXT_N="$(printf '%03d' "$((LAST_ID + 1))")"
BUILD_ID="build-${TODAY}-${NEXT_N}"
echo "build id: $BUILD_ID"

# ── 2. Bake provenance into the source, then zip it (respects .gitignore) ──
# App Hosting builds in the CLOUD from this archive; NEXT_PUBLIC_* values in
# .env.production are inlined by Next.js during that build (the runner env is
# long gone by then). The /api/version endpoint reports these. The file holds
# only public values and is deliberately NOT gitignored — firebase-tools
# packages uploads with supportGitIgnore: true, so an ignored file would be
# silently excluded.
printf 'NEXT_PUBLIC_COMMIT_SHA=%s\nNEXT_PUBLIC_ROLLOUT_ID=%s\nNEXT_PUBLIC_DEPLOYED_AT=%s\n' \
  "$GITHUB_SHA" "$BUILD_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CAR_APP_DIR/.env.production"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
ZIP="/tmp/car-app-src-${STAMP}-${GITHUB_SHA::7}.zip"
# Zip exactly the TRACKED file list (+ the provenance env) instead of the
# whole directory: firebase-tools' own packaging honors .gitignore, so a
# directory scan could drag untracked local state into the upload. zip reads
# the freshly written .env.production from disk.
( cd "$CAR_APP_DIR" && git ls-files -z | xargs -0 zip -q "$ZIP" && zip -q "$ZIP" .env.production )
rm -f "$CAR_APP_DIR/.env.production"
SIZE="$(du -h "$ZIP" | cut -f1 | tr -d ' ')"
echo "packaged source: $ZIP ($SIZE)"

# ── 2. Upload to the App Hosting sources bucket ─────────────────────────────
OBJECT="freebuff-car-app--${STAMP}-${GITHUB_SHA::7}.zip"
echo "uploading to gs://$BUCKET/$OBJECT"
gcloud storage cp "$ZIP" "gs://$BUCKET/$OBJECT" --quiet
STORAGE_URI="gs://$BUCKET/$OBJECT"

cleanup() { rm -f "$ZIP"; }
trap cleanup EXIT

COMMIT_URL="${COMMIT_URL:-https://github.com/LCHEROURI/portfolio-app-freebuff/commit/$GITHUB_SHA}"

# POST with the body echoed on failure: -f would hide the API's error JSON.
post() { # $1=url, $2=body-file
  local http_body
  http_body="$(curl -sS -m 60 -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" -d "$2" "$1")"
  if [ "$(printf '%s' "$http_body" | tail -n1)" != "200" ]; then
    printf '%s\n' "$http_body" | sed '$d' >&2
    return 1
  fi
  printf '%s\n' "$http_body" | sed '$d'
}

# ── 4. builds.create — the labels ride on the build ────────────────────────
# NOTE on metadata placement: label VALUES only allow [a-z0-9-_] (the API
# rejects ':' and '/', so a URL can never be a label value). Annotations are
# the unrestricted key/value map for external-tool metadata — the run URL
# lives there; the label keeps a safe, scannable SHA.
BUILD_BODY="$(jq -n \
  --arg sha "$GITHUB_SHA" \
  --arg runurl "$RUN_URL" \
  --arg uri "$STORAGE_URI" \
  --arg desc "commit ${GITHUB_SHA::7}" \
  '{source: {archive: {userStorageUri: $uri, description: $desc}},
    labels: {"commit-sha": $sha},
    annotations: {"run-url": $runurl, "commit-sha": $sha}}')"
if ! post "$API/projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/builds?buildId=$BUILD_ID" "$BUILD_BODY" > /tmp/build-op.json; then
  echo "builds.create failed" >&2
  exit 1
fi
echo "build operation: $(jq -r .name /tmp/build-op.json)"

# ── 5. Rollout — validate-only first (the CLI retries 400s here; a failure ──
#      means the build name is not yet visible, so retry up to 5 times) ──────
ROLLOUT_BODY="$(jq -n --arg b "projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/builds/$BUILD_ID" \
  --arg sha "$GITHUB_SHA" --arg runurl "$RUN_URL" \
  '{build: $b,
    labels: {"commit-sha": $sha},
    annotations: {"run-url": $runurl, "commit-sha": $sha}}')"
TRIES=0
until [ "$TRIES" -ge 5 ]; do
  TRIES=$((TRIES + 1))
  if post "$API/projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/rollouts?rolloutId=$BUILD_ID&validateOnly=true" "$ROLLOUT_BODY" > /dev/null; then
    break
  fi
  echo "validate-only not ready (try $TRIES) — waiting 2s"
  sleep 2
done
if [ "$TRIES" -ge 5 ]; then
  echo "rollout validate-only kept failing after 5 tries" >&2
  exit 1
fi

if ! post "$API/projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/rollouts?rolloutId=$BUILD_ID" "$ROLLOUT_BODY" > /tmp/rollout-op.json; then
  echo "rollouts.create failed" >&2
  exit 1
fi
echo "rollout operation: $(jq -r .name /tmp/rollout-op.json)"

# ── 6. Poll build + rollout operations to a terminal state (≤ 20 min) ──────
poll_op() { # $1 = op file; echoes terminal state or fails after timeout
  local opfile="$1" name state
  for _ in $(seq 1 80); do
    name="$(jq -r .name "$opfile")"
    state="$(auth "$API/$name" | jq -r '.done // false' )"
    if [ "$state" = "true" ]; then
      auth "$API/$name" > /tmp/op-final.json
      if [ "$(jq -r 'has("error")' /tmp/op-final.json)" = "true" ]; then
        echo "operation FAILED: $(jq -c .error /tmp/op-final.json)" >&2
        exit 1
      fi
      echo "operation done"
      return 0
    fi
    sleep 15
  done
  echo "operation timed out after 20 minutes" >&2
  exit 1
}
echo "polling build operation…"; poll_op /tmp/build-op.json
echo "polling rollout operation…"; poll_op /tmp/rollout-op.json

echo "✓ rollout $BUILD_ID deployed with labels commit-sha=${GITHUB_SHA::7} run-url=$RUN_URL"

# Expose the rollout to later workflow steps (the run summary prints it).
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "ROLLOUT_NAME=projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/rollouts/$BUILD_ID" >> "$GITHUB_ENV"
  echo "ROLLOUT_CREATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_ENV"
fi
