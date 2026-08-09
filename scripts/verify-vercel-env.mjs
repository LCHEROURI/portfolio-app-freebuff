#!/usr/bin/env node
// ============================================================================
// scripts/verify-vercel-env.mjs — assert Vercel's production env matches
// .env.local, and classify GitHub secrets that are legitimately CI-only.
//
// The app's secrets live in THREE stores: .env.local (local dev), Vercel
// production env (the deployed app), and GitHub Actions secrets (CI). They have
// drifted before (REPORT_OWNER_ID silently holding 'demo-user' while .env.local
// carried the real uid), so this gate makes the .env.local ↔ Vercel pair a hard
// invariant and renders the GitHub store's CI-only entries as expected, not
// drift:
//
//   - Every key in .env.local MUST exist in Vercel production AND carry the
//     SAME value (compared exactly, never printed — only key names and value
//     lengths are shown, so a mismatch is diagnosable without leaking secrets).
//   - Keys in Vercel production that .env.local lacks are reported (Vercel-only
//     runtime vars are legitimate) but do NOT fail.
//   - The EXPECTED_LIVE_FLAGS set is a HARD requirement of the deployed store:
//     each NEXT_PUBLIC_LIVE_* / NEXT_PUBLIC_ENABLE_* build-time feature toggle
//     must exist in Vercel production with its enabled value, regardless of
//     .env.local. The drift diff above only compares the two stores, so a flag
//     missing from BOTH would pass silently while the deployed app renders
//     demo data — exactly the NEXT_PUBLIC_LIVE_DEPLOYMENTS incident. This set
//     closes that gap.
//   - GitHub secrets are listed and classified: CI-only (present in GitHub,
//     absent from .env.local and Vercel — expected, e.g. VERCEL_ORG_ID,
//     VERCEL_PROJECT_ID, VERCEL_PROTECTION_BYPASS) vs shared (present in more
//     than one store). CI-only entries are informational; a GitHub secret that
//     SHOULD also exist in Vercel but doesn't is surfaced as drift.
//   - SYSTEM_INJECTED_VARS (VERCEL_OIDC_TOKEN, VERCEL_URL, VERCEL_ENV,
//     VERCEL_TARGET_ENV, the VERCEL_GIT_* metadata set, bare VERCEL) are
//     injected by Vercel per build and ROTATE every deploy/commit. A raw
//     `vercel env pull` writes them, so an untrimmed pull file saved as
//     .env.local would otherwise false-alarm as value drift. They are exempt
//     from comparison and surfaced as informational (lengths only). Real
//     project vars that merely share the prefix (VERCEL_TOKEN, VERCEL_TEAM_ID)
//     are NOT exempt — they stay value-compared exactly.
//
// Values are pulled from Vercel via `vercel env pull` (the CLI writes the
// decrypted values to a temp file; the REST API exposes key names + type but
// never the plaintext). The temp file is deleted in a finally block. The CLI
// binary is resolved as `vercel`, falling back to `npx --yes vercel`.
//
// SENSITIVE VARS ARE WRITE-ONLY: Vercel's `sensitive` type (used for real
// secrets like CRON_SECRET, OPENROUTER_*, VERCEL_TOKEN) cannot be echoed back
// after creation — `env pull` writes an empty string for them. So this gate
// PRESENCE-CHECKS sensitive vars (key must exist in Vercel prod) and
// VALUE-COMPARES only the readable `encrypted`/`plain` vars, which DO pull
// their real values (e.g. REPORT_OWNER_ID). A sensitive var whose value is
// behaviorally proven elsewhere (verify:cron-reports authenticates with the
// deployed CRON_SECRET) is reported as present-but-not-readable, never as
// false drift. The per-key `type` comes from the REST env list; a key whose
// pulled value is empty is treated as write-only, not as a mismatch.
//
// Usage:
//   npm run verify:vercel-env          # against production env
//   node scripts/verify-vercel-env.mjs
//
// Exports (for the unit test): parseEnvFile, diffEnvMaps, parseGhSecretList,
// classifyGithubSecrets, missingExpectedFlags, SYSTEM_INJECTED_VARS. Token
// resolution reuses readToken + the invalid-token contract from
// verify-deployed-hash.mjs (env → .env.local → CLI store), so the credential
// flow can never drift from the other Vercel gates.
//
// Exit codes: 0 = env matches (drift-free), 1 = drift or verification failed,
// 2 = VERCEL_TOKEN invalid/revoked (Vercel flagged invalidToken:true) — the
// same contract the other Vercel gates use. GitHub classification degrades to
// skip-not-fail when `gh` is unavailable.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INVALID_TOKEN_MESSAGE,
  isInvalidToken,
  readToken,
} from './verify-deployed-hash.mjs';

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Parse a dotenv-style file into key → value. Skips blank lines and # comments,
 * strips one level of surrounding double/single quotes. Values are NEVER
 * printed by this gate — only key names and lengths.
 */
