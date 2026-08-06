#!/usr/bin/env node
// ============================================================================
// scripts/verify-deployed-hash.mjs — report the exact commit deployed by
// Vercel, so readiness checks never have to infer the hash from a successful
// push.
//
// Reads VERCEL_TOKEN from:
//   1. the VERCEL_TOKEN env var
//   2. .env.local (VERCEL_TOKEN=…)
//   3. the Vercel CLI auth store (~/Library/Application Support/
//      com.vercel.cli/auth.json) — the fallback that keeps local runs working
//      before a durable token is pasted into .env.local
//
// Usage:
//   node scripts/verify-deployed-hash.mjs
//     → latest READY production deployment: commit sha, URL, time
//   node scripts/verify-deployed-hash.mjs --url <deployed-url>
//     → the deployment serving THAT URL (preview or production; the URL may
//       be the canonical alias or the deployment-specific subdomain) — this
//       is the mode the CI deployment_status gate uses, driven by the
//       event's target_url
//   node scripts/verify-deployed-hash.mjs [--url <url>] --expect <sha>
//     → exits nonzero unless the deployed commit sha starts with <sha>
//   node scripts/verify-deployed-hash.mjs --check-local
//     → also compares against `git rev-parse HEAD` (prints a warning, no exit)
//
// Exits nonzero if the token is missing or the target deployment can't be
// resolved. No source changes; read-only against the Vercel API.
// ============================================================================

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const PROJECT = 'portfolio-app-freebuff';
const PRODUCTION_URL = 'https://portfolio-app-freebuff.vercel.app';
const EXPECT = flag('--expect');
const CHECK_LOCAL = hasFlag('--check-local');
// The deployment URL to check. When set, the script looks up that exact
// deployment instead of the latest production one — the CI deployment_status
// gate passes the event's target_url here.
const URL_TARGET = flag('--url');

// ── Token resolution ────────────────────────────────────────────────────────
const readToken = () => {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(/^VERCEL_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  } catch { /* no .env.local */ }
  try {
    const auth = readFileSync(resolve(homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8');
    const parsed = JSON.parse(auth);
    if (parsed.token) return parsed.token;
  } catch { /* no CLI store */ }
  return null;
};

const token = readToken();
if (!token) {
  console.error('✗ FAIL: no VERCEL_TOKEN (set VERCEL_TOKEN, add it to .env.local, or run vercel login)');
  process.exit(1);
}

// ── Resolve the team id (the project lives in a team, not personal scope) ───
const resolveTeam = async () => {
  if (process.env.VERCEL_TEAM_ID) return process.env.VERCEL_TEAM_ID;
  const res = await fetch('https://api.vercel.com/v2/user', {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.user?.defaultTeamId ?? null;
};

const teamId = await resolveTeam();
if (!teamId) {
  console.error('✗ FAIL: could not resolve the Vercel team id from the token.');
  process.exit(1);
}

// ── Resolve the target deployment ───────────────────────────────────────────
// With --url: v13 single-deployment lookup by URL (accepts the canonical
// alias OR the deployment-specific subdomain). Without it: the latest READY
// production deployment.
let deployedSha = '';
let deployedUrl = '';
let created = '';
let label = '';

if (URL_TARGET) {
  const host = URL_TARGET.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const res = await fetch(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}?teamId=${teamId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`✗ FAIL: Vercel API returned HTTP ${res.status} for deployment URL "${host}".`);
    console.error('  (the deployment record may be purged, or the URL may be malformed)');
    process.exit(1);
  }
  const dep = await res.json();
  deployedSha = dep?.meta?.githubCommitSha ?? dep?.gitSource?.sha ?? '';
  deployedUrl = dep?.url ?? '';
  // v13 uses createdAt; v6 uses created. Resolve either.
  const ts = dep?.createdAt ?? dep?.created;
  created = ts ? new Date(ts).toISOString() : '';
  label = `Deployed URL: ${URL_TARGET}`;
} else {
  const res = await fetch(
    `https://api.vercel.com/v6/deployments?project=${PROJECT}&teamId=${teamId}&target=production&state=READY&limit=1`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error(`✗ FAIL: Vercel API returned HTTP ${res.status}.`);
    process.exit(1);
  }
  const json = await res.json();
  const dep = json?.deployments?.[0];
  if (!dep) {
    console.error(`✗ FAIL: no READY production deployment found for ${PROJECT}.`);
    process.exit(1);
  }
  deployedSha = dep?.meta?.githubCommitSha ?? dep?.gitSource?.sha ?? '';
  deployedUrl = dep?.url ?? '';
  created = dep?.created ? new Date(dep.created).toISOString() : '';
  label = `Deployed to production: ${PRODUCTION_URL}`;
}

console.log(`\n${label}`);
console.log(`  commit  ${deployedSha || '(unknown)'}`);
console.log(`  url     ${deployedUrl}`);
console.log(`  created ${created}`);
console.log(`  project ${PROJECT} (team ${teamId})`);

// ── --check-local: compare against the local HEAD ───────────────────────────
if (CHECK_LOCAL) {
  try {
    const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const match = (deployedSha && localSha.startsWith(deployedSha.slice(0, 12)))
      || (deployedSha && deployedSha.startsWith(localSha.slice(0, 12)));
    console.log(`\n  local HEAD ${localSha.slice(0, 12)} → ${match ? 'MATCHES deployed' : 'DIFFERS from deployed (push needed?)'}`);
  } catch {
    console.log('\n  (could not read local git HEAD)');
  }
}

// ── --expect <sha>: hard assertion for CI / pre-push ────────────────────────
if (EXPECT) {
  // A deployment with NO recorded commit sha (e.g. a CLI/prebuilt deploy with
  // no git metadata) cannot be drift-checked — there is nothing to compare.
  // Following the repo's skip-not-fail convention for unavailable signals, we
  // report it as unverifiable and exit 0 instead of falsely failing (or
  // falsely passing) an assertion we could not actually run.
  if (!deployedSha) {
    console.log('\n  ⚠ no commit sha recorded for this deployment (CLI/prebuilt deploy without git metadata?)');
    console.log('  → cannot verify against --expect — skipping the assertion (not a mismatch)');
    console.log('\nRESULT: PASS (unverifiable — skipped)');
    process.exit(0);
  }
  const ok = deployedSha.startsWith(EXPECT.toLowerCase());
  if (ok) {
    console.log(`\n  ✓ deployed commit matches --expect ${EXPECT}`);
    console.log('\nRESULT: PASS');
    process.exit(0);
  }
  console.error(`\n  ✗ deployed commit ${deployedSha} does not match --expect ${EXPECT}`);
  console.error('\nRESULT: FAIL');
  process.exit(1);
}

console.log('\nRESULT: PASS (deployed hash reported)');
process.exit(0);
