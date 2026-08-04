import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthGate } from './AuthGate';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// AuthGate consumes the auth context only for the email/password actions. Stub
// the whole module so the reset flow can be asserted without a Firebase setup.
const authApi = {
  mode: 'firebase' as const,
  user: null,
  initializing: false,
  signIn: vi.fn(async () => {}),
  signUp: vi.fn(async () => {}),
  signInWithGoogle: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  sendPasswordReset: vi.fn(async () => {}),
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => authApi,
}));

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AuthGate — forgot password flow', () => {
  it('shows the Forgot password? link below the password field in sign-in mode', () => {
    render(<AuthGate />);
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
  });

  it('hides the Forgot password? link in sign-up mode', () => {
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
  });

  it('toggles to the Reset Password view, hiding the sign-in form', () => {
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByRole('heading', { name: 'Reset Password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Sign In/ })).toBeInTheDocument();
    // The standard form is hidden in the reset view.
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('prefills the reset email from the email already typed in sign-in', () => {
    render(<AuthGate />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'chef@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.getByPlaceholderText('you@example.com')).toHaveValue('chef@example.com');
  });

  it('calls sendPasswordReset with the entered email on submit', async () => {
    authApi.sendPasswordReset.mockClear();
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'chef@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => expect(authApi.sendPasswordReset).toHaveBeenCalledWith('chef@example.com'));
  });

  it('shows a success message after the link is sent', async () => {
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'chef@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(
      await screen.findByText('Password reset link sent! Please check your inbox.'),
    ).toBeInTheDocument();
  });

  it('surfaces Firebase errors in the alert banner', async () => {
    authApi.sendPasswordReset.mockRejectedValueOnce(
      new Error('Firebase: Error (auth/user-not-found).'),
    );
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Error (auth/user-not-found).');
  });

  it('returns to the sign-in view from Back to Sign In', () => {
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.click(screen.getByRole('button', { name: /Back to Sign In/ }));

    // The tab toggle and the submit button both read 'Sign in', so use the
    // plural query; the meaningful assertion is that the reset view is gone and
    // the sign-in form (submit button) is back.
    expect(screen.getAllByRole('button', { name: 'Sign in' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('heading', { name: 'Reset Password' })).not.toBeInTheDocument();
  });

  it('disables the reset button while the request is in flight', async () => {
    let release!: () => void;
    authApi.sendPasswordReset.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    render(<AuthGate />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'chef@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeDisabled();
    release();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send Reset Link' })).not.toBeDisabled();
    });
  });
});
