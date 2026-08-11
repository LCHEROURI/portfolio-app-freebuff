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
//   node scripts/verify-deployed-hash.mjs [--url <primary>] --compare-url <url>
//     → alias-routing drift watch: resolves the deployment serving <url>
//       (typically the canonical production alias) and asserts it serves the
//       SAME commit as the primary target — catches the canonical alias
//       pointing at an older/newer deployment than the deployment-specific
//       URL. Exits nonzero on drift; skips (exit 0, notice) if either
//       deployment records no commit sha.
//   node scripts/verify-deployed-hash.mjs --check-local
//     → also compares against `git rev-parse HEAD` (prints a warning, no exit)
//
// Flags COMBINE: --compare-url and --expect (and --check-local) can be given
// together — e.g. the verify:all deployed-hash gate and the CI workflow pass
// both — and the script exits nonzero if ANY requested check fails.
//
// Exports (for the unit test): extractSha, compareDrift, resolveByHost,
// parseArgs, isInvalidToken, INVALID_TOKEN_MESSAGE, InvalidTokenError, and
// readToken — the token-resolution chain shared with
// verify-token-health.mjs so the two scripts can never drift on how the
// credential is resolved (env → .env.local → CLI store).
// Exits nonzero if the token is missing or the target deployment can't be
// resolved; exit code 2 specifically means VERCEL_TOKEN is invalid or revoked
// (Vercel flagged invalidToken:true in the error body) so the pre-push hook
// can skip its transient retry and print the paste-a-fresh-token guidance.
// No source changes; read-only against the Vercel API.
// ============================================================================

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readLocalEnv } from './local-env.mjs';

export const PROJECT = 'portfolio-app-freebuff';
export const PRODUCTION_URL = 'https://portfolio-app-freebuff.vercel.app';

/** The commit sha a Vercel deployment record is serving, if recorded. */
export function extractSha(dep) {
  return dep?.meta?.githubCommitSha ?? dep?.gitSource?.sha ?? '';
}

/**
 * Drift verdict for two deployment shas:
 *   'match' | 'mismatch' | 'unverifiable' (either side missing).
 */
export function compareDrift(a, b) {
  if (!a || !b) return 'unverifiable';
  return a === b ? 'match' : 'mismatch';
}

// ── Token health ─────────────────────────────────────────────────────────────
/**
 * Vercel marks a dead/revoked credential by returning invalidToken: true in
 * the error body (typically a 401 or 403). Detect it so callers can show the
 * targeted 'paste a fresh token' guidance instead of a generic HTTP status
 * message — and so the pre-push hook can skip its pointless 30s retry (waiting
 * cannot revive a revoked token).
 */
export function isInvalidToken(body) {
  return Boolean(body && (body.invalidToken === true || body?.error?.invalidToken === true));
}

/** The targeted failure message for a dead VERCEL_TOKEN (no "✗ FAIL: " prefix). */
export const INVALID_TOKEN_MESSAGE =
  'VERCEL_TOKEN is invalid or revoked — paste a fresh token from https://vercel.com/account/tokens into .env.local';

/** Error used to signal a dead token distinctly from a generic API failure. */
export class InvalidTokenError extends Error {
  constructor() {
    super(INVALID_TOKEN_MESSAGE);
    this.name = 'InvalidTokenError';
  }
}

