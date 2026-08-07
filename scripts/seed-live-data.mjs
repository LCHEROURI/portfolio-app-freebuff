#!/usr/bin/env node
// ============================================================================
// scripts/seed-live-data.mjs — seed a full Command Center fixture into Firestore.
//
// The signed-in app reads live rows via FirestoreService.loadAll(userId), which
// lists every collection scoped by `userId`. When a real account has no rows,
// the Command Center metrics read 0. This script upserts a realistic bundle —
// projects, versions, repositories, deployments, tasks, evaluations, activity
// and a profile — under ONE owner id (default: REPORT_OWNER_ID, else demo-user),
// so the signed-in account immediately has data to compute against.
//
// Docs are written in the SAME camelCase shape the client FirestoreService
// (lib/firestore.ts) stores — the doc id IS the entity id, foreign keys are the
// exact entity ids, and every doc carries `userId = --owner`. Deterministic ids
// make re-runs idempotent (PATCH upsert), exactly like seed-winner-candidates.
//
// Usage:
//   node scripts/seed-live-data.mjs [--owner <uid>] [--clear] [--list]
//
//   --owner <uid>  who owns every seeded doc (default: REPORT_OWNER_ID from the
//                  environment or .env.local, else 'demo-user'). Pass your real
//                  Firebase uid to populate the account you sign in with.
//   --list         read-only: print how many docs each collection has for the
//                  owner, without touching anything.
//   --clear        delete every fixture doc owned by the owner first.
//
// Credentials resolve from FIREBASE_SERVICE_ACCOUNT (JSON string) or
// FIREBASE_SERVICE_ACCOUNT_PATH (file), then .env.local. Project id comes from
// --project, then NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID env,
// then .env.local. The Google OAuth token is minted from the shared
// lib/server/sa-token.mjs module (the same flow firestoreAdmin.ts and
// seed-winner-candidates.mjs use), so this seeder can never drift from the cron.
// Exits nonzero when the service account is not configured.
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { getProjectId, getServiceAccount, mintServiceAccountToken } from '../lib/server/sa-token.mjs';

/** Read an env var from process.env, falling back to .env.local for CLI runs. */
export const readEnv = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^"|"$/g, '') : undefined;
  } catch {
    return undefined;
  }
};

