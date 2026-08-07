import { describe, expect, it } from 'vitest';

import { toReportDoc } from './seed-in-app-reports.mjs';

const NOW = '2026-08-06T09:30:00.000Z';

const composed = {
  kind: 'daily',
  title: 'Daily report — Wednesday 6 August 2026',
  attentionCount: 4,
  body: '# Daily report\n\nSome deterministic body text.',
  aiModel: 'deepseek/deepseek-chat',
};

describe('toReportDoc (seed-in-app-reports)', () => {
  it('maps the composed cron report to the client Report shape', () => {
    const doc = toReportDoc('demo-user', composed, NOW);
    expect(doc).toMatchObject({
      id: 'r-seed-daily-2026-08-06',
      userId: 'demo-user',
      kind: 'daily',
      title: composed.title,
      body: composed.body,
      attentionCount: 4,
      createdAt: NOW,
      aiModel: 'deepseek/deepseek-chat',
    });
  });

  it('namespaces the id per kind so daily and weekly never collide', () => {
    const daily = toReportDoc('u', { ...composed, kind: 'daily' }, NOW);
    const weekly = toReportDoc('u', { ...composed, kind: 'weekly' }, NOW);
    expect(daily.id).toBe('r-seed-daily-2026-08-06');
    expect(weekly.id).toBe('r-seed-weekly-2026-08-06');
    expect(daily.id).not.toBe(weekly.id);
  });

  it('produces a stable id for the same kind + date (idempotent re-seed)', () => {
    const a = toReportDoc('demo-user', composed, '2026-08-06T01:00:00.000Z');
    const b = toReportDoc('demo-user', composed, '2026-08-06T23:59:00.000Z');
    expect(a.id).toBe(b.id);
    expect(a.createdAt).toBe('2026-08-06T01:00:00.000Z');
    expect(b.createdAt).toBe('2026-08-06T23:59:00.000Z');
  });

  it('rolls the id to the new date on the next day so the feed grows by one per day', () => {
    const day1 = toReportDoc('demo-user', composed, '2026-08-06T09:00:00.000Z');
    const day2 = toReportDoc('demo-user', composed, '2026-08-07T09:00:00.000Z');
    expect(day1.id).toBe('r-seed-daily-2026-08-06');
    expect(day2.id).toBe('r-seed-daily-2026-08-07');
  });

  it('omits aiModel when the composed report has none (undefined is pruned at encode)', () => {
    const doc = toReportDoc('demo-user', { ...composed, aiModel: null }, NOW);
    expect(doc).not.toHaveProperty('aiModel');
  });

  it('never leaks the email envelope or structured narration into the saved doc', () => {
    const doc = toReportDoc('demo-user', {
      ...composed,
      email: { sent: false, reason: 'emailed reports disabled' },
      narration: { paragraph: 'x', model: 'deepseek/deepseek-chat' },
      winnerRecommendations: [],
      narrationModel: 'deepseek/deepseek-chat',
    }, NOW);
    expect(doc).not.toHaveProperty('email');
    expect(doc).not.toHaveProperty('narration');
    expect(doc).not.toHaveProperty('winnerRecommendations');
    expect(doc).not.toHaveProperty('narrationModel');
    // The client Report has no aiSummary field when the summary rides in-body.
    expect(doc).not.toHaveProperty('aiSummary');
  });
});
