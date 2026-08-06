#!/usr/bin/env node
// ============================================================================
// scripts/seed-winner-candidates.mjs — seed a rule-10 fixture into Firestore.
//
// The weekly cron email renders an AI winner-recommendation section only when
// live data has a project with multiple active versions, no winner selected,
// and at least one evaluation (automation rule 10). This script upserts exactly
// that fixture — one project, two versions, two evaluations — into Firestore,
// the app's single data store, then you can trigger the weekly cron and watch
// the section render via ?previewBody=1.
//
// Docs are written in the SAME camelCase shape the client FirestoreService
// (lib/firestore.ts) stores — the doc id IS the entity id, and the automation
// cron reads them back with lib/server/firestoreAdmin.ts — so the fixture can
// never drift from what the app reads.
//
// Usage:
//   node scripts/seed-winner-candidates.mjs [--owner demo-user] [--clear] [--list]
//
// Every doc is written with `userId = --owner` (default 'demo-user'), so the
// fixture is scoped to a dedicated owner id and can never pollute a real
// account's data. ALWAYS run against a throwaway owner: keep the default, or
// pass --owner demo-user explicitly. The cron reads scoped by REPORT_OWNER_ID,
// so set that env var on Vercel to the SAME owner id to make the weekly email
// see the fixture; leave REPORT_OWNER_ID unset (default demo-user) otherwise.
//
// --list (read-only safety mode): prints which owner (userId) currently owns
// each fixture doc, without touching anything. Run it BEFORE --clear (or a
// reseed) to confirm no fixture doc is owned by a real account — if a doc's
// userId is not the demo/expected owner, the fixture was seeded into the wrong
// account and --clear would delete real data. Exits nonzero when a non-expected
// owner is found, so the mode can gate automation.
//
// Credentials resolve from FIREBASE_SERVICE_ACCOUNT (JSON string) or
// FIREBASE_SERVICE_ACCOUNT_PATH (file), then .env.local. Project id comes from
// --project, then NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID env,
// then .env.local. The Google OAuth token is minted from the shared
// lib/server/sa-token.mjs module (the same flow firestoreAdmin.ts and
// authorize-domain.mjs use), so the seeder can never drift from the cron.
// Idempotent: fixed doc ids + PATCH upsert, so re-running is safe. --clear
// deletes the fixture first (handy for resetting). Exits nonzero when the
// service account is not configured, so the step can gate a deploy script.
// ============================================================================

import { getProjectId, getServiceAccount, mintServiceAccountToken } from '../lib/server/sa-token.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const OWNER = flag('--owner', 'demo-user'); // matches cron REPORT_OWNER_ID default
const CLEAR = args.includes('--clear');
const LIST = args.includes('--list'); // read-only: print who owns the fixture

// Credential resolution + token mint come from the shared module so this
// seeder can never drift from the cron's lib/server/firestoreAdmin.ts flow.
const SA_RAW = flag('--service-account') ?? getServiceAccount();
const PROJECT = flag('--project') ?? getProjectId();

if (!SA_RAW || !PROJECT) {
  console.error('[seed-winner-candidates] ✗ FIREBASE_SERVICE_ACCOUNT and a project id are required.');
  console.error('  Pass --service-account/--project, set them in the environment, or add');
  console.error('  FIREBASE_SERVICE_ACCOUNT + NEXT_PUBLIC_FIREBASE_PROJECT_ID to .env.local.');
  process.exit(1);
}

