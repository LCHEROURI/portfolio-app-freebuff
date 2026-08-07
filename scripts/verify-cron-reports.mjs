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
const fail = (msg) => {
  failures += 1;
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
console.log(`\n[1/4] Auth gate at ${BASE}`);
const anon = await getJson('/api/cron/reports?kind=daily');
if (anon.status !== 401) fail(`expected 401 without auth, got ${anon.status}`);
else ok('unauthenticated request rejected with 401');

if (!SECRET) {
  fail('no CRON_SECRET available (pass --secret, set CRON_SECRET env, or .env.local)');
  console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}
const auth = { authorization: `Bearer ${SECRET}` };

// 1b. Secret-drift guard: an authenticated call that returns 401 means the
//     deployed CRON_SECRET no longer matches the value we resolved (from
//     --secret / env / .env.local). Surface that as a clear, actionable failure
//     instead of the confusing cascade of missing-body failures that follows.
console.log('\n[2/4] Secret drift guard (authenticated probe)');
const probe = await getJson('/api/cron/reports?kind=weekly', auth);
if (probe.status === 401) {
  fail('deployed CRON_SECRET differs from the value provided (401 on an authenticated call). '
    + 'Run the rotation steps in README to resync .env.local, Vercel, and the GitHub Actions secret together.');
} else if (probe.status === 200) {
  ok('authenticated probe accepted — no secret drift');
} else {
  fail(`authenticated probe returned unexpected status ${probe.status}`);
}

// 3. Weekly report body: friendly heading + raw footer + winner recommendation.
console.log('\n[3/4] Weekly report body (?kind=weekly&previewBody=1)');
const weekly = await getJson('/api/cron/reports?kind=weekly&previewBody=1', auth);
const weeklyReport = weekly.json?.reports?.find((r) => r.kind === 'weekly');
const weeklyBody = weeklyReport?.body ?? '';
// Owner-scoped strict mode: the deployed cron reads REPORT_OWNER_ID server-side,
// so when --owner is passed the response's ownerId must match it — anything else
// means the Vercel env never got the real uid and the report is scoped to the
// wrong account (or demo-user).
if (OWNER) {
  if (!weekly.json?.ownerId) {
    fail(`response missing ownerId — cannot verify --owner ${OWNER}`);
  } else if (weekly.json.ownerId !== OWNER) {
    fail(`deployed REPORT_OWNER_ID is "${weekly.json.ownerId}" but --owner expects "${OWNER}". Set REPORT_OWNER_ID=${OWNER} on Vercel and redeploy.`);
  } else {
    ok(`deployed REPORT_OWNER_ID matches --owner (${OWNER})`);
  }
}
if (!weeklyBody) fail('weekly body missing from response');
if (!weeklyBody.includes('## ✨ AI executive summary (DeepSeek Chat)'))
  fail('weekly body missing friendly heading "(DeepSeek Chat)"');
if (!weeklyBody.includes('Model: `deepseek/deepseek-chat`'))
  fail('weekly body missing raw-id footer "Model: `deepseek/deepseek-chat`"');
if (!weeklyBody.includes('# Weekly Command Center Report'))
  fail('weekly body missing report title');
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
    fail('weekly winner section missing friendly heading "(DeepSeek Chat)"');
  if (weeklyBody.includes('AI winner recommendations (deepseek/deepseek-chat)'))
    fail('weekly winner heading prints the raw model id inline');
  if (weeklyRecs.some((r) => !r.projectName || !r.versionName || !r.note))
    fail('weekly winner section has an incomplete structured entry');
  ok(`weekly winner-recommendation section present with friendly label (${weeklyRecs.length} project(s))`);
} else if (ownerScoped) {
  fail(`--owner ${OWNER}: no winner recommendations returned — the fixture should exist under this owner. `
    + `Run npm run seed:winner-candidates --owner ${OWNER} (with FIREBASE_SERVICE_ACCOUNT set on Vercel and the app redeployed).`);
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
console.log('\n[4/4] Daily report body (?kind=daily&previewBody=1)');
const daily = await getJson('/api/cron/reports?kind=daily&previewBody=1', auth);
const dailyReport = daily.json?.reports?.find((r) => r.kind === 'daily');
const dailyBody = dailyReport?.body ?? '';
if (!dailyBody) fail('daily body missing from response');
if (!dailyBody.includes('## ✨ AI executive summary (DeepSeek Chat)'))
  fail('daily body missing executive-summary friendly heading');
if (!dailyBody.includes('Model: `deepseek/deepseek-chat`'))
  fail('daily body missing raw-id footer');
const narration = dailyReport?.narration;
if (narration) {
  if (!dailyBody.includes('## 🎯 Why these three matter today (DeepSeek Chat)'))
    fail('daily body missing narration heading "(DeepSeek Chat)"');
  if (!narration.paragraph) fail('daily structured narration.paragraph missing');
  if (narration.model !== 'deepseek/deepseek-chat') fail('daily narration.model mismatch');
} else {
  // Graceful fallback: no actionable top three → narration section must be absent.
  if (dailyBody.includes('Why these three matter today'))
    fail('narration is null but the body still contains a narration section');
  ok('no actionable top three in live data — narration correctly fell back (graceful path)');
}
if (!failures && narration) {
  ok(`daily body carries narration heading + label + raw footer (${dailyBody.length} chars)`);
  ok(`daily narration.model=${narration.model}, projectIds=${JSON.stringify(narration.projectIds ?? [])}`);
}

console.error(`\nRESULT: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
