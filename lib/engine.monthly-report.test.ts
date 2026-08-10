import { describe, expect, it } from 'vitest';
import {
  buildMonthlyBriefingFacts, buildMonthlyReportBody, type AppState,
} from './engine';

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const baseState = (overrides: Partial<AppState> = {}): AppState => ({
  profile: {
    id: 'demo-user', name: 'Command Center', timezone: 'UTC',
    dailyReportEnabled: true, dailyReportTime: '07:00',
    weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
    defaultStaleDays: 7, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  },
  projects: [{
    id: 'p-1', userId: 'demo-user', name: 'Takeout Voice 2', slug: 'takeout-voice-2',
    description: '', category: 'app', businessGoal: '', targetCustomer: '',
    monetizationModel: '', priority: 'P1_HIGH', overallStatus: 'BUILDING',
    overallProgress: 50, nextAction: '', archived: false,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    lastActivityAt: new Date().toISOString(),
  }],
  versions: [{
    id: 'v-1', projectId: 'p-1', userId: 'demo-user', versionName: 'Gemini Build',
    builder: 'Google AI Studio', model: 'Gemini 1.5 Pro', developmentPlatform: 'web',
    status: 'BUILDING', progress: 70, branch: 'main', isWinner: false, isArchived: false,
    deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  }],
  repositories: [],
  deployments: [],
  tasks: [],
  evaluations: [],
  activity: [],
  ...overrides,
});

describe('buildMonthlyBriefingFacts — velocity', () => {
  it('lists versions with activity in the 30-day window and progress > 0', () => {
    const facts = buildMonthlyBriefingFacts(baseState());
    expect(facts.velocity).toContain('Gemini Build (Google AI Studio / Gemini 1.5 Pro) — 70%');
  });

  it('excludes versions whose last activity is older than the 30-day window', () => {
    const state = baseState({
      versions: [{
        id: 'v-1', projectId: 'p-1', userId: 'demo-user', versionName: 'Old build',
        builder: 'Codex', model: 'GPT-4o Codex', developmentPlatform: 'web',
        status: 'PAUSED', progress: 40, branch: 'main', isWinner: false, isArchived: false,
        deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
        lastActivityAt: isoDaysAgo(45),
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      }],
    });
    expect(buildMonthlyBriefingFacts(state).velocity).toEqual([]);
  });

  it('excludes versions with zero progress even when active', () => {
    const state = baseState({
      versions: [{
        id: 'v-1', projectId: 'p-1', userId: 'demo-user', versionName: 'Stalled',
        builder: 'Codex', model: 'GPT-4o Codex', developmentPlatform: 'web',
        status: 'CONCEPT', progress: 0, branch: 'main', isWinner: false, isArchived: false,
        deploymentIds: [], estimatedCost: 0, actualCost: 0, developmentHours: 0,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      }],
    });
    expect(buildMonthlyBriefingFacts(state).velocity).toEqual([]);
  });
});

describe('buildMonthlyBriefingFacts — winner trends', () => {
  const evalRow = (id: string, model: string, score: number, evaluatedAt: string) => ({
    id, userId: 'demo-user', projectId: 'p-1', projectVersionId: 'v-1',
    builder: 'x', model,
    uiScore: 8, featureScore: 8, codeQualityScore: 8, stabilityScore: 8,
    performanceScore: 8, maintainabilityScore: 8, mobileScore: 8, accessibilityScore: 8,
    developmentSpeedScore: 8, costScore: 8, overallScore: score,
    evaluatedAt, createdAt: evaluatedAt, updatedAt: evaluatedAt,
  });

  it('ranks the leading model by best score in the window', () => {
    const state = baseState({
      evaluations: [
        evalRow('e-1', 'deepseek/deepseek-chat', 9.1, new Date().toISOString()),
        evalRow('e-2', 'openai/gpt-4.1', 7.8, new Date().toISOString()),
      ],
    });
    const facts = buildMonthlyBriefingFacts(state);
    expect(facts.leadingModel).toBe('DeepSeek Chat (best 9.1/10)');
    expect(facts.trends[0]).toContain('DeepSeek Chat — best 9.1/10');
    expect(facts.trends[0]).toContain('avg 9.1/10 across 1 evaluation(s)');
  });

  it('ignores evaluations older than the 30-day window', () => {
    const state = baseState({
      evaluations: [evalRow('e-old', 'deepseek/deepseek-chat', 9.9, isoDaysAgo(60))],
    });
    const facts = buildMonthlyBriefingFacts(state);
    expect(facts.leadingModel).toBeNull();
    expect(facts.trends).toEqual([]);
  });
});