export function parseEnvFile(text) {
  const out = new Map();
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * Diff two key→value maps into a drift report. Returns:
 *   { missingInVercel: string[], valueMismatch: {key, localLen, vercelLen}[],
 *     valueUnreadable: {key, reason}[], systemInjected: {key, localLen,
 *     vercelLen}[], extraInVercel: string[] }
 *
 * Vercel's `sensitive` vars are write-only: env pull returns an empty string
 * for them, so a key whose pulled value is EMPTY is presence-checked and
 * reported as valueUnreadable (informational) — never a mismatch — unless it
 * is also missing entirely (which the missingInVercel check already caught).
 * A non-empty pulled value that differs from .env.local is REAL drift:
 * valueMismatch carries LENGTHS only (never the values), so e.g.
 * REPORT_OWNER_ID local=28 vercel=9 is diagnosable without leaking the secret.
 *
 * Keys in SYSTEM_INJECTED_VARS are exempt entirely: Vercel injects them per
 * build (OIDC token, deploy URL, git metadata) and their values rotate every
 * commit/deploy, so comparing them would false-alarm on an untrimmed pull
 * file. They are surfaced in systemInjected (lengths only, informational) and
 * never count toward failure.
 */
export function diffEnvMaps(local, vercel) {
  const missingInVercel = [];
  const valueMismatch = [];
  const valueUnreadable = [];
  const systemInjected = [];
  for (const [key, localValue] of local) {
    if (SYSTEM_INJECTED_VARS.has(key)) {
      const vercelValue = vercel.has(key) ? vercel.get(key) : '';
      systemInjected.push({ key, localLen: localValue.length, vercelLen: vercelValue.length });
      continue;
    }
    if (!vercel.has(key)) {
      missingInVercel.push(key);
      continue;
    }
    const vercelValue = vercel.get(key);
    if (vercelValue === '') {
      // Write-only sensitive var (Vercel cannot echo it back) — presence is
      // verified, the value is proven behaviorally by other gates. Never a
      // mismatch: an empty pull means "not readable", not "drifted".
      valueUnreadable.push({ key, reason: 'present in Vercel prod; value is write-only (sensitive) and cannot be echoed back' });
      continue;
    }
    if (vercelValue !== localValue) {
      valueMismatch.push({ key, localLen: localValue.length, vercelLen: vercelValue.length });
    }
  }
  const extraInVercel = [...vercel.keys()].filter((k) => !local.has(k)).sort();
  return {
    missingInVercel: missingInVercel.sort(),
    valueMismatch: valueMismatch.sort((a, b) => a.key.localeCompare(b.key)),
    valueUnreadable: valueUnreadable.sort((a, b) => a.key.localeCompare(b.key)),
    systemInjected: systemInjected.sort((a, b) => a.key.localeCompare(b.key)),
    extraInVercel,
  };
}

/**
 * Vercel system-injected build vars — injected by Vercel at build/runtime, NOT
 * project-managed. `vercel env pull` writes them alongside the real project
 * env, so an untrimmed pull file saved as .env.local carries them with values
 * that ROTATE every deploy/commit (OIDC token, deploy URL, git metadata).
 * diffEnvMaps exempts them from comparison and surfaces them informationally.
 *
 * Keep this set EXACT: exempting a real project var (e.g. VERCEL_TOKEN or
 * VERCEL_TEAM_ID, which are deliberately set in all three stores) would
 * silently stop comparing it; missing a rotating system var would resurrect
 * the false drift this gate exists to absorb.
 */
export const SYSTEM_INJECTED_VARS = new Set([
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
  'VERCEL_GIT_COMMIT_AUTHOR_NAME',
  'VERCEL_GIT_COMMIT_MESSAGE',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_PREVIOUS_SHA',
  'VERCEL_GIT_PROVIDER',
  'VERCEL_GIT_PULL_REQUEST_ID',
  'VERCEL_GIT_REPO_ID',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'VERCEL_OIDC_TOKEN',
  'VERCEL_TARGET_ENV',
  'VERCEL_URL',
]);

/**
 * Parse `gh secret list` output into a sorted array of secret names.
 * The table header ("NAME  UPDATED  VISIBILITY") is skipped; the first
 * whitespace-delimited column is the name.
 */
export function parseGhSecretList(text) {
  const names = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('NAME')) continue;
    const name = line.split(/\s+/)[0];
    if (name) names.push(name);
  }
  return [...new Set(names)].sort();
}

