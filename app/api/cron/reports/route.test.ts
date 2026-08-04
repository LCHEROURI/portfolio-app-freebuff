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

vi.mock('@/lib/openrouter', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/openrouter')>();
  return {
    ...mod,
    summarizeReport: vi.fn(async () => ({ summary: 'Executive summary text.', model: 'deepseek/deepseek-chat' })),
    narrateTopThree: vi.fn(),
  };
});

import { GET } from './route';
import { loadLiveSnapshot } from '@/lib/server/reporting/data';
import { sendReportEmail } from '@/lib/server/reporting/email';
import { narrateTopThree } from '@/lib/openrouter';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A snapshot that yields exactly three top-three actions: a failing prod deploy,
 *  an unpushed repo, and an overdue task. */
const snapshotWithTopThree: LiveSnapshot = {
  userId: 'demo-user',
  configured: { supabase: true, github: true, deployments: true },
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

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  vi.mocked(loadLiveSnapshot).mockResolvedValue(snapshotWithTopThree);
  vi.mocked(narrateTopThree).mockResolvedValue({
    paragraph: 'Fix the failing deploy first, then push your work and close the overdue task.',
    model: 'deepseek/deepseek-chat',
    projectIds: ['p-1'],
  });
  vi.mocked(sendReportEmail).mockClear();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
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
