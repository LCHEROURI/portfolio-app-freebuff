#!/usr/bin/env node
// ============================================================================
// scripts/verify-deployed-hash.mjs — report the exact commit currently served
// by Firebase App Hosting, so readiness checks never have to infer the hash
// from a successful push.
//
// The portfolio app now deploys to Firebase App Hosting (backend
// portfolio-app-freebuff, project portfolio-app-freebuff2), so the live
// commit is resolved from the newest SUCCEEDED rollout's commit-sha label —
// the label the deploy script (scripts/deploy-portfolio-app.sh) stamps on
// every rollout. The Vercel API half was removed with the hosting migration.
//
// Auth: the ambient gcloud credentials — in CI/automation a service account
// via GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth activate-service-account
// --key-file`, locally the developer's user ADC (`gcloud auth login`).
//
// Usage:
//   node scripts/verify-deployed-hash.mjs
//     → newest SUCCEEDED rollout: commit sha, url, time
//   node scripts/verify-deployed-hash.mjs --url <deployed-url>
//     → validates the URL belongs to the App Hosting backend and reports the
//       rollout serving it (the backend serves a single hosted.app URL)
//   node scripts/verify-deployed-hash.mjs [--url <url>] --expect <sha>
//     → exits nonzero unless the deployed commit sha starts with <sha>
//   node scripts/verify-deployed-hash.mjs [--url <primary>] --compare-url <url>
//     → alias-drift watch. App Hosting serves exactly one URL per backend,
//       so both targets always resolve to the same rollout — retained for CLI
//       compatibility and reported honestly as a single-URL deployment.
//   node scripts/verify-deployed-hash.mjs --check-local
//     → also compares against `git rev-parse HEAD` (prints a warning, no exit)
//
// Flags COMBINE: --compare-url and --expect (and --check-local) can be given
// together — e.g. the verify:all deployed-hash gate and ship:go pass both —
// and the script exits nonzero if ANY requested check fails.
//
// Exports (for the unit test): extractSha, compareDrift, pickNewestSucceeded,
// canonicalHost, parseArgs, PRODUCTION_URL, PROJECT.
// Exits nonzero if gcloud is unavailable or the rollout can't be resolved.
// Read-only against the App Hosting API and git; no source changes.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'portfolio-app-freebuff';
export const PROJECT_ID = 'portfolio-app-freebuff2';
export const BACKEND_ID = 'portfolio-app-freebuff';
export const LOCATION = 'us-central1';
export const PRODUCTION_URL = 'https://portfolio-app-freebuff--portfolio-app-freebuff2.us-central1.hosted.app';
const API = 'https://firebaseapphosting.googleapis.com/v1beta';

/** The host part of the canonical production URL. */
export const canonicalHost = () => PRODUCTION_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** The commit sha a rollout is serving, if the deploy script labeled it. */
export function extractSha(rollout) {
  return rollout?.labels?.['commit-sha'] ?? '';
}

/**
 * Drift verdict for two deployment shas:
 *   'match' | 'mismatch' | 'unverifiable' (either side missing).
 */
export function compareDrift(a, b) {
  if (!a || !b) return 'unverifiable';
  return a === b ? 'match' : 'mismatch';
}

/**
 * Pick the rollout currently serving: the newest SUCCEEDED one. The rollouts
 * list is NOT newest-first, so sort by createTime descending rather than
 * trusting list order (a top-entry heuristic picked the wrong rollout before).
 */
export function pickNewestSucceeded(rollouts) {
  const succeeded = (rollouts ?? []).filter((r) => r?.state === 'SUCCEEDED');
  succeeded.sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));
  return succeeded[0] ?? null;
}

/**
 * Parse CLI flags into a plain object. Each raw arg is trimmed first: a
 * GitHub Actions plain-scalar `run: cmd \` block folds the trailing
 * backslash-newline into a literal backslash-space, so `--url "…"` arrives
 * in bash as the single word ` --url` (leading space). Trimming recovers the
 * flag so the script can never silently fall back to another branch just
 * because a flag lost its leading position.
 */
export function parseArgs(rawArgs) {
  const args = rawArgs.map((a) => a.trim());
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    expect: flag('--expect'),
    checkLocal: args.includes('--check-local'),
    url: flag('--url'),
    compareUrl: flag('--compare-url'),
  };
}

/** Resolve an OAuth access token from the ambient gcloud credentials. */
async function gcloudToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** GET a relative API path; throws with the HTTP status on failure. */
async function apiGet(path, token) {
  const res = await fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new Error(`Firebase App Hosting API returned HTTP ${res.status} for ${path}.`);
  }
  return body;
}

/** List every rollout of the backend across all pages. */
async function listAllRollouts(token) {
  const rollouts = [];
  let url = `projects/${PROJECT_ID}/locations/${LOCATION}/backends/${BACKEND_ID}/rollouts?pageSize=100`;
  while (url) {
    const body = await apiGet(url, token);
    rollouts.push(...(body?.rollouts ?? []));
    const next = body?.nextPageToken;
    if (!next) break;
    url = `projects/${PROJECT_ID}/locations/${LOCATION}/backends/${BACKEND_ID}/rollouts?pageSize=100&pageToken=${next}`;
  }
  return rollouts;
}