/**
 * Classify GitHub secrets against the local and Vercel stores:
 *   { ciOnly: string[], shared: string[], localOnly: string[], vercelOnly: string[] }
 * ciOnly   — GitHub only (expected CI-only; NOT drift).
 * shared   — present in GitHub AND at least one other store (normal).
 * localOnly — in GitHub + .env.local but MISSING in Vercel (drift: prod is
 *             the runtime that needs it).
 * vercelOnly — in GitHub + Vercel but not .env.local (informational; prod-only
 *              runtime vars are legitimate).
 */
// ── Expected deployed build-time flags ──────────────────────────────────────
// NEXT_PUBLIC_* feature toggles are inlined from the env of the build Vercel
// runs; they gate whether a live feed renders (vs demo data) or the AI
// briefing auto-fires. A MISSING deployed copy silently hides the feature
// while the server API still works — the exact NEXT_PUBLIC_LIVE_DEPLOYMENTS
// incident. The diffEnvMaps drift above only catches flags present in
// .env.local, so a flag absent from BOTH stores would pass. This set makes
// each feature toggle a hard requirement of the DEPLOYED store: it must exist
// with its enabled value ('1'), independent of .env.local. Add a new
// NEXT_PUBLIC_LIVE_* / NEXT_PUBLIC_ENABLE_* feature toggle here when one is
// introduced.
export const EXPECTED_LIVE_FLAGS = {
  NEXT_PUBLIC_LIVE_REPOS: '1',
  NEXT_PUBLIC_LIVE_DEPLOYMENTS: '1',
  NEXT_PUBLIC_ENABLE_AI_BRIEFINGS: '1',
};

/**
 * Check the deployed (Vercel prod) env map against the expected LIVE_* flags.
 * Returns the flags that are missing or carry a non-enabled value:
 *   [{ key, status: 'missing' | 'disabled' }]
 * A MISSING key (absent from the deployed store entirely) is the hidden-feed
 * bug. A key present with a READABLE non-enabled value ('0') is 'disabled' —
 * the same demo-mode bug. A key present but pulled EMPTY is a write-only
 * `sensitive` var (Vercel cannot echo it back; NEXT_PUBLIC vars may be stored
 * sensitive even though they are inlined at build time): presence is verified
 * and the value is proven by the deployed build, so it SATISFIES the expected
 * set — the same presence-check philosophy the .env.local diff uses.
 */
