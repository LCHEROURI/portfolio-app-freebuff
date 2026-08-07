import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPage from './page';
import type { UserProfile } from '@/types';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// Settings reads profile + saveProfile from the store, plus auth + firebase
// gating. Stub all three so the page renders in demo mode (no account card).
// `profileSeed.aiModel` lets a test simulate a previously saved preference so
// the form prefill can be asserted.
const savedProfile: Partial<UserProfile> = {};
let profileSeed: { aiModel?: string } = {};

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    mode: 'demo',
    userId: 'e2e-user',
    profile: {
      id: 'e2e-user', name: 'E2E', timezone: 'UTC',
      dailyReportEnabled: true, dailyReportTime: '07:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '07:00',
      defaultStaleDays: 7, ...profileSeed,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    },
    saveProfile: async (p: UserProfile) => { Object.assign(savedProfile, p); },
    signOut: async () => {},
    hasLocalDemoData: false,
    migrationDismissed: true,
    dismissLocalDemoMigrate: () => {},
    resetDemo: async () => {},
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
}));

beforeEach(() => {
  savedProfile.aiModel = undefined;
  profileSeed = {};
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SettingsPage — AI summaries', () => {
  it('renders the AI summaries section with a model id field', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'AI summaries' })).toBeInTheDocument();
    // Field wraps the input in a <label> together with its hint, so match by regex.
    expect(screen.getByLabelText(/OpenRouter model id/)).toBeInTheDocument();
  });

  it('prefills the field from a previously saved preference', () => {
    profileSeed = { aiModel: 'anthropic/claude-3.5-sonnet' };
    render(<SettingsPage />);
    expect(screen.getByLabelText(/OpenRouter model id/)).toHaveValue('anthropic/claude-3.5-sonnet');
  });

  it('saves the per-user model preference through saveProfile', async () => {
    render(<SettingsPage />);
    const input = screen.getByLabelText(/OpenRouter model id/);
    fireEvent.change(input, { target: { value: 'anthropic/claude-3.5-sonnet' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => expect(savedProfile.aiModel).toBe('anthropic/claude-3.5-sonnet'));
  });

  it('persists an empty model as clearing the preference (env default)', async () => {
    savedProfile.aiModel = 'deepseek/deepseek-chat';
    render(<SettingsPage />);
    const input = screen.getByLabelText(/OpenRouter model id/);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/ }));

    await waitFor(() => expect(savedProfile.aiModel).toBe(''));
  });
});
