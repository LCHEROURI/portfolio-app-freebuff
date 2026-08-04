import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from './AppLayout';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The drawer's open state lives in AppLayout and is passed down to the real
// Sidebar. Stub the heavy consumers (store, auth, theme, status widget) and
// control usePathname so a route change can be simulated without navigation.
let pathname = '/command-center';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('@/lib/store', () => ({
  useStore: () => ({
    mode: 'demo',
    profile: { name: 'Demo Cook' },
    hasLocalDemoData: false,
    migrationDismissed: false,
    migrateLocalDemo: vi.fn(async () => 0),
    dismissLocalDemoMigrate: vi.fn(),
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null, signOut: vi.fn(async () => {}) }),
}));

vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/components/layout/ConnectionStatusWidget', () => ({
  ConnectionStatusWidget: () => <div data-testid="status-widget" />,
}));

// The drawer's visual state is the aside's transform: translate-x-0 = open,
// -translate-x-full = closed (off-canvas). The aside also carries the
// lg:translate-x-0 desktop override, so pick out only the two state classes.
const drawerState = (): 'open' | 'closed' => {
  const aside = screen.getByRole('complementary', { name: 'Primary navigation' });
  return aside.className.includes('-translate-x-full') ? 'closed' : 'open';
};

beforeEach(() => {
  pathname = '/command-center';
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AppLayout — mobile drawer', () => {
  it('starts closed and opens via the menu button, then closes via the X button', () => {
    render(<AppLayout>content</AppLayout>);
    expect(drawerState()).toBe('closed');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawerState()).toBe('open');

    // Close via the in-drawer X button.
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(drawerState()).toBe('closed');
  });

  it('resets the drawer to closed when the route changes without a close click', () => {
    const { rerender } = render(<AppLayout>content</AppLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(drawerState()).toBe('open');

    // A link rendered outside the sidebar (project detail, cited link, queue
    // item) navigates without calling onClose. The drawer must still reset.
    pathname = '/projects/p-demo-bpvxx';
    rerender(<AppLayout>content</AppLayout>);

    expect(drawerState()).toBe('closed');
  });

  it('stays closed across route changes when it was never opened', () => {
    const { rerender } = render(<AppLayout>content</AppLayout>);
    expect(drawerState()).toBe('closed');

    pathname = '/repositories';
    rerender(<AppLayout>content</AppLayout>);

    expect(drawerState()).toBe('closed');
  });

  it('renders its children alongside the shell', () => {
    render(<AppLayout><p>Hello page</p></AppLayout>);
    expect(screen.getByText('Hello page')).toBeInTheDocument();
  });
});
