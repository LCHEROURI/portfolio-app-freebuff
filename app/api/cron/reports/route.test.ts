import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { LiveSnapshot } from '@/lib/server/reporting/data';

// Mock the server modules the route depends on; keep the pure engine + openrouter
// helpers real so the deterministic top three still drives the narration input.
vi.mock('@/lib/server/reporting/data', () => ({
  loadLiveSnapshot: vi.fn(),
  serverProfile: vi.fn(() => ({
    id: 'demo-user',
    name: 'Command Center',
    email: 'owner@local',
    timezone: 'UTC',
    dailyReportEnabled: true,
    dailyReportTime: '07:00',
    weeklyReportEnabled: true,
    weeklyReportDay: 1,
    weeklyReportTime: '07:00',
    defaultStaleDays: 7,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  })),
}));

vi.mock('@/lib/server/reporting/email', () => ({
  sendReportEmail: vi.fn(async () => ({ sent: true, emailId: 'email-1' })),
}));

// The Firestore admin module is mocked so tests can assert the activity log
// write without a real service account; default unconfigured so existing tests
// never touch it.
// The Firestore admin module is mocked so tests can assert the activity log
// write without a real service account; default unconfigured so existing tests
// never touch it. Real exports (FIRESTORE_COLLECTIONS) are spread through so
// the collection map can never drift from the module it mocks.
vi.mock('@/lib/server/firestoreAdmin', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/server/firestoreAdmin')>();
  return {
    ...mod,
    isFirestoreAdminConfigured: vi.fn(() => false),
    firestoreUpsert: vi.fn(async (_collection: string, row: Record<string, unknown>) => row),
    firestoreList: vi.fn(async () => []),
    getFirestoreProjectId: vi.fn(() => 'portfolio-app-freebuff2'),
    getFirestoreAdminToken: vi.fn(async () => 'test-token'),
  };
});

vi.mock('@/lib/openrouter', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/openrouter')>();
  return {
    ...mod,
    summarizeReport: vi.fn(async () => ({ summary: 'Executive summary text.', model: 'deepseek/deepseek-chat' })),
    narrateTopThree: vi.fn(),
    recommendWinner: vi.fn(),
  };
});

import { GET } from './route';
import { loadLiveSnapshot } from '@/lib/server/reporting/data';
import { sendReportEmail } from '@/lib/server/reporting/email';
import { narrateTopThree, recommendWinner } from '@/lib/openrouter';
import { firestoreUpsert, isFirestoreAdminConfigured } from '@/lib/server/firestoreAdmin';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A snapshot that yields exactly three top-three actions: a failing prod deploy,
 *  an unpushed repo, and an overdue task. */