export function missingExpectedFlags(expected, vercel) {
  const out = [];
  for (const [key, wanted] of Object.entries(expected ?? {})) {
    const got = vercel?.get(key);
    if (got === undefined) out.push({ key, status: 'missing' });
    else if (got !== '' && got !== wanted) out.push({ key, status: 'disabled' });
  }
  return out;
}

export function classifyGithubSecrets(ghNames, local, vercel) {
  const ciOnly = [];
  const shared = [];
  const localOnly = [];
  const vercelOnly = [];
  for (const name of ghNames) {
    const inLocal = local.has(name);
    const inVercel = vercel.has(name);
    if (inLocal && inVercel) shared.push(name);
    else if (inLocal && !inVercel) localOnly.push(name);
    else if (!inLocal && inVercel) vercelOnly.push(name);
    else ciOnly.push(name);
  }
  return {
    ciOnly: ciOnly.sort(),
    shared: shared.sort(),
    localOnly: localOnly.sort(),
    vercelOnly: vercelOnly.sort(),
  };
}

// ── CLI plumbing ────────────────────────────────────────────────────────────

/** Resolve the vercel CLI binary: `vercel`, else `npx --yes vercel`. */
function vercelCmd() {
  try {
    execFileSync('vercel', ['--version'], { stdio: 'ignore' });
    return ['vercel'];
  } catch {
    return ['npx', '--yes', 'vercel'];
  }
}

/**
 * Pull the production env to a temp file via the CLI (the REST API exposes key
 * names only — decrypted values require env pull). Returns the temp file path.
 * Throws on failure, classifying an invalidToken:true response as the shared
 * InvalidTokenError contract (callers exit 2).
 */
function pullVercelProdEnv(token) {
  const tmp = join(tmpdir(), `verify-vercel-env-${process.pid}-${Date.now()}.env`);
  try {
    execFileSync(...vercelCmd(), ['env', 'pull', tmp, '--environment=production', '--yes'], {
      encoding: 'utf8',
      env: { ...process.env, VERCEL_TOKEN: token },
      timeout: 90_000,
    });
  } catch (err) {
    rmSync(tmp, { force: true });
    const stderr = String(err?.stderr ?? '');
    if (isInvalidToken({ error: { message: stderr }, message: stderr })) {
      const e = new Error(INVALID_TOKEN_MESSAGE);
      e.name = 'InvalidTokenError';
      throw e;
    }
    const hint = /command not found|not recognized/.test(stderr)
      ? ' (is the Vercel CLI installed? install with `npm i -g vercel`)'
      : '';
    throw new Error(`vercel env pull failed${hint}: ${stderr.slice(0, 300)}`);
  }
  return tmp;
}

