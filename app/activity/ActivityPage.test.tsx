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

describe('ActivityPage', () => {
  beforeEach(() => {
    mockActivityLive = true;
    mockActivity = [
      entry('a1', 'report_generated', 'daily report "Daily Report — Aug 4" generated (emailing disabled)', '2026-08-04T09:00:00.000Z'),
      entry('a2', 'project_created', 'Project "Classic Chef" created', '2026-08-04T12:00:00.000Z'),
    ];
  });

  it('renders the flat All feed by default', () => {
    render(<ActivityPage />);
    expect(screen.getByText('Project "Classic Chef" created')).toBeTruthy();
    expect(screen.getByText('daily report "Daily Report — Aug 4" generated (emailing disabled)')).toBeTruthy();
  });

  it('filters the feed by kind chip', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(screen.getByText('Project "Classic Chef" created')).toBeTruthy();
    expect(screen.queryByText('daily report "Daily Report — Aug 4" generated (emailing disabled)')).toBeNull();
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
