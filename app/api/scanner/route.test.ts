import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// The route's persistence is source-aware: with FIREBASE_SERVICE_ACCOUNT
// configured it writes to Firestore via the admin client, gated on the
// CRON_SECRET bearer token. These tests mock the admin module so the Firestore
// path is exercised directly (no real service account in the test env).
const { firestoreUpsertMock, firestoreListMock } = vi.hoisted(() => ({
  firestoreUpsertMock: vi.fn().mockResolvedValue(undefined),
  firestoreListMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/server/firestoreAdmin', () => ({
  FIRESTORE_COLLECTIONS: { repositories: 'repositories', activity: 'activity' },
  firestoreList: firestoreListMock,
  firestoreUpsert: firestoreUpsertMock,
  isFirestoreAdminConfigured: () => true,
}));

// createDataService is only reached on the demo (non-admin) path, which these
// tests never hit — mock it so the firebase client isn't pulled in.
vi.mock('@/lib/firestore', () => ({
  createDataService: vi.fn(),
}));

import { POST } from './route';

const makeRequest = (body: unknown, token?: string) =>
  new NextRequest('http://localhost/api/scanner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const validPayload = {
  owner: 'LCHEROURI',
  repositoryName: 'portfolio-app-freebuff',
  repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff',
  provider: 'github',
  branch: 'main',
  defaultBranch: 'main',
  lastCommitSha: 'abc123',
  lastCommitMessage: 'feat: something',
  lastCommitAt: '2026-08-01T12:00:00.000Z',
  commitsAhead: 3,
  commitsBehind: 1,
  hasUncommittedChanges: true,
  hasUnpushedCommits: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.REPORT_OWNER_ID = 'owner-123';
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.REPORT_OWNER_ID;
});

describe('POST /api/scanner (Firestore admin path)', () => {
  it('rejects writes without the CRON_SECRET bearer token (401)', async () => {
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(401);
    expect(firestoreUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects writes with a wrong bearer token (401)', async () => {
    const res = await POST(makeRequest(validPayload, 'wrong-secret'));
    expect(res.status).toBe(401);
    expect(firestoreUpsertMock).not.toHaveBeenCalled();
  });

  it('persists to Firestore under REPORT_OWNER_ID when authorized (202)', async () => {
    const res = await POST(makeRequest(validPayload, 'test-cron-secret'));
    expect(res.status).toBe(202);
    const json = (await res.json()) as { ok: boolean; stored: string; repositoryId: string };
    expect(json.ok).toBe(true);
    expect(json.stored).toBe('firestore');
    expect(json.repositoryId).toBeTruthy();

    // Repository upserted with the configured owner, not the raw payload.
    const repoCall = firestoreUpsertMock.mock.calls.find(([, doc]) => doc.id === json.repositoryId);
    expect(repoCall).toBeDefined();
    const [collection, doc] = repoCall as [string, { userId: string; lastScannedAt: string }];
    expect(collection).toBe('repositories');
    expect(doc.userId).toBe('owner-123');
    expect(doc.lastScannedAt).toBeTruthy();

    // Activity entry recorded alongside the repository.
    const activityCall = firestoreUpsertMock.mock.calls.find(([col]) => col === 'activity');
    expect(activityCall).toBeDefined();
    const activity = (activityCall as [string, { kind: string; userId: string }])[1];
    expect(activity.kind).toBe('scan_ingested');
    expect(activity.userId).toBe('owner-123');
  });

  it('matches an existing repository by URL so re-scans keep the same id', async () => {
    firestoreListMock.mockResolvedValue([
      { id: 'r-existing', repositoryName: 'portfolio-app-freebuff', repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff' },
    ]);
    const res = await POST(makeRequest(validPayload, 'test-cron-secret'));
    expect(res.status).toBe(202);
    const json = (await res.json()) as { repositoryId: string };
    expect(json.repositoryId).toBe('r-existing');
  });

  it('rejects payloads that fail RepositorySchema validation (400)', async () => {
    // The route coerces most fields defensively (String/Number/Boolean), but a
    // non-numeric commitsAhead becomes NaN, which the zod schema rejects.
    const res = await POST(makeRequest({ ...validPayload, commitsAhead: 'not-a-number' }, 'test-cron-secret'));
    expect(res.status).toBe(400);
    expect(firestoreUpsertMock).not.toHaveBeenCalled();
  });
});
