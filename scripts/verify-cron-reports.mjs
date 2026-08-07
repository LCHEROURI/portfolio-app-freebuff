#!/usr/bin/env node
// ============================================================================
// scripts/verify-cron-reports.mjs — deployed cron report-body smoke test.
//
// Verifies the LIVE /api/cron/reports endpoint end to end without opening an
// inbox, using the dev-only ?previewBody=1 flag (which still requires the
// CRON_SECRET bearer). Asserts:
//   1. Unauthenticated calls get 401.
//   2. The weekly report body carries the friendly executive-summary heading
//      (model label, not raw id) AND the raw-id footer line.
//   3. The daily report body carries the top-three narration heading with the
//      friendly label, the raw-id footer, and the structured narration field.
//   4. No report in either response carries an `email` envelope (the
//      emailed-report feature is gone — a silent re-introduction fails CI just
//      like the unit tests in app/api/cron/reports/route.test.ts).
//
// Usage:
//   node scripts/verify-cron-reports.mjs [--base https://...] [--secret <CRON_SECRET>] [--owner <uid>]
//
// Reads CRON_SECRET from --secret, then CRON_SECRET env, then .env.local.
// Exits nonzero on any failed assertion so CI can gate on it.
//
// --owner <uid>: owner-scoped strict mode. The deployed cron reads the owner
// from its own REPORT_OWNER_ID env var, so this flag only ASSERTS (it cannot
// change server behavior). When passed:
//   1. Fails if the response's ownerId does not match (the deployed
//      REPORT_OWNER_ID is unset/wrong — a Vercel env drift that would silently
//      scope the email to demo-user and hide the fixture).
//   2. Requires the weekly winner-recommendation section to render — the live
//      proof that FIREBASE_SERVICE_ACCOUNT + the seeded fixture work end to
//      end. Without --owner the section stays optional (graceful path), so
//      the default check keeps passing on unseeded setups.
// ============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = (flag('--base', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
const SECRET =
  flag('--secret') ??
  process.env.CRON_SECRET ??
  (() => {
    try {
      const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
      const m = env.match(/^CRON_SECRET=(.*)$/m);
      return m ? m[1].trim().replace(/^"|"$/g, '') : '';
    } catch {
      return '';
    }
  })();

const OWNER = flag('--owner');