// ─── Deterministic fixture (ids are fixed → idempotent upsert) ───────────────
// Shapes mirror lib/seed.ts exactly: a signed-in account with a couple of
// parallel-build projects, tracked repos, a failed prod deploy, overdue + due
// soon tasks, evaluations, a rule-10 winner candidate, and recent activity.
export const buildLiveFixture = (owner) => {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();
  const daysAgo = (d, h = 0) => new Date(now - d * 86_400_000 - h * 3_600_000).toISOString();
  const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();

  const P_WMP = 'p-wmp';          // Weeknight Meal Planner
  const V_WMP_A = 'v-wmp-gemini'; // Gemini build
  const V_WMP_B = 'v-wmp-kimi';   // Kimi K3 build
  const R_WMP = 'r-wmp';
  const D_WMP = 'd-wmp';
  const T_WMP_1 = 't-wmp-1';
  const T_WMP_2 = 't-wmp-2';
  const E_WMP_A = 'e-wmp-gemini';
  const E_WMP_B = 'e-wmp-kimi';

  const P_CHEF = 'p-chef';        // Classic Chef Video Guide
  const V_CHEF = 'v-chef-codex';
  const R_CHEF = 'r-chef';
  const D_CHEF = 'd-chef';
  const T_CHEF = 't-chef-1';
  const E_CHEF = 'e-chef-codex';

  const P_RESTO = 'p-resto';      // Restaurant Social Media Manager (blocked)
  const V_RESTO = 'v-resto-lovable';
  const T_RESTO = 't-resto-1';

  return [
    // ── Weeknight Meal Planner — parallel Gemini + Kimi builds, no winner ──
    { collection: 'projects', id: P_WMP, doc: {
      userId: owner, name: 'Weeknight Meal Planner', slug: 'weeknight-meal-planner',
      description: 'AI meal planner that turns pantry + dietary constraints into a week of dinners.',
      category: 'Cooking / Meal Planning', businessGoal: 'Prove AI meal-planning retention',
      targetCustomer: 'Busy families, dietary-restricted cooks', monetizationModel: 'Freemium',
      priority: 'P0_CRITICAL', overallStatus: 'TESTING', overallProgress: 74,
      currentVersionId: V_WMP_A, nextAction: 'Run A/B retention test on both builds',
      nextActionDueDate: daysAgo(0), blocker: undefined, archived: false,
      createdAt: daysAgo(45), updatedAt: hoursAgo(2), lastActivityAt: hoursAgo(2),
    } },
    { collection: 'project_versions', id: V_WMP_A, doc: {
      userId: owner, projectId: P_WMP, versionName: 'Gemini Build', builder: 'Google AI Studio',
      model: 'Gemini 1.5 Pro', modelVersion: 'gemini-1.5-pro-001', developmentPlatform: 'AI Studio + Firebase',
      status: 'TESTING', progress: 78, localFolderPath: '~/dev/weeknight-planner/gemini',
      repositoryId: R_WMP, deploymentIds: [D_WMP], primaryDeploymentId: D_WMP, branch: 'main',
      lastCommitAt: hoursAgo(2), lastActivityAt: hoursAgo(2), estimatedCost: 220, actualCost: 190,
      developmentHours: 62, isWinner: false, isArchived: false, notes: 'Best recipes quality so far.',
      createdAt: daysAgo(42), updatedAt: hoursAgo(2),
    } },
    { collection: 'project_versions', id: V_WMP_B, doc: {
      userId: owner, projectId: P_WMP, versionName: 'Kimi K3 Build', builder: 'FreeBuff',
      model: 'Kimi K3', developmentPlatform: 'React + Firebase', status: 'TESTING', progress: 71,
      localFolderPath: '~/dev/weeknight-planner/kimi', repositoryId: undefined,
      deploymentIds: [], branch: 'main', lastDeploymentAt: daysAgo(1), lastActivityAt: hoursAgo(5),
      estimatedCost: 180, actualCost: 210, developmentHours: 55, isWinner: false, isArchived: false,
      notes: 'Fast iteration, slightly weaker dietary nuance.', createdAt: daysAgo(40), updatedAt: hoursAgo(5),
    } },
    { collection: 'repositories', id: R_WMP, doc: {
      userId: owner, projectVersionId: V_WMP_A, provider: 'github', owner: 'chef-labs',
      repositoryName: 'weeknight-meal-planner-gemini', repositoryUrl: 'https://github.com/chef-labs/weeknight-meal-planner-gemini',
      defaultBranch: 'main', currentBranch: 'feat/voice-input', private: true,
      lastCommitSha: '4a1e09', lastCommitMessage: 'Wire voice pantry input', lastCommitAt: hoursAgo(2),
      openPullRequests: 2, openIssues: 5, workflowStatus: 'pending', commitsAhead: 7, commitsBehind: 1,
      hasUncommittedChanges: false, hasUnpushedCommits: true, lastScannedAt: minutesAgo(12),
      connectionStatus: 'CONNECTED', createdAt: daysAgo(42), updatedAt: minutesAgo(12),
    } },
    { collection: 'deployments', id: D_WMP, doc: {
      userId: owner, projectVersionId: V_WMP_A, provider: 'firebase', projectName: 'weeknight-planner-gemini',
      environment: 'production', deploymentUrl: 'https://weeknight-planner-gemini.web.app',
      dashboardUrl: 'https://console.firebase.google.com/project/weeknight-planner-gemini/hosting',
      status: 'READY', healthStatus: 'HEALTHY', lastDeploymentAt: daysAgo(1), lastSuccessfulDeploymentAt: daysAgo(1),
      framework: 'React', branch: 'main', responseCode: 200, responseTimeMs: 320,
      lastHealthCheckAt: minutesAgo(20), createdAt: daysAgo(41), updatedAt: minutesAgo(20),
    } },
    { collection: 'tasks', id: T_WMP_1, doc: {
      userId: owner, projectId: P_WMP, projectVersionId: V_WMP_A, title: 'A/B retention test: Gemini vs Kimi',
      status: 'NEXT', priority: 'P0_CRITICAL', taskType: 'EVALUATION', dueDate: daysAgo(1),
      estimatedMinutes: 240, position: 0, createdAt: daysAgo(8), updatedAt: daysAgo(2),
    } },
    { collection: 'tasks', id: T_WMP_2, doc: {
      userId: owner, projectId: P_WMP, projectVersionId: V_WMP_B, title: 'Fix intermittent 503 on plan endpoint',
      status: 'IN_PROGRESS', priority: 'P0_CRITICAL', taskType: 'BUG', dueDate: new Date(now + 2 * 3_600_000).toISOString(),
      blockedBy: 'Waiting on Vercel function cold-start fix', estimatedMinutes: 120, actualMinutes: 90,
      position: 1, createdAt: daysAgo(3), updatedAt: hoursAgo(4),
    } },
    { collection: 'model_evaluations', id: E_WMP_A, doc: {
      userId: owner, projectId: P_WMP, projectVersionId: V_WMP_A, builder: 'Google AI Studio',
      model: 'Gemini 1.5 Pro', uiScore: 8, featureScore: 8, codeQualityScore: 7, stabilityScore: 7,
      performanceScore: 7, maintainabilityScore: 7, mobileScore: 8, accessibilityScore: 7,
      developmentSpeedScore: 7, costScore: 5, overallScore: 7.5, evaluatorNotes: 'Strong recipes.',
      evaluatedAt: daysAgo(4), createdAt: daysAgo(4), updatedAt: daysAgo(4),
    } },
    { collection: 'model_evaluations', id: E_WMP_B, doc: {
      userId: owner, projectId: P_WMP, projectVersionId: V_WMP_B, builder: 'FreeBuff',
      model: 'Kimi K3', uiScore: 7, featureScore: 7, codeQualityScore: 6, stabilityScore: 6,
      performanceScore: 8, maintainabilityScore: 6, mobileScore: 7, accessibilityScore: 6,
      developmentSpeedScore: 9, costScore: 7, overallScore: 7.1, evaluatorNotes: 'Ships fast.',
      evaluatedAt: daysAgo(4), createdAt: daysAgo(4), updatedAt: daysAgo(4),
    } },

    // ── Classic Chef Video Guide — failed prod deploy, uncommitted repo ──
    { collection: 'projects', id: P_CHEF, doc: {
      userId: owner, name: 'Classic Chef Video Guide', slug: 'classic-chef-video-guide',
      description: 'Step-by-step video cooking guide built to test Codex code-generation speed.',
      category: 'Cooking / Video', businessGoal: 'Validate video-first recipe format engagement',
      targetCustomer: 'Home cooks 25-45 who prefer video over text', monetizationModel: 'Subscription',
      priority: 'P1_HIGH', overallStatus: 'BUILDING', overallProgress: 57, currentVersionId: V_CHEF,
      nextAction: 'Finish recipe detail video player', nextActionDueDate: daysAgo(-2),
      blocker: undefined, archived: false, createdAt: daysAgo(32), updatedAt: hoursAgo(6), lastActivityAt: hoursAgo(6),
    } },
    { collection: 'project_versions', id: V_CHEF, doc: {
      userId: owner, projectId: P_CHEF, versionName: 'Codex Build', builder: 'Codex',
      model: 'GPT-4o Codex', modelVersion: 'codex-1', developmentPlatform: 'Next.js + Vercel',
      status: 'BUILDING', progress: 57, localFolderPath: '~/dev/chef-video-guide/codex',
      repositoryId: R_CHEF, deploymentIds: [D_CHEF], primaryDeploymentId: D_CHEF, branch: 'main',
      lastCommitAt: hoursAgo(5), lastActivityAt: hoursAgo(6), estimatedCost: 120, actualCost: 85,
      developmentHours: 34, isWinner: false, isArchived: false, notes: 'Fast codegen; needs video-player polish.',
      createdAt: daysAgo(30), updatedAt: hoursAgo(6),
    } },
    { collection: 'repositories', id: R_CHEF, doc: {
      userId: owner, projectVersionId: V_CHEF, provider: 'github', owner: 'chef-labs',
      repositoryName: 'chef-video-guide-codex', repositoryUrl: 'https://github.com/chef-labs/chef-video-guide-codex',
      defaultBranch: 'main', currentBranch: 'main', private: true,
      lastCommitSha: '9f3d1c', lastCommitMessage: 'Add video player controls', lastCommitAt: hoursAgo(5),
      openPullRequests: 1, openIssues: 3, workflowStatus: 'success', commitsAhead: 4, commitsBehind: 0,
      hasUncommittedChanges: true, hasUnpushedCommits: true, lastScannedAt: minutesAgo(42),
      connectionStatus: 'CONNECTED', createdAt: daysAgo(30), updatedAt: hoursAgo(1),
    } },
    { collection: 'deployments', id: D_CHEF, doc: {
      userId: owner, projectVersionId: V_CHEF, provider: 'vercel', projectName: 'chef-video-guide-codex',
      environment: 'production', deploymentUrl: 'https://chef-video-guide-codex.vercel.app',
      dashboardUrl: 'https://vercel.com/chef-labs/chef-video-guide-codex',
      status: 'ERROR', healthStatus: 'FAILED', lastDeploymentAt: hoursAgo(3),
      lastSuccessfulDeploymentAt: daysAgo(2), framework: 'Next.js', branch: 'main',
      responseCode: 500, responseTimeMs: 890, lastFailureMessage: 'Build step failed on video asset pipeline',
      lastHealthCheckAt: minutesAgo(30), createdAt: daysAgo(29), updatedAt: minutesAgo(30),
    } },
    { collection: 'tasks', id: T_CHEF, doc: {
      userId: owner, projectId: P_CHEF, projectVersionId: V_CHEF, title: 'Finish recipe detail video player',
      description: 'Autoplay next recipe, chapter markers, transcript toggle.',
      status: 'IN_PROGRESS', priority: 'P1_HIGH', taskType: 'FEATURE', dueDate: daysAgo(2),
      estimatedMinutes: 180, actualMinutes: 120, position: 0, createdAt: daysAgo(6), updatedAt: hoursAgo(3),
    } },
    { collection: 'model_evaluations', id: E_CHEF, doc: {
      userId: owner, projectId: P_CHEF, projectVersionId: V_CHEF, builder: 'Codex',
      model: 'GPT-4o Codex', uiScore: 7, featureScore: 6, codeQualityScore: 7, stabilityScore: 6,
      performanceScore: 8, maintainabilityScore: 6, mobileScore: 5, accessibilityScore: 4,
      developmentSpeedScore: 9, costScore: 6, overallScore: 6.6, evaluatorNotes: 'Very fast, needs UI polish.',
      evaluatedAt: daysAgo(3), createdAt: daysAgo(3), updatedAt: daysAgo(3),
    } },

    // ── Restaurant Social Media Manager — blocked, next task overdue ──
    { collection: 'projects', id: P_RESTO, doc: {
      userId: owner, name: 'Restaurant Social Media Manager', slug: 'restaurant-social-media-manager',
      description: 'Auto-generates daily social posts for restaurants from menu + photos.',
      category: 'Restaurant Ops', businessGoal: 'Sell to local restaurants as a monthly service',
      targetCustomer: 'Independent restaurant owners', monetizationModel: 'SaaS monthly',
      priority: 'P1_HIGH', overallStatus: 'BUILDING', overallProgress: 41, currentVersionId: V_RESTO,
      nextAction: 'Unblock Lovable OAuth callback', nextActionDueDate: daysAgo(-3),
      blocker: 'Facebook API app review pending (2 weeks)', archived: false,
      createdAt: daysAgo(38), updatedAt: daysAgo(1), lastActivityAt: daysAgo(1),
    } },
    { collection: 'project_versions', id: V_RESTO, doc: {
      userId: owner, projectId: P_RESTO, versionName: 'Lovable Build', builder: 'Lovable',
      model: 'Lovable default', developmentPlatform: 'Lovable + Firebase', status: 'BUILDING',
      progress: 46, localFolderPath: '~/dev/resto-social/lovable', repositoryId: undefined,
      deploymentIds: [], branch: 'main', blocker: 'Facebook API app review pending',
      lastActivityAt: daysAgo(1), estimatedCost: 150, actualCost: 110, developmentHours: 40,
      isWinner: false, isArchived: false, createdAt: daysAgo(36), updatedAt: daysAgo(1),
    } },
    { collection: 'tasks', id: T_RESTO, doc: {
      userId: owner, projectId: P_RESTO, projectVersionId: V_RESTO, title: 'Complete Facebook app review form',
      status: 'BLOCKED', priority: 'P1_HIGH', taskType: 'DEPLOYMENT', dueDate: daysAgo(4),
      blockedBy: 'External review queue', estimatedMinutes: 60, position: 0,
      createdAt: daysAgo(10), updatedAt: daysAgo(5),
    } },

    // ── Profile ──
    { collection: 'profiles', id: owner, doc: {
      userId: owner, name: 'Command Center User',
      timezone: 'America/Los_Angeles', dailyReportEnabled: true, dailyReportTime: '08:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '09:00',
      defaultStaleDays: 7, createdAt: daysAgo(60), updatedAt: hoursAgo(1),
    } },
  ];
};

