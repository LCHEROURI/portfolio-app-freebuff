import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the small server helper (not the node:fs/promises builtin, which is
// flaky to mock). Same pattern as the cron route test mocking
// @/lib/server/reporting/data. vi.hoisted runs before the mock factory so the
// shared fn is safe from hoisting-order issues.
const { readScannedRepositoriesMock, getRequestUserIdMock } = vi.hoisted(() => ({
  readScannedRepositoriesMock: vi.fn(),
  getRequestUserIdMock: vi.fn().mockResolvedValue('demo-user'),
}));
vi.mock('@/lib/server/scans', () => ({
  readScannedRepositories: readScannedRepositoriesMock,
}));
vi.mock('@/lib/server/user', () => ({
  getRequestUserId: getRequestUserIdMock,
}));

import { GET } from './route';

const makeRepo = (overrides: Record<string, unknown> = {}) => ({
  id: 'r-1',
  userId: 'demo-user',
  provider: 'github',
  owner: 'LCHEROURI',
  repositoryName: 'portfolio-app-freebuff',
  repositoryUrl: 'https://github.com/LCHEROURI/portfolio-app-freebuff',
  defaultBranch: 'main',
  currentBranch: 'main',
  private: true,
  lastCommitSha: 'abc123',
  lastCommitMessage: 'feat: something',
  lastCommitAt: '2026-08-01T12:00:00.000Z',
  openPullRequests: 0,
  openIssues: 0,
  commitsAhead: 3,
  commitsBehind: 1,
  hasUncommittedChanges: true,
  hasUnpushedCommits: false,
  connectionStatus: 'CONNECTED',
  lastScannedAt: '2026-08-04T06:30:00.000Z',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-04T06:30:00.000Z',
  ...overrides,
});

const request = () => new NextRequest('http://localhost/api/scans');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/scans', () => {
  it('returns one row per repo with lastScannedAt, sorted newest first', async () => {
    readScannedRepositoriesMock.mockResolvedValue([
      makeRepo({ id: 'r-old', repositoryName: 'old-repo', lastScannedAt: '2026-08-01T06:30:00.000Z' }),
      makeRepo({ repositoryName: 'fresh-repo' }),
    ]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; repos: Array<{ repositoryName: string; lastScannedAt: string }> };

    expect(json.ok).toBe(true);
    expect(json.repos).toHaveLength(2);
    expect(json.repos[0].repositoryName).toBe('fresh-repo');
    expect(json.repos[0].lastScannedAt).toBe('2026-08-04T06:30:00.000Z');
    expect(json.repos[1].repositoryName).toBe('old-repo');
  });

  it('omits rows without a repositoryName (malformed / partial scans)', async () => {
    readScannedRepositoriesMock.mockResolvedValue([
      makeRepo(),
      { id: 'r-broken', lastScannedAt: '2026-08-04T06:30:00.000Z' }, // no repositoryName
      'not-an-object',
    ]);

    const res = await GET(request());
    const json = (await res.json()) as { repos: unknown[] };
    expect(json.repos).toHaveLength(1);
  });

  it('returns an empty feed when the scans feed is missing or unreadable', async () => {
    readScannedRepositoriesMock.mockRejectedValue(new Error('ENOENT'));

    const res = await GET(request());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; repos: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.repos).toEqual([]);
  });

  it('returns an empty feed for non-array JSON', async () => {
    readScannedRepositoriesMock.mockResolvedValue({ not: 'an array' });

    const res = await GET(request());
    const json = (await res.json()) as { repos: unknown[] };
    expect(json.repos).toEqual([]);
  });

  it('requires an authenticated user (401 without identity)', async () => {
    getRequestUserIdMock.mockResolvedValue(null);

    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(readScannedRepositoriesMock).not.toHaveBeenCalled();
  });

  it('scopes the Firestore-backed feed to the acting user', async () => {
    getRequestUserIdMock.mockResolvedValue('owner-123');
    readScannedRepositoriesMock.mockResolvedValue([makeRepo()]);

    await GET(request());
    expect(readScannedRepositoriesMock).toHaveBeenCalledWith('owner-123');
  });
});
