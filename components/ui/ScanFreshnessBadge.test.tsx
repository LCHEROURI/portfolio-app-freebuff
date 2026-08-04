import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScanFreshnessBadge } from './ScanFreshnessBadge';

afterEach(() => {
  vi.useRealTimers();
});

const clock = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString();

describe('ScanFreshnessBadge', () => {
  it('shows the exact capture timestamp and hours-old in the tooltip', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
    const scanned = clock(2 * 3_600_000); // 2 hours ago

    render(<ScanFreshnessBadge scannedAt={scanned} />);

    const badge = screen.getByText('scanned 2h ago');
    // Tooltip carries the precise clock time plus whole hours+minutes old.
    expect(badge.closest('span')).toHaveAttribute('title', expect.stringContaining('Scanned '));
    expect(badge.closest('span')).toHaveAttribute('title', expect.stringContaining('2h old'));
  });

  it('flags stale scans with an out-of-date warning in the tooltip', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
    const scanned = clock(3 * 86_400_000); // 3 days ago

    render(<ScanFreshnessBadge scannedAt={scanned} />);

    const badge = screen.getByText('stale scan · 3d ago');
    // The tooltip shows the exact clock time, the hours-old figure, and the
    // stale warning — not the coarse '3d ago' badge label.
    expect(badge.closest('span')).toHaveAttribute('title', expect.stringContaining('Aug 1, 2026'));
    expect(badge.closest('span')).toHaveAttribute('title', expect.stringContaining('72h old'));
    expect(badge.closest('span')).toHaveAttribute('title', expect.stringContaining('out of date'));
  });
});