async function main() {
  const token = readToken();
  if (!token) {
    console.error('✗ FAIL: no VERCEL_TOKEN (set VERCEL_TOKEN, add it to .env.local, or run vercel login)');
    process.exit(1);
  }

  if (!existsSync(join(process.cwd(), '.env.local'))) {
    console.error('✗ FAIL: .env.local is missing — there is nothing to compare against.');
    process.exit(1);
  }
  const local = parseEnvFile(readFileSync(join(process.cwd(), '.env.local'), 'utf8'));
  if (local.size === 0) {
    console.error('✗ FAIL: .env.local has no parseable keys.');
    process.exit(1);
  }

  // Pull the production env (decrypted values to a temp file).
  let tmp = null;
  let vercel;
  try {
    tmp = pullVercelProdEnv(token);
    vercel = parseEnvFile(readFileSync(tmp, 'utf8'));
  } catch (err) {
    if (err.name === 'InvalidTokenError') {
      console.error(`✗ FAIL: ${err.message}`);
      process.exit(2);
    }
    console.error(`✗ FAIL: ${err.message}`);
    process.exit(1);
  } finally {
    if (tmp) rmSync(tmp, { force: true });
  }

  const drift = diffEnvMaps(local, vercel);
  const expectedMissing = missingExpectedFlags(EXPECTED_LIVE_FLAGS, vercel);

  // ── Render the report (names + lengths only — never values) ──────────────
  console.log('\nVercel production env vs .env.local');
  console.log(`  .env.local keys     ${local.size}`);
  console.log(`  Vercel prod keys    ${vercel.size}`);

  if (drift.missingInVercel.length > 0) {
    console.error('  ✗ MISSING in Vercel production (present in .env.local):');
    for (const key of drift.missingInVercel) console.error(`      - ${key}`);
  }
  if (drift.valueMismatch.length > 0) {
    console.error('  ✗ VALUE DRIFT (same key, different value — lengths only):');
    for (const { key, localLen, vercelLen } of drift.valueMismatch) {
      console.error(`      - ${key}  (local len ${localLen} vs vercel len ${vercelLen})`);
    }
  }
  if (drift.valueUnreadable.length > 0) {
    console.log('  · present but write-only (sensitive vars cannot be echoed back — presence verified, value proven behaviorally):');
    for (const { key } of drift.valueUnreadable) console.log(`      - ${key}`);
  }
  if (drift.systemInjected.length > 0) {
    console.log('  · system-injected build vars (injected by Vercel per build — rotating values, comparison skipped):');
    for (const { key, localLen, vercelLen } of drift.systemInjected) {
      console.log(`      - ${key}  (local len ${localLen} vs vercel len ${vercelLen})`);
    }
  }
  if (drift.extraInVercel.length > 0) {
    console.log('  · in Vercel only (prod-only runtime vars are legitimate — informational):');
    for (const key of drift.extraInVercel) console.log(`      - ${key}`);
  }
  if (expectedMissing.length > 0) {
    console.error('  ✗ MISSING or DISABLED in Vercel production (expected deployed build-time flags):');
    for (const { key, status } of expectedMissing) {
      console.error(`      - ${key} (${status}) — set ${key}=1 in Vercel production env and redeploy`);
    }
  } else {
    console.log('  ✓ every expected NEXT_PUBLIC_* feature toggle (LIVE feeds + AI briefings) is present in Vercel production (sensitive vars presence-checked)');
  }
  if (drift.missingInVercel.length === 0 && drift.valueMismatch.length === 0) {
    console.log(`  ✓ every .env.local key exists in Vercel production (readable values identical; sensitive vars presence-checked)`);
  }

  // ── GitHub secrets classification (skip-not-fail when gh is unavailable) ──
  let ghNames = [];
  try {
    ghNames = parseGhSecretList(execFileSync('gh', ['secret', 'list'], { encoding: 'utf8', timeout: 30_000 }));
  } catch (err) {
    const stderr = String(err?.stderr ?? '');
    if (!/gh: not found|command not found|not recognized/.test(stderr) && ghNames.length === 0) {
      console.log('\n  · GitHub classification skipped: `gh` is not authenticated (run gh auth login)');
    }
  }
  if (ghNames.length > 0) {
    const cls = classifyGithubSecrets(ghNames, local, vercel);
    console.log('\nGitHub secrets (CI store)');
    console.log(`  · CI-only (expected — not in .env.local or Vercel): ${cls.ciOnly.join(', ') || '—'}`);
    console.log(`  · shared across stores: ${cls.shared.join(', ') || '—'}`);
    console.log(`  · in Vercel only: ${cls.vercelOnly.join(', ') || '—'}`);
    if (cls.localOnly.length > 0) {
      console.error('  ✗ DRIFT — in GitHub + .env.local but MISSING in Vercel production:');
      for (const name of cls.localOnly) console.error(`      - ${name}`);
    }
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const failures = drift.missingInVercel.length + drift.valueMismatch.length + expectedMissing.length;
  if (failures > 0) {
    console.error(`\nRESULT: FAIL (${failures} drift item(s))`);
    console.error('Sync .env.local → Vercel production (npm-style: `vercel env add <KEY> production` per key), then redeploy.');
    process.exit(1);
  }
  console.log('\nRESULT: PASS');
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ FAIL: ${err.message}`);
    process.exit(1);
  });
}