// ─── Firestore Value <-> JS conversion (mirrors lib/server/firestoreAdmin.ts) ─
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

// Assigned by the CLI entrypoint (module scope so the REST helpers can see them).
let BASE = '';
let bearer = '';

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
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
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

const listByOwner = async (collection, owner) => {
  const res = await fetch(`${BASE}:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'userId' },
            op: 'EQUAL',
            value: { stringValue: owner },
          },
        },
      },
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`list ${collection} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const rows = await res.json();
  return rows.filter((r) => r.document).map((r) => ({
    id: r.document.name.split('/').pop(),
    ...decodeFields(r.document.fields ?? {}),
  }));
};

// ─── CLI (only runs when executed directly, so tests can import the builder) ─
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };

  const OWNER = flag('--owner') ?? readEnv('REPORT_OWNER_ID') ?? 'demo-user';
  const CLEAR = args.includes('--clear');
  const LIST = args.includes('--list');

  const SA_RAW = flag('--service-account') ?? getServiceAccount();
  const PROJECT = flag('--project') ?? getProjectId();

  if (!SA_RAW || !PROJECT) {
    console.error('[seed-live-data] ✗ FIREBASE_SERVICE_ACCOUNT and a project id are required.');
    console.error('  Pass --service-account/--project, set them in the environment, or add');
    console.error('  FIREBASE_SERVICE_ACCOUNT + NEXT_PUBLIC_FIREBASE_PROJECT_ID to .env.local.');
    process.exit(1);
  }

  let bearerToken;
  try {
    bearerToken = await mintServiceAccountToken(SA_RAW);
  } catch (err) {
    console.error('[seed-live-data] ✗ token mint:', err.message);
    process.exit(1);
  }
  bearer = bearerToken;

  BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const FIXTURE = buildLiveFixture(OWNER);

  // --list mode: read-only per-collection counts for the owner.
  if (LIST) {
    const listMode = async () => {
      console.log(`[seed-live-data] --list: reading docs owned by "${OWNER}" (project ${PROJECT})…`);
      const seen = new Set();
      let total = 0;
      for (const { collection } of FIXTURE) {
        if (seen.has(collection)) continue;
        seen.add(collection);
        const docs = await listByOwner(collection, OWNER);
        total += docs.length;
        console.log(`  - ${collection}: ${docs.length} doc(s)`);
      }
      console.log();
      console.log(`Total docs owned by "${OWNER}": ${total}`);
      if (total === 0) console.log('Nothing seeded yet — run without --list to seed.');
      return 0;
    };
    listMode()
      .then((code) => process.exit(code))
      .catch((err) => {
        console.error('[seed-live-data] ✗', err.message);
        process.exit(1);
      });
  } else {
    const main = async () => {
      if (CLEAR) {
        console.log(`[seed-live-data] --clear: deleting fixture docs owned by "${OWNER}"…`);
        let count = 0;
        for (const { collection, id } of FIXTURE) {
          const doc = await get(collection, id);
          if (!doc) continue;
          if (String(doc.userId ?? '') !== OWNER) {
            console.warn(`  ✗ ${collection}/${id} is owned by "${doc.userId}" — skipping (not yours to clear).`);
            continue;
          }
          await del(collection, id);
          count += 1;
        }
        console.log(`[seed-live-data] cleared ${count} doc(s).`);
      }

      console.log(`[seed-live-data] upserting ${FIXTURE.length} docs into Firestore (project ${PROJECT}) for owner "${OWNER}"…`);
      const byCollection = {};
      for (const { collection, id, doc } of FIXTURE) {
        await upsert(collection, { id, ...doc });
        byCollection[collection] = (byCollection[collection] ?? 0) + 1;
      }

      console.log('[seed-live-data] ✓ fixture ready:');
      for (const [collection, count] of Object.entries(byCollection)) {
        console.log(`  ${collection}: ${count}`);
      }
      console.log();
      console.log('Next: sign in with this owner on the deployed app (or the cron with');
      console.log('REPORT_OWNER_ID set to the same owner) — Command Center metrics, the');
      console.log('priority queue, top-three, and the emailed reports now compute against');
      console.log('live Firestore rows instead of zeros.');
      console.log();
      console.log('Safety: run with --list before --clear to confirm what is owned by this owner.');
    };
    main().catch((err) => {
      console.error('[seed-live-data] ✗', err.message);
      process.exit(1);
    });
  }
}
