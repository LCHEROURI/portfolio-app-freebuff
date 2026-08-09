#!/usr/bin/env node
// ============================================================================
// scripts/seed-in-app-reports.mjs — pull composed reports into the in-app feed.
//
// Nothing is emailed: the cron route still composes the daily/weekly
// bodies (exposed via ?previewBody=1) but never sends them. This script closes
// the loop for the in-app Reports page — it calls the cron route with the same
// CRON_SECRET bearer, takes the composed reports out of the JSON response, and
// upserts them into the Firestore `reports` collection under an owner id, so
// the Reports page feed stays populated daily without any email.
//
// Usage:
//   node scripts/seed-in-app-reports.mjs [--owner demo-user] [--kind both]
//       [--base https://portfolio-app-freebuff.vercel.app] [--secret <CRON_SECRET>]
//       [--dry-run] [--project <id>] [--service-account <json>]
//
// Reads CRON_SECRET from --secret, then the CRON_SECRET env var, then
// .env.local. The owner defaults to REPORT_OWNER_ID, then 'demo-user' — the
// same default the cron uses, so a no-flag run seeds under the same owner the
// automation reads. --dry-run prints the docs that would be written without
// touching Firestore, so the write path is reviewable before it runs.
//
// Docs are written in the SAME camelCase shape the client FirestoreService
// (lib/firestore.ts) stores — the doc id IS the entity id, `userId` is set for
// rules isolation, and the field set matches the client's saveReport exactly —
// so seeded reports can never drift from what the Reports page reads. The id is
// stable per kind + UTC date (`r-seed-daily-2026-08-06`), so re-running the
// script on the same day replaces the report instead of duplicating it.
//
// Credentials resolve from FIREBASE_SERVICE_ACCOUNT (JSON string) or
// FIREBASE_SERVICE_ACCOUNT_PATH (file), then .env.local. Project id comes from
// --project, then NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_PROJECT_ID env,
// then .env.local. The Google OAuth token is minted from the shared
// lib/server/sa-token.mjs module (the same flow firestoreAdmin.ts and the other
// seeders use), so this script can never drift from the cron.
//
// Exits nonzero when the service account is not configured (nothing to write),
// when the cron rejects the request (401 → CRON_SECRET drift), or when a
// Firestore write fails — so the step can gate a deploy script.
// ============================================================================

import { fileURLToPath } from 'node:url';

import { getProjectId, getServiceAccount, mintServiceAccountToken } from '../lib/server/sa-token.mjs';
import { readLocalEnv } from './local-env.mjs';

// ─── Composed cron report -> client Report doc ─────────────────────────────

/**
 * Convert a composed report from the cron's ?previewBody=1 response into the
 * exact shape the client FirestoreService.saveReport writes (see
 * app/reports/page.tsx savePreview: { id, userId, kind, title, body,
 * attentionCount, createdAt, aiSummary?, aiModel? }). The id is stable per
 * kind + UTC date so a same-day re-run replaces rather than duplicates.
 * Exported for unit tests.
 */