const snapshotWithTopThree: LiveSnapshot = {
  userId: 'demo-user',
  configured: { firestore: true, github: true, deployments: true },
  collections: {
    projects: [
      {
        id: 'p-1', userId: 'demo-user', name: 'Takeout Voice 2', slug: 'takeout-voice-2',
        description: '', category: 'app', businessGoal: '', targetCustomer: '',
        monetizationModel: '', priority: 'P1_HIGH', overallStatus: 'BUILDING',
        overallProgress: 50, nextAction: '', archived: false,
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
    ],
    versions: [
      {
        id: 'v-1', projectId: 'p-1', userId: 'demo-user', versionName: 'Anti-Gravity build',
        builder: 'Anti-Gravity', model: 'Claude', developmentPlatform: 'web',
        status: 'BUILDING', progress: 50, branch: 'main', isWinner: false, isArchived: false,
        deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      },
    ],
    repositories: [
      {
        id: 'r-1', userId: 'demo-user', projectVersionId: 'v-1', provider: 'github',
        owner: 'LCHEROURI', repositoryName: 'takeout-voice-2', repositoryUrl: 'https://github.com/LCHEROURI/takeout-voice-2',
        defaultBranch: 'main', currentBranch: 'main', private: true,
        openPullRequests: 0, openIssues: 0,
        commitsAhead: 3, commitsBehind: 0, hasUncommittedChanges: false, hasUnpushedCommits: true,
        connectionStatus: 'CONNECTED', lastScannedAt: new Date().toISOString(),
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      },
    ],
    deployments: [
      {
        id: 'd-1', userId: 'demo-user', projectVersionId: 'v-1', provider: 'vercel',
        projectName: 'takeout-voice-2', environment: 'production',
        deploymentUrl: 'https://takeout-voice-2.vercel.app', status: 'ERROR',
        healthStatus: 'FAILED', lastFailureMessage: 'Health check failed (503).',
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      },
    ],
    tasks: [
      {
        id: 't-1', userId: 'demo-user', projectId: 'p-1', title: 'Ship onboarding', status: 'NEXT',
        priority: 'P1_HIGH', taskType: 'FEATURE', position: 0,
        dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      },
    ],
    evaluations: [],
  },
};

const makeReq = (kind: string) =>
  new NextRequest(`http://localhost/api/cron/reports?kind=${kind}`, {
    headers: { authorization: 'Bearer test-secret' },
  });

/** Same as makeReq but with the dev-only ?previewBody=1 verification flag. */
const makePreviewReq = (kind: string) =>
  new NextRequest(`http://localhost/api/cron/reports?kind=${kind}&previewBody=1`, {
    headers: { authorization: 'Bearer test-secret' },
  });

/** ?previewBody=1&format=text — dev-only plain-text email preview (no send). */
const makeTextPreviewReq = (kind: string) =>
  new NextRequest(`http://localhost/api/cron/reports?kind=${kind}&previewBody=1&format=text`, {
    headers: { authorization: 'Bearer test-secret' },
  });

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  vi.mocked(loadLiveSnapshot).mockResolvedValue(snapshotWithTopThree);
  vi.mocked(narrateTopThree).mockResolvedValue({
    paragraph: 'Fix the failing deploy first, then push your work and close the overdue task.',
    model: 'deepseek/deepseek-chat',
    projectIds: ['p-1'],
  });
  vi.mocked(sendReportEmail).mockClear();
  vi.mocked(isFirestoreAdminConfigured).mockReturnValue(false);
  vi.mocked(firestoreUpsert).mockClear();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

// ?sendTest=1 — Resend test-mode delivery
const makeSendTestReq = (kind: string) =>
  new NextRequest(`http://localhost/api/cron/reports?kind=${kind}&sendTest=1`, {
    headers: { authorization: 'Bearer test-secret' },
  });

// ─── Auth ────────────────────────────────────────────────────────────────────

describe('GET /api/cron/reports — auth', () => {
  it('rejects requests without the CRON_SECRET bearer token', async () => {
    const res = await GET(new NextRequest('http://localhost/api/cron/reports', { headers: {} }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized.' });
  });
});

// ─── Daily narration ─────────────────────────────────────────────────────────

describe('GET /api/cron/reports — daily top-three narration', () => {
  it('passes the deterministic top three to narrateTopThree', async () => {
    await GET(makeReq('daily'));
    expect(narrateTopThree).toHaveBeenCalledTimes(1);
    const actions = vi.mocked(narrateTopThree).mock.calls[0][0].actions;
    expect(actions).toHaveLength(3);
    expect(actions[0].title).toContain('Fix failed production deployment');
    expect(actions[1].title).toContain('Push');
    expect(actions[2].title).toContain('Ship onboarding');
  });

  it('carries project identity into the narration so the email can cite projects', async () => {
    await GET(makeReq('daily'));
    const actions = vi.mocked(narrateTopThree).mock.calls[0][0].actions;
    // The deployment, repo, and task all trace to p-1 (Takeout Voice 2) through
    // their version or task project id, so every action must carry the identity.
    expect(actions.every((a) => a.projectId === 'p-1')).toBe(true);
    expect(actions.every((a) => a.projectName === 'Takeout Voice 2')).toBe(true);
  });

  it('prepends the narration section to the emailed daily body', async () => {
    const res = await GET(makeReq('daily'));
    expect(res.status).toBe(200);

    const body = vi.mocked(sendReportEmail).mock.calls[0][0].body;
    // The email heading shows the friendly model label, matching the in-app badges.
    expect(body).toContain('## 🎯 Why these three matter today (DeepSeek Chat)');
    expect(body).toContain('Fix the failing deploy first, then push your work and close the overdue task.');
    // Narration precedes both the executive summary and the deterministic report.
    const narrationIdx = body.indexOf('Why these three matter today');
    const summaryIdx = body.indexOf('AI executive summary');
    const reportIdx = body.indexOf('# Daily Command Center Report');
    expect(narrationIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(narrationIdx);
    expect(reportIdx).toBeGreaterThan(summaryIdx);

    // The observability fields ride on the JSON response too.
    const json = (await res.json()) as {
      reports: Array<{ kind: string; aiModel: string | null; narrationModel: string | null }>;
    };
    expect(json.reports[0].kind).toBe('daily');
    expect(json.reports[0].aiModel).toBe('deepseek/deepseek-chat');
    expect(json.reports[0].narrationModel).toBe('deepseek/deepseek-chat');
  });

  it('skips the narration (keeps the email unchanged) when narrateTopThree returns null', async () => {
    vi.mocked(narrateTopThree).mockResolvedValue(null);
    await GET(makeReq('daily'));
    const body = vi.mocked(sendReportEmail).mock.calls[0][0].body;
    expect(body).not.toContain('Why these three matter today');
    // Executive summary + deterministic body still ship.
    expect(body).toContain('AI executive summary');
    expect(body).toContain('# Daily Command Center Report');
  });
});

// ─── Weekly exclusion ────────────────────────────────────────────────────────

describe('GET /api/cron/reports — weekly report', () => {
  it('does not call narrateTopThree or add the narration section to weekly emails', async () => {
    await GET(makeReq('weekly'));
    expect(narrateTopThree).not.toHaveBeenCalled();
    const body = vi.mocked(sendReportEmail).mock.calls[0][0].body;
    expect(body).not.toContain('Why these three matter today');
    expect(body).toContain('AI executive summary');
    expect(body).toContain('# Weekly Command Center Report');
  });
});

// ─── Weekly AI winner recommendation (rule 10) ───────────────────────────────

describe('GET /api/cron/reports — weekly AI winner recommendation', () => {
  /** Snapshot with two active versions, no winner, and evaluations → rule 10. */
  const snapshotWithWinnerCandidates: LiveSnapshot = {
    ...snapshotWithTopThree,
    collections: {
      ...snapshotWithTopThree.collections,
      versions: [
        {
          id: 'v-1', projectId: 'p-1', userId: 'demo-user', versionName: 'Gemini Build',
          builder: 'Google AI Studio', model: 'Gemini 1.5 Pro', developmentPlatform: 'web',
          status: 'TESTING', progress: 70, branch: 'main', isWinner: false, isArchived: false,
          deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        },
        {
          id: 'v-2', projectId: 'p-1', userId: 'demo-user', versionName: 'Codex Build',
          builder: 'Codex', model: 'openai/gpt-4.1', developmentPlatform: 'web',
          status: 'TESTING', progress: 65, branch: 'main', isWinner: false, isArchived: false,
          deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        },
      ],
      evaluations: [
        {
          id: 'e-1', userId: 'demo-user', projectId: 'p-1', projectVersionId: 'v-1',
          builder: 'Google AI Studio', model: 'Gemini 1.5 Pro',
          uiScore: 8, featureScore: 9, codeQualityScore: 8, stabilityScore: 8,
          performanceScore: 8, maintainabilityScore: 8, mobileScore: 7, accessibilityScore: 8,
          developmentSpeedScore: 8, costScore: 8, overallScore: 8.2,
          evaluatedAt: new Date().toISOString(),
          createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        },
        {
          id: 'e-2', userId: 'demo-user', projectId: 'p-1', projectVersionId: 'v-2',
          builder: 'Codex', model: 'openai/gpt-4.1',
          uiScore: 7, featureScore: 7, codeQualityScore: 7, stabilityScore: 7,
          performanceScore: 7, maintainabilityScore: 7, mobileScore: 6, accessibilityScore: 7,
          developmentSpeedScore: 7, costScore: 7, overallScore: 7.1,
          evaluatedAt: new Date().toISOString(),
          createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
        },
      ],
    },
  };

  beforeEach(() => {
    vi.mocked(recommendWinner).mockResolvedValue({
      recommendedVersionId: 'v-1',
      note: 'Gemini wins on features and overall score.',
      model: 'deepseek/deepseek-chat',
    });
  });

  it('calls recommendWinner with the sorted candidate scores for rule-10 projects', async () => {
    vi.mocked(loadLiveSnapshot).mockResolvedValue(snapshotWithWinnerCandidates);
    await GET(makeReq('weekly'));
    expect(recommendWinner).toHaveBeenCalledTimes(1);
    const input = vi.mocked(recommendWinner).mock.calls[0][0];
    expect(input.projectName).toBe('Takeout Voice 2');
    expect(input.candidates).toHaveLength(2);
    // Sorted by overall score desc — the strongest version first.
    expect(input.candidates[0].versionId).toBe('v-1');
    expect(input.candidates[0].overallScore).toBe(8.2);
    expect(input.candidates[0].scores.Features).toBe(9);
    expect(input.candidates[1].versionId).toBe('v-2');
  });

  it('prepends the winner-recommendation section with the friendly model label', async () => {
    vi.mocked(loadLiveSnapshot).mockResolvedValue(snapshotWithWinnerCandidates);
    await GET(makeReq('weekly'));
    const body = vi.mocked(sendReportEmail).mock.calls[0][0].body;
    // Friendly label in the heading, raw id only in the footer line.
    expect(body).toContain('## 🏆 AI winner recommendations (DeepSeek Chat)');
    expect(body).toContain('**Takeout Voice 2** → Gemini Build: Gemini wins on features and overall score.');
    expect(body).toContain('Model: `deepseek/deepseek-chat`');
    // The raw id must never appear inline in the winner heading — only in the
    // footer lines (the executive summary carries its own footer, so multiple
    // `Model:` lines are expected and fine).
    expect(body).not.toContain('AI winner recommendations (deepseek/deepseek-chat)');
  });

  it('omits the winner section (keeps the deterministic body) when recommendWinner returns null', async () => {
    vi.mocked(loadLiveSnapshot).mockResolvedValue(snapshotWithWinnerCandidates);
    vi.mocked(recommendWinner).mockResolvedValue(null);
    await GET(makeReq('weekly'));
    const body = vi.mocked(sendReportEmail).mock.calls[0][0].body;
    expect(body).not.toContain('AI winner recommendations');
    expect(body).toContain('# Weekly Command Center Report');
  });

  it('does not call recommendWinner when no rule-10 project exists', async () => {
    // snapshotWithTopThree has a single version → no winner candidates.
    await GET(makeReq('weekly'));
    expect(recommendWinner).not.toHaveBeenCalled();
  });

  it('exposes the structured winnerRecommendations in the previewBody response', async () => {
    vi.mocked(loadLiveSnapshot).mockResolvedValue(snapshotWithWinnerCandidates);
    const res = await GET(makePreviewReq('weekly'));
    const json = (await res.json()) as {
      reports: Array<{ winnerRecommendations?: Array<{ projectName: string; versionName: string; model: string }> }>;
    };
    expect(json.reports[0].winnerRecommendations).toEqual([
      { projectName: 'Takeout Voice 2', versionName: 'Gemini Build', note: 'Gemini wins on features and overall score.', model: 'deepseek/deepseek-chat' },
    ]);
  });
});

// ─── Preview body (?previewBody=1, dev-only) ────────────────────────────────

describe('GET /api/cron/reports — previewBody=1', () => {
  it('returns the composed weekly email body with the friendly heading and raw footer', async () => {
    const res = await GET(makePreviewReq('weekly'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { reports: Array<{ body?: string }> };
    const body = json.reports[0].body ?? '';
    // Friendly label in the heading (matches the in-app badges)…
    expect(body).toContain('## ✨ AI executive summary (DeepSeek Chat)');
    // …and the exact raw id in the footer line.
    expect(body).toContain('Model: `deepseek/deepseek-chat`');
    expect(body).toContain('# Weekly Command Center Report');
  });

  it('returns the composed daily email body including the narration heading and footer', async () => {
    const res = await GET(makePreviewReq('daily'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      reports: Array<{ body?: string; narration?: { paragraph: string; model: string; projectIds: string[] } }>;
    };
    const body = json.reports[0].body ?? '';
    expect(body).toContain('## 🎯 Why these three matter today (DeepSeek Chat)');
    expect(body).toContain('## ✨ AI executive summary (DeepSeek Chat)');
    expect(body).toContain('Model: `deepseek/deepseek-chat`');

    // The structured narration rides along so verifiers don't need to parse prose.
    expect(json.reports[0].narration?.paragraph).toBe(
      'Fix the failing deploy first, then push your work and close the overdue task.',
    );
    expect(json.reports[0].narration?.model).toBe('deepseek/deepseek-chat');
    expect(json.reports[0].narration?.projectIds).toEqual(['p-1']);
  });

  it('omits the structured narration when the daily narration is unavailable', async () => {
    vi.mocked(narrateTopThree).mockResolvedValue(null);
    const res = await GET(makePreviewReq('daily'));
    const json = (await res.json()) as {
      reports: Array<{ narration?: { paragraph: string; model: string } | null }>;
    };
    expect(json.reports[0].narration).toBeNull();
  });

  it('omits the body from the JSON response without the flag', async () => {
    const res = await GET(makeReq('weekly'));
    const json = (await res.json()) as { reports: Array<Record<string, unknown>> };
    expect(json.reports[0].body).toBeUndefined();
  });
});

// ─── Test-mode send (?sendTest=1) ───────────────────────────────────────────

describe('GET /api/cron/reports — sendTest=1', () => {
  it('delivers via the Resend test/sandbox path and returns the test emailId', async () => {
    const res = await GET(makeSendTestReq('daily'));
    expect(res.status).toBe(200);
    // sendReportEmail was called with the test option so it uses the sandbox
    // recipient instead of REPORT_EMAIL.
    expect(sendReportEmail).toHaveBeenCalledTimes(1);
    expect(sendReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'daily', title: expect.any(String) }),
      { test: true },
    );
    const json = (await res.json()) as {
      reports: Array<{ email: { sent: boolean; emailId?: string; reason?: string } }>;
    };
    expect(json.reports[0].email.sent).toBe(true);
    expect(json.reports[0].email.emailId).toBe('email-1');
  });
});

// ─── Activity logging (Firestore) ───────────────────────────────────────────

describe('GET /api/cron/reports — activity logging', () => {
  it('writes a report_generated activity doc with the emailId when Firestore admin is configured', async () => {
    vi.mocked(isFirestoreAdminConfigured).mockReturnValue(true);
    await GET(makeReq('daily'));

    expect(firestoreUpsert).toHaveBeenCalledTimes(1);
    const [collection, row] = vi.mocked(firestoreUpsert).mock.calls[0] as [string, Record<string, unknown>];
    expect(collection).toBe('activity');
    expect(row.kind).toBe('report_generated');
    expect(row.userId).toBe('demo-user');
    expect(String(row.message)).toContain('daily report');
    expect(String(row.message)).toContain('email-1');
  });

  it('does not touch Firestore when the service account is unconfigured', async () => {
    await GET(makeReq('weekly'));
    expect(firestoreUpsert).not.toHaveBeenCalled();
  });
});

// ─── Plain-text email preview (?previewBody=1&format=text) ───────────────────

describe('GET /api/cron/reports — plain-text email preview (format=text)', () => {
  it('returns the composed daily body as text/plain without sending email', async () => {
    const res = await GET(makeTextPreviewReq('daily'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('# Daily Command Center Report');
    expect(text).toContain('## ✨ AI executive summary (DeepSeek Chat)');
    expect(text).toContain('## 🎯 Why these three matter today (DeepSeek Chat)');
    // The dev-only preview must NOT touch the real inbox.
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it('returns the composed weekly body as text/plain', async () => {
    const res = await GET(makeTextPreviewReq('weekly'));
    const text = await res.text();
    expect(text).toContain('# Weekly Command Center Report');
    expect(text).toContain('## ✨ AI executive summary (DeepSeek Chat)');
    expect(text).not.toContain('Why these three matter today');
    expect(sendReportEmail).not.toHaveBeenCalled();
  });

  it('still requires the CRON_SECRET bearer (401 without auth)', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/cron/reports?kind=daily&previewBody=1&format=text', { headers: {} }),
    );
    expect(res.status).toBe(401);
  });
});
