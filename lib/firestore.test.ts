import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── firebase/firestore fake ────────────────────────────────────────────────
// FirestoreService builds its queries through the real SDK; this fake records
// every query node (collection / where / limit / orderBy) so the test can
// assert the EXACT constraints loadAll issues — the read-budget guard: the
// activity feed must carry a document-id-desc order + limit(200) (newest-first
// via the default index, no composite index) and reports a plain limit(60),
// while the small collections stay unbounded. A future edit that drops a
// limit or the order would fail here before the 429 quota ever does.
const node = (type: string, ...args: unknown[]) => ({ type, args });

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, name: string) => node('collection', db, name),
  doc: (db: unknown, name: string, id: string) => node('doc', db, name, id),
  query: (base: unknown, ...constraints: unknown[]) => node('query', base, constraints),
  where: (field: string, op: string, value: unknown) => node('where', field, op, value),
  limit: (n: number) => node('limit', n),
  orderBy: (field: unknown, dir: string) => node('orderBy', field, dir),
  getDocs: vi.fn(async () => ({ docs: [] })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

vi.mock('@/lib/firebase', () => ({
  getFirestoreDb: vi.fn(() => ({ fake: true })),
  isFirebaseConfigured: vi.fn(() => true),
  getUserId: vi.fn(async () => 'u1'),
}));

import { getDocs } from 'firebase/firestore';

import { FirestoreService } from './firestore';

/** The constraints array of the loadAll query for `collectionName`. */
const constraintsFor = (collectionName: string): unknown[] => {
  const calls = vi.mocked(getDocs).mock.calls;
  const query = calls
    .map((c) => c[0] as unknown as { type: string; args: [unknown, unknown[]] })
    .find((q) => {
      const base = q.args[0] as unknown as { type: string; args: [unknown, string] };
      return base.type === 'collection' && base.args[1] === collectionName;
    });
  if (!query) throw new Error(`loadAll issued no query for ${collectionName}`);
  return query.args[1];
};

const has = (constraints: unknown[], type: string) =>
  (constraints as Array<{ type: string }>).some((c) => c.type === type);

beforeEach(() => {
  vi.mocked(getDocs).mockClear();
});

describe('FirestoreService.loadAll — bounded read queries (read-budget guard)', () => {
  it('loads the activity feed with document-id DESC + limit(200), no composite index needed', async () => {
    await new FirestoreService().loadAll('u1');
    const constraints = constraintsFor('activity');
    // Equality on userId (owner scoping)…
    expect(has(constraints, 'where')).toBe(true);
    // …newest-first via doc-id order (ids are `a-<base36-ms><rand>`)…
    const order = constraints.find((c) => (c as { type: string }).type === 'orderBy') as
      { type: string; args: [string, string] };
    expect(order).toBeDefined();
    expect(order.args[1]).toBe('desc');
    // The SDK maps the '__name__' field string to the document id — locked
    // here so a future edit can't swap in a field that needs a composite index.
    expect(order.args[0]).toBe('__name__');
    // …capped at the store's in-memory 200-entry activity cap.
    const lim = constraints.find((c) => (c as { type: string }).type === 'limit') as
      { type: string; args: [number] };
    expect(lim.args[0]).toBe(200);
  });

  it('loads reports with a plain limit(60) and NO orderBy (mixed id schemes)', async () => {
    await new FirestoreService().loadAll('u1');
    const constraints = constraintsFor('reports');
    const lim = constraints.find((c) => (c as { type: string }).type === 'limit') as
      { type: string; args: [number] };
    expect(lim.args[0]).toBe(60);
    // Report ids mix `r-<ts>` and `r-seed-<kind>-<date>`, so doc-id order is
    // not reliably newest-first — adding an orderBy here would reorder rows.
    expect(has(constraints, 'orderBy')).toBe(false);
  });

  it('leaves the small collections unbounded (no limit/orderBy beyond the userId filter)', async () => {
    await new FirestoreService().loadAll('u1');
    // Collection ids, not type names (COLLECTIONS maps versions → project_versions
    // and evaluations → model_evaluations).
    for (const name of ['projects', 'project_versions', 'repositories', 'deployments', 'tasks', 'model_evaluations']) {
      const constraints = constraintsFor(name);
      expect(has(constraints, 'where')).toBe(true);
      expect(has(constraints, 'limit')).toBe(false);
      expect(has(constraints, 'orderBy')).toBe(false);
    }
  });

  it('returns the default profile and empty collections from the fake snapshot', async () => {
    const all = await new FirestoreService().loadAll('u1');
    expect(all.profile.id).toBe('u1');
    expect(all.activity).toEqual([]);
    expect(all.reports).toEqual([]);
    expect(all.projects).toEqual([]);
  });
});
