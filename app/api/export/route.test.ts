import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the server helpers (same pattern as the scans route test): the real
// FIRESTORE_COLLECTIONS map is spread through so the collection list can never
// drift from the module it mocks, and firestoreList is stubbed per test.
const { firestoreListMock, getRequestUserIdMock } = vi.hoisted(() => ({
  firestoreListMock: vi.fn(),
  getRequestUserIdMock: vi.fn().mockResolvedValue('demo-user'),
}));
vi.mock('@/lib/server/firestoreAdmin', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/server/firestoreAdmin')>();
  return { ...mod, firestoreList: firestoreListMock };
});
vi.mock('@/lib/server/user', () => ({
  getRequestUserId: getRequestUserIdMock,
}));

import { GET } from './route';

const request = () => new NextRequest('http://localhost/api/export');

const makeRow = (collection: string, id: string) => ({
  id,
  userId: 'demo-user',
  kind: collection === 'reports' ? 'daily' : undefined,
});

beforeEach(() => {
  // clearAllMocks only clears history, NOT implementations — reset both mocks
  // explicitly so the 401 test's null override can never leak into later tests.
  vi.clearAllMocks();
  getRequestUserIdMock.mockResolvedValue('demo-user');
  firestoreListMock.mockResolvedValue([]);
});

describe('GET /api/export', () => {
  it('requires an authenticated user (401 without identity)', async () => {
    getRequestUserIdMock.mockResolvedValue(null);
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(firestoreListMock).not.toHaveBeenCalled();
  });

  it('reads every owner-scoped collection for the acting user', async () => {
    await GET(request());
    const collections = firestoreListMock.mock.calls.map((c) => c[0]);
    expect(collections.sort()).toEqual([
      'activity', 'deployments', 'model_evaluations', 'profiles',
      'project_versions', 'projects', 'reports', 'repositories', 'tasks',
    ].sort());
    // Every read is scoped to the acting user.
    expect(firestoreListMock.mock.calls.every((c) => c[1] === 'demo-user')).toBe(true);
  });

  it('returns the complete payload with every collection and the attachment filename', async () => {
    firestoreListMock
      .mockResolvedValueOnce([{ id: 'prof-1', userId: 'demo-user', name: 'Owner' }]) // profiles
      .mockResolvedValueOnce([makeRow('projects', 'p-1')])
      .mockResolvedValueOnce([makeRow('project_versions', 'v-1')])
      .mockResolvedValueOnce([makeRow('repositories', 'r-1')])
      .mockResolvedValueOnce([makeRow('deployments', 'd-1')])
      .mockResolvedValueOnce([makeRow('tasks', 't-1')])
      .mockResolvedValueOnce([makeRow('model_evaluations', 'e-1')])
      .mockResolvedValueOnce([makeRow('activity', 'a-1')])
      .mockResolvedValueOnce([makeRow('reports', 'rp-1')]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename="freebuff-export-\d{4}-\d{2}-\d{2}\.json"$/);

    const payload = (await res.json()) as {
      app: string; version: number; exportedAt: string; userId: string;
      profile: unknown; projects: unknown[]; versions: unknown[]; repositories: unknown[];
      deployments: unknown[]; tasks: unknown[]; evaluations: unknown[]; activity: unknown[]; reports: unknown[];
    };
    expect(payload.app).toBe('freebuff');
    expect(payload.version).toBe(1);
    expect(payload.userId).toBe('demo-user');
    expect(payload.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Profile is the first profiles row.
    expect((payload.profile as { id: string }).id).toBe('prof-1');
    expect(payload.projects).toHaveLength(1);
    expect(payload.versions).toHaveLength(1);
    expect(payload.repositories).toHaveLength(1);
    expect(payload.deployments).toHaveLength(1);
    expect(payload.tasks).toHaveLength(1);
    expect(payload.evaluations).toHaveLength(1);
    expect(payload.activity).toHaveLength(1);
    expect(payload.reports).toHaveLength(1);
  });

  it('exports an empty profile when no profile row exists', async () => {
    const res = await GET(request());
    const payload = (await res.json()) as { profile: unknown };
    expect(payload.profile).toBeNull();
  });
});
