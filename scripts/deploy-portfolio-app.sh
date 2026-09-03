#!/usr/bin/env bash
# ============================================================================
# scripts/deploy-portfolio-app.sh — labeled Firebase App Hosting deploy for
# the parent portfolio app (this repo root).
#
# `firebase deploy --only apphosting` creates rollouts with no commit
# metadata (local-source rollouts carry empty commit fields and the CLI
# exposes no label flags), so this script performs the SAME steps the CLI
# performs internally (mirrored from firebase-tools'
# lib/deploy/apphosting/{prepare,release}.js and lib/gcp/apphosting.js):
#
#   1. zip the repo source (tracked files, minus freebuff-car-app/**), with
#      .env.production baked in
#   2. upload to the App Hosting sources GCS bucket
#   3. builds.create   — labeled with commit SHA, run URL
#   4. rollouts.create (validate-only, then real) — same labels
#   5. poll build + rollout operations to a terminal state
#
# Result: every rollout in the Firebase Console history self-describes with
# the commit that produced it. Required env: GITHUB_SHA, RUN_URL, and auth
# (GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key file, or
# a logged-in gcloud user for local runs). Optional env: BACKEND/PROJECT/
# LOCATION/BUCKET (sane defaults below).
#
# Build config: NEXT_PUBLIC_* values AND the server-side env keys listed in
# SERVER_ENV_KEYS are baked into .env.production before zipping (Next.js
# inlines NEXT_PUBLIC_* during the cloud build and loads .env.production
# server-side at runtime, so the server runtime gets FIREBASE_SERVICE_ACCOUNT
# etc. — the same credential surface the app had on Vercel). Locally, the
# values are read from .env.local; in CI the workflow exports them from
# GitHub secrets. VERCEL_* / VERIFY_* keys are NEVER baked (Vercel is
# retired; VERIFY_* are local verification-only), and NEXT_PUBLIC_DEMO_
# OVERRIDE is NEVER baked: a demo build must never reach production.
# ============================================================================

# Server-side runtime env that must reach the deployed app (mirrors the old
# Vercel production env). The deploy workflow exports these from secrets.
SERVER_ENV_KEYS="FIREBASE_PROJECT_ID FIREBASE_SERVICE_ACCOUNT FIREBASE_SITES GITHUB_TOKEN OPENROUTER_API_KEY OPENROUTER_MODEL REPORT_OWNER_ID CRON_SECRET"
set -euo pipefail

PROJECT="${PROJECT:-portfolio-app-freebuff2}"
LOCATION="${LOCATION:-us-central1}"
BACKEND="${BACKEND:-portfolio-app-freebuff}"
BUCKET="${BUCKET:-firebaseapphosting-sources-952213217375-us-central1}"
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
# FIRST so it can be baked into the app itself. The CLI derives the next
# suffix from BOTH the rollouts and builds lists; scanning builds alone
# collides with existing ids (400).
TODAY="$(date -u +%Y-%m-%d)"
LAST_ID="$( { list_all "projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/builds"; \
              list_all "projects/$PROJECT/locations/$LOCATION/backends/$BACKEND/rollouts"; } \
  | jq -s -r --arg t "$TODAY" '[ .[] | (.builds[]?, .rollouts[]?) | select(.name | test("build-" + $t + "-(\\d+)$")) | .name | capture("-(?<n>[0-9]+)$").n | tonumber ] | max // 0')"
NEXT_N="$(printf '%03d' "$((LAST_ID + 1))")"
BUILD_ID="build-${TODAY}-${NEXT_N}"
echo "build id: $BUILD_ID"

# ── 2. Bake provenance + public build config into the source, then zip ──────
# App Hosting builds in the CLOUD from this archive (the runner env is long
# gone by then). NEXT_PUBLIC_* values are inlined by Next.js during that
# build. The file holds only public values and is gitignored (.gitignore
# line 23) — the script adds it to the zip explicitly, so gitignore never
# silences it, and .gcloudignore's `!.env.production` keeps it in the
# container build context.
ENV_PROD=".env.production"
printf 'NEXT_PUBLIC_COMMIT_SHA=%s\nNEXT_PUBLIC_ROLLOUT_ID=%s\nNEXT_PUBLIC_DEPLOYED_AT=%s\n' \
  "$GITHUB_SHA" "$BUILD_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENV_PROD"
# Environment-provided values (CI exports them from secrets): NEXT_PUBLIC_*
# plus the SERVER_ENV_KEYS set above. VERCEL_* / VERIFY_* are never copied.
bake_env() { # $1 = the env source (already-exported shell env, or a file path)
  local source="$1"
  if [ "$source" = "__ENV__" ]; then
    env | grep '^NEXT_PUBLIC_' | grep -v '^NEXT_PUBLIC_DEMO_OVERRIDE=' || true
    for k in $SERVER_ENV_KEYS; do
      if [ -n "${!k:-}" ]; then printf '%s=%s\n' "$k" "${!k}"; fi
    done
  elif [ -f "$source" ]; then
    grep -E '^NEXT_PUBLIC_[A-Z_]+=' "$source" | grep -v '^NEXT_PUBLIC_DEMO_OVERRIDE=' || true
    for k in $SERVER_ENV_KEYS; do
      grep -E "^$k=" "$source" | head -1 || true
    done
  fi
}
bake_env __ENV__ >> "$ENV_PROD"
# …and, for local runs, the values already in .env.local (real-mode config).
if [ -f .env.local ]; then
  bake_env .env.local >> "$ENV_PROD"
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
ZIP="/tmp/portfolio-app-src-${STAMP}-${GITHUB_SHA::7}.zip"
# Zip exactly the TRACKED file list (+ the provenance env) instead of the
# whole directory, excluding the nested freebuff-car-app repo (it deploys
# under its own backend). NUL-safe on macOS/BSD grep.
git ls-files -z | tr '\0' '\n' | grep -v '^freebuff-car-app/' | tr '\n' '\0' \
  | xargs -0 zip -q "$ZIP"
zip -q "$ZIP" .env.production
# apphosting.yaml may still be untracked on the first local run (before it is
# committed) — zip it explicitly so the cloud build always sees it.
[ -f apphosting.yaml ] && zip -q "$ZIP" apphosting.yaml || true
SIZE="$(du -h "$ZIP" | cut -f1 | tr -d ' ')"
echo "packaged source: $ZIP ($SIZE)"

# ── 3. Build the container image ────────────────────────────────────────────
# App Hosting's source builds run in a slim runtime missing Chromium's shared
# libraries (the /api/print/pdf route 503s), so this app deploys as a custom
# container image (the documented App Hosting path for full runtime control).
# Dockerfile installs the libs; .gcloudignore keeps the context lean;
# .env.production (baked above) is copied into the image for the server env.
# The env file must survive until AFTER the submit (the archive/context is
# uploaded at that point); it is removed by the cleanup trap below.
IMAGE="gcr.io/${PROJECT}/portfolio-app-freebuff:${GITHUB_SHA}"
echo "building image ${IMAGE}…"
# --project is explicit: gcloud on a fresh runner has no default project.
gcloud builds submit --project "$PROJECT" --quiet --tag "$IMAGE" .

cleanup() { rm -f "$ZIP" "$ENV_PROD"; }
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
  --arg image "$IMAGE" \
  '{source: {container: {image: $image}},
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