// ── Token resolution (shared with verify-token-health.mjs) ──────────────────
// The one source of truth for how the Vercel credential is resolved across the
// verify scripts: env var → .env.local → the CLI auth store. verify-token-
// health.mjs imports this exact function rather than copying it, so a change
// to the resolution order or the CLI store path can never desync the two.
export const readToken = () => {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  try {
    const token = readLocalEnv('VERCEL_TOKEN');
    if (token) return token;
  } catch { /* no .env.local */ }
  try {
    const auth = readFileSync(resolve(homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8');
    const parsed = JSON.parse(auth);
    if (parsed.token) return parsed.token;
  } catch { /* no CLI store */ }
  return null;
};

/**
 * Parse CLI flags into a plain object. Each raw arg is trimmed first: a
 * GitHub Actions plain-scalar `run: cmd \` block folds the trailing
 * backslash-newline into a literal backslash-space, so `--url "…"` arrives
 * in bash as the single word ` --url` (leading space). Trimming recovers the
 * flag so the script can never silently fall back to the v6 list branch just
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

/**
 * Resolve a deployment by URL host via the v13 single-deployment lookup
 * (accepts the canonical alias OR the deployment-specific subdomain). Shared
 * by the --url and --compare-url modes so host normalization, error handling,
 * and sha/url/created extraction can never drift between them. Throws on a
 * failed lookup so the CLI can exit nonzero with one message shape.
 */
export async function resolveByHost(host, what, token, teamId) {
  // The v13 lookup accepts the canonical alias OR the deployment-specific
  // subdomain, which is globally unique across Vercel — so a deployment can be
  // resolved WITHOUT a team scope. Try the team-scoped lookup first as a precise
  // hint, then fall back to a bare (unscoped) lookup. This keeps the gate robust
  // to a wrong or missing team id (e.g. VERCEL_ORG_ID holding the personal
  // account id instead of the owning team id): the bare fallback still resolves
  // the deployment whenever the token itself can read it.
  const attempts = [
    ...(teamId
      ? [`https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}?teamId=${teamId}`]
      : []),
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(host)}`,
  ];

  let lastErr = null;
  for (const url of attempts) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    if (res.ok) {
      const dep = body ?? {};
      // v13 uses createdAt; v6 uses created. Resolve either.
      const ts = dep?.createdAt ?? dep?.created;
      return {
        sha: extractSha(dep),
        url: dep?.url ?? '',
        created: ts ? new Date(ts).toISOString() : '',
      };
    }
    // A dead/revoked credential is flagged by Vercel as invalidToken:true in
    // the error body — surface the targeted guidance, not a generic status.
    if (isInvalidToken(body)) {
      throw new InvalidTokenError();
    }
    lastErr = new Error(
      `Vercel API returned HTTP ${res.status} for ${what} "${host}". (the deployment record may be purged, the URL may be malformed, or the token lacks access to it)`,
    );
  }
  throw lastErr ?? new Error(`Unable to resolve ${what} "${host}".`);
}

// ── Resolve the team id (the project lives in a team, not personal scope) ───
const resolveTeam = async (token) => {
  if (process.env.VERCEL_TEAM_ID) return process.env.VERCEL_TEAM_ID;
  const res = await fetch('https://api.vercel.com/v2/user', {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
  if (res.ok) {
    if (body?.user?.defaultTeamId) return body.user.defaultTeamId;
  } else if (isInvalidToken(body)) {
    throw new InvalidTokenError();
  }
  // A token with no default team can still list its memberships; when the
  // account belongs to exactly one team that is unambiguous, and it lets the
  // v6 list path work without VERCEL_TEAM_ID.
  try {
    const teamsRes = await fetch('https://api.vercel.com/v2/teams', {
      headers: { authorization: `Bearer ${token}` },
    });
    const teamsBody = typeof teamsRes.json === 'function' ? await teamsRes.json().catch(() => null) : null;
    if (teamsRes.ok) {
      const teams = teamsBody?.teams ?? [];
      if (teams.length === 1) return teams[0].id;
    } else if (isInvalidToken(teamsBody)) {
      throw new InvalidTokenError();
    }
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    // ignore — the bare fallback in resolveByHost still covers the --url path
  }
  return null;
};

async function main() {
  const { expect: EXPECT, checkLocal: CHECK_LOCAL, url: URL_TARGET, compareUrl: COMPARE_URL } =
    parseArgs(process.argv.slice(2));
  // The deployment URL to check. When set, the script looks up that exact
  // deployment instead of the latest production one — the CI deployment_status
  // gate passes the event's target_url here.
  // Alias-routing drift watch target: the second URL whose deployment must
  // serve the SAME commit as the primary target (URL_TARGET or the latest
  // production deployment).

  const token = readToken();
  if (!token) {
    console.error('✗ FAIL: no VERCEL_TOKEN (set VERCEL_TOKEN, add it to .env.local, or run vercel login)');
    process.exit(1);
  }

  // A team id is a hint for the v13 lookups (which fall back to an unscoped
  // lookup when the team scope is missing or wrong) but a hard requirement for
  // the v6 project-scoped list below. A dead token surfaces as
  // invalidToken:true from v2/user — fail fast with the targeted guidance.
  let teamId = null;
  try {
    teamId = await resolveTeam(token);
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      console.error(`✗ FAIL: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  // ── Resolve the target deployment ─────────────────────────────────────────
  // With --url: the deployment serving that exact URL. Without it: the latest
  // READY production deployment.
  let deployedSha = '';
  let deployedUrl = '';
  let created = '';
  let label = '';

  if (URL_TARGET) {
    const host = URL_TARGET.replace(/^https?:\/\//, '').replace(/\/$/, '');
    try {
      const dep = await resolveByHost(host, 'deployment URL', token, teamId);
      deployedSha = dep.sha;
      deployedUrl = dep.url;
      created = dep.created;
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        console.error(`✗ FAIL: ${err.message}`);
        process.exit(2);
      }
      console.error(`✗ FAIL: ${err.message}`);
      process.exit(1);
    }
    label = `Deployed URL: ${URL_TARGET}`;
  } else {
    if (!teamId) {
      console.error('✗ FAIL: could not resolve the Vercel team id from the token (needed to list production deployments).');
      process.exit(1);
    }
    // The v6 list endpoint's `project` filter is a PROJECT ID, not a name —
    // passing the name is SILENTLY IGNORED and the API returns the team's
    // latest deployment regardless of project (so this report could show the
    // OTHER app's commit). Resolve the id from the `vercel link` file; the
    // name fallback only applies before the repo is linked (CI never uses
    // this list branch — the post-deploy gates always pass --url).
    let projectId = null;
    try {
      projectId = JSON.parse(readFileSync(resolve(process.cwd(), '.vercel/project.json'), 'utf8'))?.projectId ?? null;
    } catch { /* not linked yet */ }
    const projectFilter = projectId ? `projectId=${encodeURIComponent(projectId)}` : `project=${PROJECT}`;
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?${projectFilter}&teamId=${teamId}&target=production&state=READY&limit=1`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      if (isInvalidToken(body)) {
        console.error(`✗ FAIL: ${INVALID_TOKEN_MESSAGE}`);
        process.exit(2);
      }
      console.error(`✗ FAIL: Vercel API returned HTTP ${res.status}.`);
      process.exit(1);
    }
    const dep = body?.deployments?.[0];
    if (!dep) {
      console.error(`✗ FAIL: no READY production deployment found for ${PROJECT}.`);
      process.exit(1);
    }
    deployedSha = extractSha(dep);
    deployedUrl = dep?.url ?? '';
    created = dep?.created ? new Date(dep.created).toISOString() : '';
    label = `Deployed to production: ${PRODUCTION_URL}`;
  }

  console.log(`\n${label}`);
  console.log(`  commit  ${deployedSha || '(unknown)'}`);
  console.log(`  url     ${deployedUrl}`);
  console.log(`  created ${created}`);
  console.log(`  project ${PROJECT} (team ${teamId ?? 'unscoped'})`);

  let anyFailed = false;
  // Per-section failure counts so the end-of-run VERIFY-SUBRESULT markers
  // (which verify-all.mjs renders as indented sub-rows in the summary table)
  // reflect each conditional check independently. A check that genuinely ran
  // and compared two shas emits a row (FAIL when they diverge); an
  // unverifiable skip (no sha recorded on a side) emits NO row — the parent
  // gate row already carries the skip warning, and claiming PASS would imply
  // a comparison that never happened.
  const sectionFails = {};
  let driftCompared = false;
  let expectCompared = false;
  let checkLocalCompared = false;

  // ── --compare-url <url>: alias-routing drift watch ────────────────────────
  // Resolves the deployment serving <url> and asserts it serves the same
  // commit as the primary target resolved above. Catches alias-routing drift:
  // the deployment-specific URL and the canonical alias pointing at different
  // deployments (e.g. a rollback that updated the alias but not the record, or
  // a redeploy where the alias propagated ahead of the API).
  if (COMPARE_URL) {
    const host = COMPARE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    let other;
    try {
      other = await resolveByHost(host, 'compare URL', token, teamId);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        console.error(`✗ FAIL: ${err.message}`);
        process.exit(2);
      }
      console.error(`✗ FAIL: ${err.message}`);
      process.exit(1);
    }

    console.log(`\nAlias-routing drift watch: ${COMPARE_URL}`);
    console.log(`  compare commit ${other.sha || '(unknown)'}`);
    console.log(`  compare url    ${other.url}`);
    console.log(`  compare created ${other.created}`);

    const verdict = compareDrift(deployedSha, other.sha);
    if (verdict === 'unverifiable') {
      // One side records no commit sha (CLI/prebuilt deploy) — nothing to
      // compare. Skip-not-fail, consistent with the --expect unverifiable path.
      console.log('\n  ⚠ one or both deployments record no commit sha — cannot compare');
      console.log('  → skipping the drift assertion (not a mismatch)');
    } else if (verdict === 'match') {
      driftCompared = true;
      console.log(`\n  ✓ canonical URL and deployment-specific URL serve the same commit (${deployedSha.slice(0, 12)})`);
    } else {
      driftCompared = true;
      console.error(`\n  ✗ ALIAS-ROUTING DRIFT: ${COMPARE_URL} serves ${other.sha} but the primary target serves ${deployedSha}`);
      console.error('  The canonical alias and the deployment-specific URL point at different deployments.');
      sectionFails.drift = (sectionFails.drift ?? 0) + 1;
      anyFailed = true;
    }
  }

  // ── --check-local: compare against the local HEAD ─────────────────────────
  if (CHECK_LOCAL) {
    try {
      const localSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const match = (deployedSha && localSha.startsWith(deployedSha.slice(0, 12)))
        || (deployedSha && deployedSha.startsWith(localSha.slice(0, 12)));
      checkLocalCompared = true;
      // Informational sub-contract: a differ is a visibility FAIL row under a
      // green gate (the parent row still passes — this check only warns, per
      // the gate's documented --check-local contract).
      if (!match) sectionFails.checkLocal = (sectionFails.checkLocal ?? 0) + 1;
      console.log(`\n  local HEAD ${localSha.slice(0, 12)} → ${match ? 'MATCHES deployed' : 'DIFFERS from deployed (push needed?)'}`);
    } catch {
      console.log('\n  (could not read local git HEAD)');
    }
  }

  // ── --expect <sha>: hard assertion for CI / pre-push ──────────────────────
  if (EXPECT) {
    // A deployment with NO recorded commit sha (e.g. a CLI/prebuilt deploy with
    // no git metadata) cannot be drift-checked — there is nothing to compare.
    // Following the repo's skip-not-fail convention for unavailable signals, we
    // report it as unverifiable instead of falsely failing (or falsely passing)
    // an assertion we could not actually run.
    if (!deployedSha) {
      console.log('\n  ⚠ no commit sha recorded for this deployment (CLI/prebuilt deploy without git metadata?)');
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

  // Machine-readable markers for verify:all: only checks that actually RAN and
  // compared two shas emit a sub-row (matching the conditional contract
  // elsewhere) — the alias-drift watch when --compare-url ran, the expect
  // assertion when --expect ran, and the local-HEAD comparison when
  // --check-local ran (the mode verify:all uses by default). Unverifiable
  // skips emit nothing: the gate row carries the skip warning, and a PASS
  // would imply a comparison that never happened.
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