let failures = 0;
// Per-section failure counts so the end-of-run VERIFY-SUBRESULT markers (which
// verify-all.mjs renders as indented sub-rows in the summary table) reflect
// each sub-check independently instead of one global pass/fail. Early-exit
// failures (401 gate, missing secret) exit before the markers, so their gate
// row alone tells the story.
const sectionFails = {};
const fail = (msg, section) => {
  failures += 1;
  if (section) sectionFails[section] = (sectionFails[section] ?? 0) + 1;
  console.error(`  ✗ FAIL: ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

const getJson = async (path, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers, cache: 'no-store' });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON (e.g. HTML error page) → keep null
  }
  return { status: res.status, json };
};

// 1. Auth gate.
console.log(`\n[1/5] Auth gate at ${BASE}`);
const anon = await getJson('/api/cron/reports?kind=daily');
if (anon.status !== 401) fail(`expected 401 without auth, got ${anon.status}`, 'auth-gate');
else ok('unauthenticated request rejected with 401');

if (!SECRET) {
  fail('no CRON_SECRET available (pass --secret, set CRON_SECRET env, or .env.local)', 'auth-gate');
  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
const auth = { authorization: `Bearer ${SECRET}` };

// 1b. Secret-drift guard: an authenticated call that returns 401 means the
//     deployed CRON_SECRET no longer matches the value we resolved (from
//     --secret / env / .env.local). Surface that as a clear, actionable failure
//     instead of the confusing cascade of missing-body failures that follows.
console.log('\n[2/5] Secret drift guard (authenticated probe)');
const probe = await getJson('/api/cron/reports?kind=weekly', auth);
if (probe.status === 401) {
  fail('deployed CRON_SECRET differs from the value provided (401 on an authenticated call). '
    + 'Run the rotation steps in README to resync .env.local, Vercel, and the GitHub Actions secret together.', 'secret-drift');
} else if (probe.status === 200) {
  ok('authenticated probe accepted — no secret drift');
} else {
  fail(`authenticated probe returned unexpected status ${probe.status}`, 'secret-drift');
}

// 3. Weekly report body: friendly heading + raw footer + winner recommendation.
console.log('\n[3/5] Weekly report body (?kind=weekly&previewBody=1)');
const weekly = await getJson('/api/cron/reports?kind=weekly&previewBody=1', auth);
const weeklyReport = weekly.json?.reports?.find((r) => r.kind === 'weekly');
const weeklyBody = weeklyReport?.body ?? '';
// Owner-scoped strict mode: the deployed cron reads REPORT_OWNER_ID server-side,
// so when --owner is passed the response's ownerId must match it — anything else
// means the Vercel env never got the real uid and the report is scoped to the
// wrong account (or demo-user).
if (OWNER) {
  if (!weekly.json?.ownerId) {
    fail(`response missing ownerId — cannot verify --owner ${OWNER}`, 'weekly-body');
  } else if (weekly.json.ownerId !== OWNER) {
    fail(`deployed REPORT_OWNER_ID is "${weekly.json.ownerId}" but --owner expects "${OWNER}". Set REPORT_OWNER_ID=${OWNER} on Vercel and redeploy.`, 'weekly-body');
  } else {
    ok(`deployed REPORT_OWNER_ID matches --owner (${OWNER})`);
  }
}
if (!weeklyBody) fail('weekly body missing from response', 'weekly-body');
if (!weeklyBody.includes('## ✨ AI executive summary (DeepSeek Chat)'))
  fail('weekly body missing friendly heading "(DeepSeek Chat)"', 'weekly-body');
if (!weeklyBody.includes('Model: `deepseek/deepseek-chat`'))
  fail('weekly body missing raw-id footer "Model: `deepseek/deepseek-chat`"', 'weekly-body');
if (!weeklyBody.includes('# Weekly Command Center Report'))
  fail('weekly body missing report title', 'weekly-body');
// Weekly winner recommendation (rule 10) — data-dependent like the daily
// narration: when live data has projects with multiple versions + evaluations
// but no winner, the AI section must carry the friendly model label in its
// heading and never print the raw id inline; when there are no such projects
// the section is omitted cleanly (the deterministic body still ships). In
// --owner strict mode the section is REQUIRED: the fixture is seeded under
// that owner, so its absence means the SA wiring or the seed itself failed.
const weeklyRecs = weeklyReport?.winnerRecommendations;
const ownerScoped = OWNER && weekly.json?.ownerId === OWNER;
if (weeklyRecs && weeklyRecs.length > 0) {
  if (!weeklyBody.includes('## 🏆 AI winner recommendations (DeepSeek Chat)'))
    fail('weekly winner section missing friendly heading "(DeepSeek Chat)"', 'weekly-body');
  if (weeklyBody.includes('AI winner recommendations (deepseek/deepseek-chat)'))
    fail('weekly winner heading prints the raw model id inline', 'weekly-body');
  if (weeklyRecs.some((r) => !r.projectName || !r.versionName || !r.note))
    fail('weekly winner section has an incomplete structured entry', 'weekly-body');
  ok(`weekly winner-recommendation section present with friendly label (${weeklyRecs.length} project(s))`);
} else if (ownerScoped) {
  fail(`--owner ${OWNER}: no winner recommendations returned — the fixture should exist under this owner. `
    + `Run npm run seed:winner-candidates --owner ${OWNER} (with FIREBASE_SERVICE_ACCOUNT set on Vercel and the app redeployed).`, 'weekly-body');
} else {
  ok('no rule-10 winner candidates in live data — winner recommendation gracefully omitted');
}
if (!failures) {
  ok(`weekly body carries friendly heading + raw footer (${weeklyBody.length} chars)`);
  if (weeklyReport?.aiModel) ok(`weekly aiModel=${weeklyReport.aiModel}`);
}

// 4. Daily report body: narration is data-dependent. When the automation engine
//    has actionable items the narration must carry the friendly heading, the
//    DeepSeek Chat label, and the raw-id footer; when the queue is empty the
//    graceful fallback must omit the narration cleanly while the executive
//    summary and raw footer still ship. This keeps the check green on quiet
//    days without letting regressions sneak through.
console.log('\n[4/5] Daily report body (?kind=daily&previewBody=1)');
const daily = await getJson('/api/cron/reports?kind=daily&previewBody=1', auth);
const dailyReport = daily.json?.reports?.find((r) => r.kind === 'daily');
const dailyBody = dailyReport?.body ?? '';
if (!dailyBody) fail('daily body missing from response', 'daily-body');
if (!dailyBody.includes('## ✨ AI executive summary (DeepSeek Chat)'))
  fail('daily body missing executive-summary friendly heading', 'daily-body');
if (!dailyBody.includes('Model: `deepseek/deepseek-chat`'))
  fail('daily body missing raw-id footer', 'daily-body');
const narration = dailyReport?.narration;
if (narration) {
  if (!dailyBody.includes('## 🎯 Why these three matter today (DeepSeek Chat)'))
    fail('daily body missing narration heading "(DeepSeek Chat)"', 'daily-body');
  if (!narration.paragraph) fail('daily structured narration.paragraph missing', 'daily-body');
  if (narration.model !== 'deepseek/deepseek-chat') fail('daily narration.model mismatch', 'daily-body');
} else {
  // Graceful fallback: no actionable top three → narration section must be absent.
  if (dailyBody.includes('Why these three matter today'))
    fail('narration is null but the body still contains a narration section', 'daily-body');
  ok('no actionable top three in live data — narration correctly fell back (graceful path)');
}
if (!failures && narration) {
  ok(`daily body carries narration heading + label + raw footer (${dailyBody.length} chars)`);
  ok(`daily narration.model=${narration.model}, projectIds=${JSON.stringify(narration.projectIds ?? [])}`);
}

// 5. Email-envelope sweep: the emailed-report feature was removed, so NO
//    report may carry an `email` envelope ({ sent, emailId, reason }) and the
//    responses themselves must not have a top-level email field either. This
//    mirrors the unit tests (route.test.ts asserts not.toHaveProperty('email'))
//    against the deployed build, so a future re-introduction fails CI before
//    it can ship.
console.log('\n[5/5] Email-envelope sweep (no report may carry an email envelope)');
let envelopeHits = 0;
const sweepReports = (reports, label) => {
  for (const r of reports ?? []) {
    if (r && typeof r === 'object' && 'email' in r) {
      envelopeHits += 1;
      fail(`${label} report "${r.kind ?? '?'}" still carries an email envelope: ${JSON.stringify(r.email)}`);
    }
  }
};
for (const [label, resp] of [['weekly', weekly.json], ['daily', daily.json]]) {
  sweepReports(resp?.reports, label);
  if (resp && 'email' in resp) {
    envelopeHits += 1;
    fail(`${label} response carries a top-level email envelope: ${JSON.stringify(resp.email)}`);
  }
}
if (envelopeHits === 0) ok('no report in the weekly or daily response carries an email envelope');
// Machine-readable markers for verify:all: each sub-check result becomes its
// own row in the runner's summary table, so every cron sub-contract (401 gate,
// secret drift, weekly body, daily body, no-email envelope) is visible at a
// glance without reading the full stdout. verify-all.mjs scans for
// `VERIFY-SUBRESULT|<name>|<PASS|FAIL>` on its piped stdout.
console.log(`VERIFY-SUBRESULT|auth-gate|${(sectionFails['auth-gate'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|secret-drift|${(sectionFails['secret-drift'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|weekly-body|${(sectionFails['weekly-body'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|daily-body|${(sectionFails['daily-body'] ?? 0) === 0 ? 'PASS' : 'FAIL'}`);
console.log(`VERIFY-SUBRESULT|email-envelope-sweep|${envelopeHits === 0 ? 'PASS' : 'FAIL'}`);

console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
