// ============================================================================
// Server-only Firestore admin client (REST + service account).
//
// The old Postgres store is gone: the app's single data store is Firestore, written by the
// client via lib/firestore.ts (FirestoreService) and read server-side by the
// automation cron through this module. The service account JSON is read from
// FIREBASE_SERVICE_ACCOUNT (a JSON string) or FIREBASE_SERVICE_ACCOUNT_PATH
// (a file). A Google OAuth token is minted from the SA private key (JWT RS256
// -> token endpoint, the same flow as scripts/authorize-domain.mjs), then the
// Firestore v1 REST API is called with it.
//
// Documents are stored in the SAME camelCase shape the client FirestoreService
// writes (entity minus `id`; the doc id IS the entity id), so reads come back
// as typed entities directly — no field renaming needed.
//
// Everything is owner-scoped by `userId` in the query/document, matching the
// client's security model (firestore.rules enforce userId == auth.uid for the
// browser path; the service account bypasses rules by design server-side).
// ============================================================================

import { isServiceAccountConfigured, mintServiceAccountToken } from './sa-token.mjs';

// The service-account credential resolution and the JWT→OAuth token mint live
// in ./sa-token.mjs (shared with scripts/seed-winner-candidates.mjs and
// scripts/authorize-domain.mjs) so the flows can never drift.

export const isFirestoreAdminConfigured = (): boolean => isServiceAccountConfigured();

/** The Firestore project id (from the client env var, else the server one). */
export const getFirestoreProjectId = (): string =>
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? '';

/** A cached OAuth access token for the service account (mints on first use). */
export const getFirestoreAdminToken = async (): Promise<string> => mintServiceAccountToken();

// ─── REST plumbing ──────────────────────────────────────────────────────────

const dbUrl = (): string =>
  `https://firestore.googleapis.com/v1/projects/${getFirestoreProjectId()}/databases/(default)/documents`;

const authHeaders = async (): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await getFirestoreAdminToken()}`,
  'content-type': 'application/json',
});

// ─── Firestore Value <-> JS conversion ──────────────────────────────────────

type FirestoreValue = Record<string, unknown>;

const decodeValue = (v: FirestoreValue): unknown => {
  if (v === null || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) {
    const values = (v.arrayValue as { values?: FirestoreValue[] }).values ?? [];
    return values.map(decodeValue);
  }
  if ('mapValue' in v) {
    const fields = (v.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {};
    return decodeFields(fields);
  }
  if ('nullValue' in v) return null;
  return null;
};

const decodeFields = (fields: Record<string, FirestoreValue>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
};

const encodeValue = (v: unknown): FirestoreValue => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') {
    return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  }
  return { nullValue: null };
};

const encodeFields = (doc: Record<string, unknown>): Record<string, FirestoreValue> => {
  const out: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) continue;
    out[key] = encodeValue(value);
  }
  return out;
};

const docIdFromName = (name: string): string => name.split('/').pop() ?? name;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * List every document in `collection` whose `userId` field equals `userId`.
 * Returns typed entities (the doc id is attached as `id`), matching the shape
 * the client FirestoreService stores. Never throws: failures return [] so the
 * cron snapshot degrades gracefully (same contract the old store path had).
 */
export const firestoreList = async <T extends { id: string }>(
  collection: string,
  userId: string,
): Promise<T[]> => {
  if (!isFirestoreAdminConfigured()) return [];
  try {
    const res = await fetch(`${dbUrl()}:runQuery`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'userId' },
              op: 'EQUAL',
              value: { stringValue: userId },
            },
          },
        },
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`Firestore list ${collection} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const rows = (await res.json()) as Array<{ document?: { name: string; fields: Record<string, FirestoreValue> } }>;
    return rows
      .filter((r) => r.document)
      .map((r) => ({
        id: docIdFromName(r.document!.name),
        ...decodeFields(r.document!.fields),
      }) as T);
  } catch (err) {
    console.warn(`Firestore list ${collection} threw:`, err instanceof Error ? err.message : err);
    return [];
  }
};

/**
 * Upsert a document (idempotent: the doc id is the entity id). The `id` field
 * is excluded from the stored fields — it is the doc name — matching what the
 * client FirestoreService writes.
 */
export const firestoreUpsert = async <T extends { id: string }>(
  collection: string,
  doc: T,
): Promise<void> => {
  if (!isFirestoreAdminConfigured()) return;
  const { id, ...fields } = doc;
  const res = await fetch(`${dbUrl()}/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ fields: encodeFields(fields as Record<string, unknown>) }),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Firestore upsert ${collection}/${id} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
};

/** Delete a document. Missing docs (404) count as success so clearing is idempotent. */
export const firestoreDelete = async (collection: string, id: string): Promise<void> => {
  if (!isFirestoreAdminConfigured()) return;
  const res = await fetch(`${dbUrl()}/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Firestore delete ${collection}/${id} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
};

/** Collection names shared with the client store (lib/firestore.ts COLLECTIONS). */
export const FIRESTORE_COLLECTIONS = {
  profiles: 'profiles',
  projects: 'projects',
  versions: 'project_versions',
  repositories: 'repositories',
  deployments: 'deployments',
  tasks: 'tasks',
  evaluations: 'model_evaluations',
  activity: 'activity',
  reports: 'reports',
} as const;