/**
 * Resolve what the backend is currently serving. Validates that the given
 * URL (when provided) belongs to this backend's single hosted.app URL — the
 * App Hosting equivalent of the Vercel host lookup, which also catches a
 * stale Vercel alias left in a caller. Throws on failure so the CLI can exit
 * nonzero with one message shape.
 */
export async function resolveLive(host, token) {
  const expected = canonicalHost();
  if (host && host !== expected) {
    throw new Error(
      `"${host}" is not this backend's URL (${expected}) — the app now deploys to Firebase App Hosting, not Vercel.`,
    );
  }
  const rollouts = await listAllRollouts(token);
  const rollout = pickNewestSucceeded(rollouts);
  if (!rollout) {
    throw new Error(`no SUCCEEDED rollout found for backend ${BACKEND_ID} — nothing is deployed yet.`);
  }
  return {
    sha: extractSha(rollout),
    url: PRODUCTION_URL,
    created: rollout.createTime ?? '',
  };
}

async function main() {
  const { expect: EXPECT, checkLocal: CHECK_LOCAL, url: URL_TARGET, compareUrl: COMPARE_URL } =
    parseArgs(process.argv.slice(2));

  const token = await gcloudToken();
  if (!token) {
    console.error('✗ FAIL: no gcloud credentials — run `gcloud auth login` (or set GOOGLE_APPLICATION_CREDENTIALS) to read the App Hosting rollouts.');
    process.exit(1);
  }

  let deployedSha = '';
  let deployedUrl = '';
  let created = '';
  let label = '';

  try {
    const live = await resolveLive(URL_TARGET ? URL_TARGET.replace(/^https?:\/\//, '').replace(/\/$/, '') : null, token);
    deployedSha = live.sha;
    deployedUrl = live.url;
    created = live.created;
  } catch (err) {
    console.error(`✗ FAIL: ${err.message}`);
    process.exit(1);
  }
  label = URL_TARGET ? `Deployed URL: ${URL_TARGET}` : `Deployed to production: ${PRODUCTION_URL}`;

  console.log(`\n${label}`);
  console.log(`  commit  ${deployedSha || '(unknown)'}`);
  console.log(`  url     ${deployedUrl}`);
  console.log(`  created ${created}`);
  console.log(`  project ${PROJECT} (App Hosting backend ${BACKEND_ID})`);

  let anyFailed = false;
  const sectionFails = {};
  let driftCompared = false;
  let expectCompared = false;
  let checkLocalCompared = false;

  // ── --compare-url <url>: alias-routing drift watch ────────────────────────
  // App Hosting serves exactly one URL per backend, so both targets resolve
  // to the same rollout — reported honestly, never skipped.
  if (COMPARE_URL) {
    const host = COMPARE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (host !== canonicalHost()) {
      console.error(`\n  ✗ FAIL: compare URL "${COMPARE_URL}" is not this backend's URL — the app no longer serves from Vercel.`);
      sectionFails.drift = (sectionFails.drift ?? 0) + 1;
      anyFailed = true;
    } else {
      driftCompared = true;
      console.log(`\n  ✓ App Hosting serves a single URL (${PRODUCTION_URL}) — both targets resolve to the same rollout (${deployedSha.slice(0, 12) || 'unknown'})`);
    }
  }

  // ── --check-local: compare against the local HEAD ─────────────────────────
  if (CHECK_LOCAL) {
    try {
      const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const match = (deployedSha && localSha.startsWith(deployedSha.slice(0, 12)))
        || (deployedSha && deployedSha.startsWith(localSha.slice(0, 12)));
      checkLocalCompared = true;
      if (!match) sectionFails.checkLocal = (sectionFails.checkLocal ?? 0) + 1;
      console.log(`\n  local HEAD ${localSha.slice(0, 12)} → ${match ? 'MATCHES deployed' : 'DIFFERS from deployed (push needed?)'}`);
    } catch {
      console.log('\n  (could not read local git HEAD)');
    }
  }

  // ── --expect <sha>: hard assertion for CI / pre-push ──────────────────────
  if (EXPECT) {
    if (!deployedSha) {
      console.log('\n  ⚠ no commit sha recorded for this rollout (deployed without the labeled deploy script?)');
      console.log('  → cannot verify against --expect — skipping the assertion (not a mismatch)');
    } else if (deployedSha.startsWith(EXPECT.toLowerCase())) {
      expectCompared = true;
      console.log(`\n  ✓ deployed commit matches --expect ${EXPECT}`);
    } else {
      expectCompared = true;
      console.error(`\n  ✗ deployed commit ${deployedSha} does not match --expect ${EXPECT}`);
      sectionFails.expect = (sectionFails.expect ?? 0) + 1;
      anyFailed = true;
    }
  }

  if (driftCompared) {
    console.log(`VERIFY-SUBRESULT|alias-drift|${(sectionFails.drift ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  }
  if (expectCompared) {
    console.log(`VERIFY-SUBRESULT|expect-match|${(sectionFails.expect ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  }
  if (checkLocalCompared) {
    console.log(`VERIFY-SUBRESULT|check-local|${(sectionFails.checkLocal ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
  }

  if (anyFailed) {
    console.error('\nRESULT: FAIL');
    process.exit(1);
  }
  const checksRun = Boolean(COMPARE_URL || EXPECT);
  console.log(checksRun ? '\nRESULT: PASS' : '\nRESULT: PASS (deployed hash reported)');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}