describe('buildMonthlyBriefingFacts — backlog drift', () => {
  it('flags open tasks created before the window as drifted', () => {
    const state = baseState({
      tasks: [{
        id: 't-1', userId: 'demo-user', projectId: 'p-1', title: 'Aging task',
        status: 'NEXT', priority: 'P1_HIGH', taskType: 'FEATURE', position: 0,
        createdAt: isoDaysAgo(50), updatedAt: isoDaysAgo(50),
      }],
    });
    const facts = buildMonthlyBriefingFacts(state);
    expect(facts.drift[0]).toContain('1 open task(s) stale or overdue');
    expect(facts.drift.join(' ')).toContain('Aging task');
  });

  it('flags overdue tasks even when created in the window', () => {
    const state = baseState({
      tasks: [{
        id: 't-1', userId: 'demo-user', projectId: 'p-1', title: 'Overdue task',
        status: 'IN_PROGRESS', priority: 'P1_HIGH', taskType: 'FEATURE', position: 0,
        dueDate: isoDaysAgo(3), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
    });
    const facts = buildMonthlyBriefingFacts(state);
    expect(facts.drift[0]).toContain('1 open task(s) stale or overdue');
  });

  it('excludes completed tasks from the drift count', () => {
    const state = baseState({
      tasks: [{
        id: 't-1', userId: 'demo-user', projectId: 'p-1', title: 'Done task',
        status: 'COMPLETED', priority: 'P1_HIGH', taskType: 'FEATURE', position: 0,
        completedAt: isoDaysAgo(2), createdAt: isoDaysAgo(50), updatedAt: isoDaysAgo(2),
      }],
    });
    const facts = buildMonthlyBriefingFacts(state);
    expect(facts.drift[0]).toContain('0 open task(s) stale or overdue');
  });
});

describe('buildMonthlyReportBody', () => {
  it('composes the full monthly report with the deterministic sections', () => {
    const report = buildMonthlyReportBody(baseState());
    expect(report.title).toContain('Monthly Report');
    expect(report.body).toContain('# Monthly Command Center Report');
    expect(report.body).toContain('## Velocity — what advanced this month');
    expect(report.body).toContain('## Winner trends — model performance this month');
    expect(report.body).toContain('## Backlog drift');
    expect(report.body).toContain('## Priority queue');
    expect(report.attentionCount).toBeGreaterThanOrEqual(0);
  });

  it('carries the leading-model line and drift facts into the body', () => {
    const state = baseState({
      evaluations: [{
        id: 'e-1', userId: 'demo-user', projectId: 'p-1', projectVersionId: 'v-1',
        builder: 'x', model: 'deepseek/deepseek-chat',
        uiScore: 8, featureScore: 8, codeQualityScore: 8, stabilityScore: 8,
        performanceScore: 8, maintainabilityScore: 8, mobileScore: 8, accessibilityScore: 8,
        developmentSpeedScore: 8, costScore: 8, overallScore: 9.2,
        evaluatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
    });
    const report = buildMonthlyReportBody(state);
    expect(report.body).toContain('**Leading model this month:** DeepSeek Chat (best 9.2/10).');
  });
});
