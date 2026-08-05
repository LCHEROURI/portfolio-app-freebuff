import { describe, it, expect } from 'vitest';

import { parseReportDelivery, groupReportDeliveries } from '../lib/reportDeliveries';
import type { ActivityEntry } from '../types';

const entry = (
  id: string,
  message: string,
  createdAt = '2026-08-04T10:00:00.000Z',
): ActivityEntry => ({
  id, userId: 'demo-user', kind: 'report_generated', message, createdAt,
});

describe('parseReportDelivery', () => {
  it('parses a sent delivery with its emailId', () => {
    expect(parseReportDelivery('daily report "Daily Report — Aug 4" emailed (email-1)')).toEqual({
      kind: 'daily', title: 'Daily Report — Aug 4', status: 'sent',
      emailId: 'email-1', test: false, isRetry: false,
    });
  });

  it('parses a retried delivery (retry flag + emailId)', () => {
    expect(parseReportDelivery('retried: daily report "Daily Report — Aug 4" emailed (email-2)')).toMatchObject({
      status: 'sent', emailId: 'email-2', isRetry: true,
    });
  });

  it('parses a skipped delivery with its reason', () => {
    expect(parseReportDelivery('weekly report "Weekly Report — Aug 4" email skipped: RESEND_API_KEY not set')).toEqual({
      kind: 'weekly', title: 'Weekly Report — Aug 4', status: 'skipped',
      reason: 'RESEND_API_KEY not set', isRetry: false,
    });
  });

  it('parses the cron failure path (email <reason> without a colon)', () => {
    expect(parseReportDelivery('daily report "Daily Report — Aug 4" email Resend error 401')).toEqual({
      kind: 'daily', title: 'Daily Report — Aug 4', status: 'failed',
      reason: 'Resend error 401', isRetry: false,
    });
  });

  it('parses a test-mode (sandbox) send', () => {
    expect(parseReportDelivery('weekly report "Weekly Report — Aug 4" emailed (re_abc123) [test]')).toMatchObject({
      status: 'sent', emailId: 're_abc123', test: true, isRetry: false,
    });
  });

  it('keeps the retried skip path intact', () => {
    expect(parseReportDelivery('retried: daily report "Daily Report — Aug 4" email skipped: still down')).toMatchObject({
      status: 'skipped', reason: 'still down', isRetry: true,
    });
  });

  it('returns null for non-delivery or unparseable messages', () => {
    expect(parseReportDelivery('Project "Classic Chef" updated')).toBeNull();
    expect(parseReportDelivery('')).toBeNull();
    expect(parseReportDelivery('weekly report')).toBeNull();
  });
});

describe('groupReportDeliveries', () => {
  it('groups attempts of the same report into one chronological timeline', () => {
    const groups = groupReportDeliveries([
      entry('a1', 'daily report "Daily Report — Aug 4" emailed (email-1)', '2026-08-04T10:00:00.000Z'),
      entry('a2', 'daily report "Daily Report — Aug 4" email skipped: RESEND_API_KEY not set', '2026-08-04T09:00:00.000Z'),
      entry('a3', 'retried: daily report "Daily Report — Aug 4" emailed (email-3)', '2026-08-04T11:00:00.000Z'),
    ]);

    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.title).toBe('Daily Report — Aug 4');
    expect(g.attempts.map((a) => a.status)).toEqual(['skipped', 'sent', 'sent']);
    expect(g.attempts.map((a) => a.emailId).filter(Boolean)).toEqual(['email-1', 'email-3']);
    expect(g.latest.status).toBe('sent');
    expect(g.sentCount).toBe(2);
  });

  it('separates different reports into distinct timelines, ordered by latest attempt', () => {
    const groups = groupReportDeliveries([
      entry('a1', 'daily report "Daily Report — Aug 4" emailed (email-1)', '2026-08-04T09:00:00.000Z'),
      entry('a2', 'weekly report "Weekly Report — Aug 4" emailed (email-2)', '2026-08-04T11:00:00.000Z'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.title)).toEqual(['Weekly Report — Aug 4', 'Daily Report — Aug 4']);
  });

  it('orders reports by their latest attempt, newest first', () => {
    const groups = groupReportDeliveries([
      entry('a1', 'daily report "Old report" emailed (email-1)', '2026-08-01T10:00:00.000Z'),
      entry('a2', 'weekly report "Fresh report" emailed (email-2)', '2026-08-04T10:00:00.000Z'),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Fresh report', 'Old report']);
  });

  it('ignores non-report_generated and unparseable entries', () => {
    const groups = groupReportDeliveries([
      entry('a1', 'Project "Classic Chef" updated'),
      { ...entry('a2', 'daily report "Daily Report — Aug 4" emailed (email-1)'), kind: 'project_created' as const },
      entry('a3', 'daily report "Daily Report — Aug 4" emailed (email-1)'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].attempts).toHaveLength(1);
  });
});
