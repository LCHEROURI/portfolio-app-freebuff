import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { VarCopyButton } from './VarCopyButton';

// ─── Fixtures / clipboard mock ──────────────────────────────────────────────

let clipboardText: string | null = null;

beforeEach(() => {
  clipboardText = null;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async (t: string) => { clipboardText = t; }) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('VarCopyButton', () => {
  it('copies the exact .env.example line on click', async () => {
    render(<VarCopyButton name="GITHUB_TOKEN" />);
    const btn = screen.getByRole('button', { name: 'Copy GITHUB_TOKEN=<github_pat_...>' });
    fireEvent.click(btn);
    expect(clipboardText).toBe('GITHUB_TOKEN=<github_pat_...>');
  });

  it('flips its aria-label to Copied after a successful copy', async () => {
    render(<VarCopyButton name="SUPABASE_URL" />);
    const btn = screen.getByRole('button', { name: 'Copy SUPABASE_URL=https://<project-ref>.supabase.co' });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute('aria-label')).toBe('Copied SUPABASE_URL=https://<project-ref>.supabase.co');
    });
  });

  it('renders nothing for vars without an env line (invent-yourself values)', () => {
    const { container } = render(<VarCopyButton name="CRON_SECRET" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a Firefox-style copy icon that stays aria-hidden', () => {
    render(<VarCopyButton name="VERCEL_TOKEN" />);
    const btn = screen.getByRole('button', { name: 'Copy VERCEL_TOKEN=<token>' });
    const icon = btn.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });
});
