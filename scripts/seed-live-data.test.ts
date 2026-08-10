import { describe, expect, it } from 'vitest';
import { buildLiveFixture, fixtureNamespace } from './seed-live-data.mjs';

// ── buildLiveFixture ─────────────────────────────────────────────────────────
describe('buildLiveFixture', () => {
  it('scopes every doc to the given owner and covers every collection', () => {
    const fixture = buildLiveFixture('uid-123');
    expect(fixture.length).toBeGreaterThan(10);

    const collections = new Set(fixture.map((f) => f.collection));
    expect(collections.has('projects')).toBe(true);
    expect(collections.has('project_versions')).toBe(true);
    expect(collections.has('repositories')).toBe(true);
    expect(collections.has('deployments')).toBe(true);
    expect(collections.has('tasks')).toBe(true);
    expect(collections.has('model_evaluations')).toBe(true);
    expect(collections.has('profiles')).toBe(true);

    for (const { id, doc } of fixture) {
      expect(doc.userId).toBe('uid-123');
      expect(id).toBeTruthy();
    }
  });

  it('writes the profile under the owner id (what getById(profiles, userId) reads)', () => {
    const fixture = buildLiveFixture('uid-abc');
    const profile = fixture.find((f) => f.collection === 'profiles');
    expect(profile?.id).toBe('uid-abc');
    expect(profile?.doc.userId).toBe('uid-abc');
  });

  it('keeps the metric-driving rows non-zero: overdue task, failed deploy, uncommitted repo', () => {
    const fixture = buildLiveFixture('uid-1');
    const byId = (collection, id) => fixture.find((f) => f.collection === collection && f.id === id)?.doc;

    const overdue = fixture.filter((f) => f.collection === 'tasks')
      .filter((t) => t.doc.status !== 'COMPLETED' && new Date(t.doc.dueDate).getTime() < Date.now());
    expect(overdue.length).toBeGreaterThan(0);

    expect(fixture.some((f) => f.collection === 'deployments' && f.doc.status === 'ERROR')).toBe(true);
    expect(fixture.some((f) => f.collection === 'deployments' && f.doc.healthStatus === 'HEALTHY')).toBe(true);
    expect(fixture.some((f) => f.collection === 'repositories' && f.doc.hasUncommittedChanges)).toBe(true);
    expect(fixture.some((f) => f.collection === 'repositories' && f.doc.hasUnpushedCommits)).toBe(true);

    // Rule-10 candidate: a project with two active versions, no winner, and evals.
    const wmpId = `${fixtureNamespace('uid-1')}-p-wmp`;
    const wmp = fixture.find((f) => f.id === wmpId);
    expect(wmp?.doc.winningVersionId ?? wmp?.doc.winnerSelected).toBeUndefined();
    const wmpVersions = fixture.filter((f) => f.collection === 'project_versions' && f.doc.projectId === wmpId);
    expect(wmpVersions.length).toBeGreaterThan(1);
    expect(wmpVersions.every((v) => !v.doc.isWinner)).toBe(true);
    expect(fixture.some((f) => f.collection === 'model_evaluations' && f.doc.projectId === wmpId)).toBe(true);
    void byId;
  });

  it('uses deterministic ids across calls (idempotent re-seed)', () => {
    const a = buildLiveFixture('uid-9').map((f) => `${f.collection}/${f.id}`);
    const b = buildLiveFixture('uid-9').map((f) => `${f.collection}/${f.id}`);
    expect(a).toEqual(b);
  });

  it('namespaces ids per owner so two owners can never share a doc id', () => {
    // The regression this locks: the fixture ids used to be FIXED, so seeding
    // under a throwaway uid (verify-review-sheet's gate) PATCH-overwrote the
    // same-named docs of the real owner, and its --clear then deleted them —
    // destroying the owner's data on every suite run. With per-owner
    // namespacing the two fixtures share zero collection/id pairs.
    const real = buildLiveFixture('real-owner-uid-1');
    const throwaway = buildLiveFixture('throwaway-uid-2');
    const ids = (f) => new Set(f.map((x) => `${x.collection}/${x.id}`));
    const overlap = [...ids(real)].filter((k) => ids(throwaway).has(k));
    expect(overlap).toEqual([]);

    // Every non-profile fixture id carries the owner's stable prefix.
    for (const { collection, id } of real) {
      if (collection === 'profiles') {
        expect(id).toBe('real-owner-uid-1'); // profile id IS the uid
      } else {
        expect(String(id).startsWith(`${fixtureNamespace('real-owner-uid-1')}-`)).toBe(true);
      }
    }
  });
});
