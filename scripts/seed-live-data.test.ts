import { describe, expect, it } from 'vitest';
import { buildLiveFixture } from './seed-live-data.mjs';

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
    const wmp = fixture.find((f) => f.id === 'p-wmp');
    expect(wmp?.doc.winningVersionId ?? wmp?.doc.winnerSelected).toBeUndefined();
    const wmpVersions = fixture.filter((f) => f.collection === 'project_versions' && f.doc.projectId === 'p-wmp');
    expect(wmpVersions.length).toBeGreaterThan(1);
    expect(wmpVersions.every((v) => !v.doc.isWinner)).toBe(true);
    expect(fixture.some((f) => f.collection === 'model_evaluations' && f.doc.projectId === 'p-wmp')).toBe(true);
    void byId;
  });

  it('uses deterministic ids across calls (idempotent re-seed)', () => {
    const a = buildLiveFixture('uid-9').map((f) => `${f.collection}/${f.id}`);
    const b = buildLiveFixture('uid-9').map((f) => `${f.collection}/${f.id}`);
    expect(a).toEqual(b);
  });
});
