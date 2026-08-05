import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActivityEntry } from '../../types';

let mockActivity: ActivityEntry[];
let mockActivityLive: boolean;

vi.mock('@/lib/store', () => ({
  useStore: () => ({ activity: mockActivity, activityLive: mockActivityLive }),
}));

import ActivityPage from './page';

const entry = (
  id: string,
  kind: ActivityEntry['kind'],
  message: string,
  createdAt = '2026-08-04T10:00:00.000Z',
): ActivityEntry => ({ id, userId: 'demo-user', kind, message, createdAt });

describe('ActivityPage — Deliveries filter', () => {
  beforeEach(() => {
    mockActivityLive = true;
    mockActivity = [
      entry('a1', 'report_generated', 'daily report "Daily Report — Aug 4" emailed (email-1)', '2026-08-04T09:00:00.000Z'),
      entry('a2', 'report_generated', 'retried: daily report "Daily Report — Aug 4" emailed (email-2)', '2026-08-04T10:00:00.000Z'),
      entry('a3', 'report_generated', 'weekly report "Weekly Report — Aug 4" email skipped: RESEND_API_KEY not set', '2026-08-04T11:00:00.000Z'),
      entry('a4', 'project_created', 'Project "Classic Chef" created', '2026-08-04T12:00:00.000Z'),
    ];
  });

  it('renders the flat All feed by default', () => {
    render(<ActivityPage />);
    expect(screen.getByText('Project "Classic Chef" created')).toBeTruthy();
    expect(screen.getByText('daily report "Daily Report — Aug 4" emailed (email-1)')).toBeTruthy();
  });

  it('groups deliveries into per-report timelines with emailIds and retry transitions', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));

    // Both reports grouped; the non-delivery entry is hidden.
    expect(screen.getByRole('heading', { name: 'Daily Report — Aug 4' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Weekly Report — Aug 4' })).toBeTruthy();
    expect(screen.queryByText('Project "Classic Chef" created')).toBeNull();

    // Two attempts for the daily report: emailIds visible, retry flagged.
    expect(screen.getByText('email-1')).toBeTruthy();
    expect(screen.getByText('email-2')).toBeTruthy();
    expect(screen.getByText('retry')).toBeTruthy();

    // Weekly report shows the skipped reason.
    expect(screen.getByText('RESEND_API_KEY not set')).toBeTruthy();
  });

  it('shows an empty state when there are no deliveries', () => {
    mockActivity = [entry('a4', 'project_created', 'Project "Classic Chef" created')];
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    expect(screen.getByText('No deliveries yet')).toBeTruthy();
  });

  it('does not warn when the live activity feed is connected', () => {
    render(<ActivityPage />);
    expect(screen.queryByText('Live activity feed is not connected')).toBeNull();
  });

  it('warns when /api/activity is not configured (local-only feed)', () => {
    mockActivityLive = false;
    render(<ActivityPage />);
    expect(screen.getByText('Live activity feed is not connected')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Integration setup' })).toBeTruthy();
  });
});