export const toReportDoc = (ownerId, composed, nowIso = new Date().toISOString()) => {
  const day = nowIso.slice(0, 10);
  return {
    id: `r-seed-${composed.kind}-${day}`,
    userId: ownerId,
    kind: composed.kind,
    title: composed.title,
    body: composed.body,
    attentionCount: composed.attentionCount,
    createdAt: nowIso,
    // The AI executive summary text rides inside the composed body (the cron
    // applies withExecutiveSummary before returning), so the separate summary
    // field stays unset — matching a client save where the summary was absent.
    // The model key is only present when there is one (Firestore prunes
    // undefined, but the absent key is the honest shape).
    ...(composed.aiModel ? { aiModel: composed.aiModel } : {}),
  };
};

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };

  const BASE = (flag('--base', process.env.VERIFY_BASE_URL) ?? 'https://portfolio-app-freebuff.vercel.app').replace(/\/$/, '');
  const SECRET =
    flag('--secret') ??
    process.env.CRON_SECRET ??
    (() => {
      try {
        return readLocalEnv('CRON_SECRET') ?? '';
      } catch {
        return '';
      }
    })();
  const OWNER = flag('--owner') ?? process.env.REPORT_OWNER_ID ?? 'demo-user';
  const KIND_FLAG = flag('--kind', 'both'); // daily | weekly | both
  const KINDS = KIND_FLAG === 'both' ? ['daily', 'weekly'] : [KIND_FLAG];
  const DRY = args.includes('--dry-run');

  if (!SECRET) {
    console.error('[seed-in-app-reports] ✗ CRON_SECRET not found (--secret, env, or .env.local). The cron rejects requests without it.');
    process.exit(2);
  }

  const SA_RAW = flag('--service-account') ?? getServiceAccount();
  if (!SA_RAW) {
    console.error('[seed-in-app-reports] ✗ FIREBASE_SERVICE_ACCOUNT not configured (env or .env.local). Nothing to write without it.');
    process.exit(2);
  }
  const PROJECT = flag('--project') ?? getProjectId();

  let bearer;
  try {
    bearer = await mintServiceAccountToken(SA_RAW);
  } catch (err) {
    console.error('[seed-in-app-reports] ✗ token mint:', err instanceof Error ? err.message : err);
    process.exit(2);
  }

  const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

  // Firestore Value <-> JS conversion (mirrors lib/server/firestoreAdmin.ts,
  // the same shape the client FirestoreService writes).
  const encodeValue = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
    if (typeof v === 'object') {
      return { mapValue: { fields: encodeFields(v) } };
    }
    return { nullValue: null };
  };

  const encodeFields = (doc) => {
    const out = {};
    for (const [key, value] of Object.entries(doc)) {
      if (value === undefined) continue;
      out[key] = encodeValue(value);
    }
    return out;
  };

  const upsert = async (collection, doc) => {
    const { id, ...fields } = doc;
    const res = await fetch(`${DB}/${collection}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: encodeFields(fields) }),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`upsert ${collection}/${id} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
  };

  console.log(`[seed-in-app-reports] pulling ${KINDS.join(' + ')} report(s) from ${BASE} (owner ${OWNER})…`);

  for (const kind of KINDS) {
    const res = await fetch(`${BASE}/api/cron/reports?kind=${kind}&previewBody=1`, {
      headers: { authorization: `Bearer ${SECRET}` },
      cache: 'no-store',
    });

    if (res.status === 401) {
      console.error(`[seed-in-app-reports] ✗ cron rejected the request (401) — CRON_SECRET drift between ${BASE} and this machine. Sync and retry.`);
      process.exit(2);
    }
    if (!res.ok) {
      console.error(`[seed-in-app-reports] ✗ cron responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      process.exit(2);
    }

    const body = await res.json();
    if (body.ok !== true) {
      console.error(`[seed-in-app-reports] ✗ cron returned ok:false — ${body.note ?? 'unknown'}`);
      process.exit(2);
    }
    if (!Array.isArray(body.reports) || body.reports.length === 0) {
      // e.g. the weekly report only composes on REPORT_WEEKLY_DAY — the cron
      // response then has no weekly entry. Not an error: report it and move on.
      console.log(`[seed-in-app-reports] · ${kind}: no report composed (${body.note ?? 'weekly day or data gate not met'}) — nothing to seed.`);
      continue;
    }

    for (const composed of body.reports) {
      if (composed.kind !== kind) continue; // kind=auto can return both
      const doc = toReportDoc(OWNER, composed);
      if (DRY) {
        console.log(`[seed-in-app-reports] · DRY RUN: would write reports/${doc.id} (${doc.kind}, ${doc.title}, ${doc.body.length} chars)`);
        continue;
      }
      await upsert('reports', doc);
      console.log(`[seed-in-app-reports] ✓ upserted reports/${doc.id} (${doc.kind}, ${doc.title}, ${doc.body.length} chars)`);
    }
  }

  if (DRY) {
    console.log('[seed-in-app-reports] dry run complete — nothing written.');
  } else {
    console.log('[seed-in-app-reports] done. Open the Reports page (signed in as the owner) to see the seeded feed.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('[seed-in-app-reports] ✗', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