let bearer;
try {
  bearer = await mintServiceAccountToken(SA_RAW);
} catch (err) {
  console.error('[seed-winner-candidates] ✗ token mint:', err.message);
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Firestore Value <-> JS conversion (mirrors lib/server/firestoreAdmin.ts).
const decodeValue = (v) => {
  if (v === null || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return ((v.arrayValue?.values) ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue?.fields ?? {});
  return null;
};
const decodeFields = (fields) => {
  const out = {};
  for (const [k, val] of Object.entries(fields)) out[k] = decodeValue(val);
  return out;
};

const encodeValue = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { nullValue: null };
};
const encodeFields = (doc) => {
  const out = {};
  for (const [k, val] of Object.entries(doc)) {
    if (val === undefined) continue;
    out[k] = encodeValue(val);
  }
  return out;
};

const upsert = async (collection, doc) => {
  const { id, ...fields } = doc;
  const res = await fetch(`${BASE}/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ fields: encodeFields(fields) }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`upsert ${collection}/${id} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return id;
};

const del = async (collection, id) => {
  const res = await fetch(`${BASE}/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`delete ${collection}/${id} failed (${res.status}): ${body.slice(0, 300)}`);
  }
};

/** Read one doc by id (GET). Returns null on 404; throws on other failures. */
const get = async (collection, id) => {
  const res = await fetch(`${BASE}/${collection}/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${bearer}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`get ${collection}/${id} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return { id, ...decodeFields(json.fields ?? {}) };
};

const ts = () => new Date().toISOString();

// ─── Fixed ids → idempotent upsert ──────────────────────────────────────────
const PROJECT_ID = 'p-winner-demo';
const VERSION_A = 'v-winner-gemini';
const VERSION_B = 'v-winner-codex';
const EVAL_A = 'e-winner-gemini';
const EVAL_B = 'e-winner-codex';

const project = {
  id: PROJECT_ID,
  userId: OWNER,
  name: 'Winner Demo Project',
  slug: 'winner-demo-project',
  description: 'Seeded by scripts/seed-winner-candidates.mjs to exercise the weekly AI winner-recommendation section.',
  category: 'app',
  businessGoal: '',
  targetCustomer: '',
  monetizationModel: '',
  priority: 'P1_HIGH',
  overallStatus: 'BUILDING',
  overallProgress: 68,
  winningVersionId: undefined, // no winner → rule 10
  currentVersionId: VERSION_A,
  nextAction: 'Pick a winner from the comparison.',
  nextActionDueDate: undefined,
  blocker: undefined,
  notes: undefined,
  winnerRecommendation: undefined,
  winnerRecommendationModel: undefined,
  archived: false,
  createdAt: ts(),
  updatedAt: ts(),
  lastActivityAt: ts(),
};

const version = (id, name, builder, model, progress) => ({
  id,
  projectId: PROJECT_ID,
  userId: OWNER,
  versionName: name,
  builder,
  model,
  modelVersion: undefined,
  developmentPlatform: 'web',
  status: 'TESTING',
  progress,
  localFolderPath: undefined,
  repositoryId: undefined,
  deploymentIds: [],
  primaryDeploymentId: undefined,
  branch: 'main',
  currentMilestoneId: undefined,
  nextTaskId: undefined,
  blocker: undefined,
  lastCommitAt: undefined,
  lastDeploymentAt: undefined,
  lastActivityAt: ts(),
  estimatedCost: 0,
  actualCost: 0,
  developmentHours: 0,
  isWinner: false,
  isArchived: false,
  notes: undefined,
  createdAt: ts(),
  updatedAt: ts(),
});

// Scores mirror the ModelComparisonPage columns and the route.test.ts fixture
// (Gemini 8.2 overall > Codex 7.1) so the AI recommendation has a clear pick.
const evaluation = (id, versionId, builder, model, overall, scores) => ({
  id,
  userId: OWNER,
  projectId: PROJECT_ID,
  projectVersionId: versionId,
  builder,
  model,
  uiScore: scores.ui,
  featureScore: scores.features,
  codeQualityScore: scores.code,
  stabilityScore: scores.stability,
  performanceScore: scores.performance,
  maintainabilityScore: scores.maint,
  mobileScore: scores.mobile,
  accessibilityScore: scores.a11y,
  developmentSpeedScore: scores.speed,
  costScore: scores.cost,
  overallScore: overall,
  evaluatorNotes: undefined,
  evaluatedAt: ts(),
  createdAt: ts(),
  updatedAt: ts(),
});

const FIXTURE_DOCS = [
  ['projects', PROJECT_ID],
  ['project_versions', VERSION_A],
  ['project_versions', VERSION_B],
  ['model_evaluations', EVAL_A],
  ['model_evaluations', EVAL_B],
];

/** --list: print who owns each fixture doc; never writes. */
const listMode = async () => {
  console.log(`[seed-winner-candidates] --list: reading fixture docs (project ${PROJECT})…`);
  let suspicious = 0;
  let found = 0;
  for (const [collection, id] of FIXTURE_DOCS) {
    const doc = await get(collection, id);
    if (!doc) {
      console.log(`  - ${collection}/${id}: MISSING`);
      continue;
    }
    found += 1;
    const owner = String(doc.userId ?? '(none)');
    const expected = owner === OWNER || owner === 'demo-user';
    if (!expected) suspicious += 1;
    console.log(`  - ${collection}/${id}: userId=${owner}${expected ? '' : '  ⚠ NOT the expected/demo owner'}`);
  }
  console.log();
  if (found === 0) {
    console.log('No fixture docs found — clean state, safe to seed.');
    return 0;
  }
  console.log(`${found}/${FIXTURE_DOCS.length} fixture docs present.`);
  if (suspicious > 0) {
    console.error(`✗ ${suspicious} fixture doc(s) are owned by an unexpected account — `
      + 'an accidental real-account seed is possible. Do NOT run --clear until verified.');
    return 1;
  }
  console.log(`All fixture docs are owned by ${OWNER}/demo-user — safe to --clear or reseed.`);
  return 0;
};

const main = async () => {
  if (LIST) {
    process.exit(await listMode());
  }
  if (CLEAR) {
    console.log('[seed-winner-candidates] --clear: deleting existing fixture docs…');
    await Promise.all([
      del('model_evaluations', EVAL_A),
      del('model_evaluations', EVAL_B),
      del('project_versions', VERSION_A),
      del('project_versions', VERSION_B),
      del('projects', PROJECT_ID),
    ]);
    console.log('[seed-winner-candidates] fixture cleared.');
  }

  console.log(`[seed-winner-candidates] upserting fixture into Firestore (project ${PROJECT}) for owner "${OWNER}"…`);
  await upsert('projects', project);
  await upsert('project_versions', version(VERSION_A, 'Gemini Build', 'Google AI Studio', 'Gemini 1.5 Pro', 70));
  await upsert('project_versions', version(VERSION_B, 'Codex Build', 'Codex', 'openai/gpt-4.1', 65));
  await upsert('model_evaluations', evaluation(
    EVAL_A, VERSION_A, 'Google AI Studio', 'Gemini 1.5 Pro', 8.2,
    { ui: 8, features: 9, code: 8, stability: 8, performance: 8, maint: 8, mobile: 7, a11y: 8, speed: 8, cost: 8 },
  ));
  await upsert('model_evaluations', evaluation(
    EVAL_B, VERSION_B, 'Codex', 'openai/gpt-4.1', 7.1,
    { ui: 7, features: 7, code: 7, stability: 7, performance: 7, maint: 7, mobile: 6, a11y: 7, speed: 7, cost: 7 },
  ));

  console.log('[seed-winner-candidates] ✓ fixture ready:');
  console.log(`  project  : ${PROJECT_ID} (Winner Demo Project, no winner)`);
  console.log(`  versions : ${VERSION_A} (Gemini Build 8.2) · ${VERSION_B} (Codex Build 7.1)`);
  console.log(`  evals    : ${EVAL_A}, ${EVAL_B}`);
  console.log();
  console.log('Next: trigger the weekly cron with the CRON_SECRET bearer, e.g.');
  console.log('  curl -H "Authorization: Bearer $CRON_SECRET" \\\\');
  console.log("    'https://portfolio-app-freebuff.vercel.app/api/cron/reports?kind=weekly&previewBody=1'");
  console.log('  → reports[0].body should contain "## 🏆 AI winner recommendations (DeepSeek Chat)".');
  console.log();
  console.log('Note: FIREBASE_SERVICE_ACCOUNT must also be set on Vercel (and the app');
  console.log('redeployed) or the deployed cron will not see these docs. Set REPORT_OWNER_ID');
  console.log('to the same owner id you passed --owner so the cron scopes to this fixture.');
  console.log('Safety: run with --list before --clear to confirm no fixture doc is owned');
  console.log('by a real account.');
};

main().catch((err) => {
  console.error('[seed-winner-candidates] ✗', err.message);
  process.exit(1);
});
