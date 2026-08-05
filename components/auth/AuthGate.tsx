'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { authConsoleUrl, authErrorCode, authErrorMessage } from '@/lib/authErrors';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { VercelEnvSettingsLink } from '@/components/integrations/VercelEnvSettingsLink';

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
  </svg>
);

export const AuthGate = () => {
  const { signIn, signUp, signInWithGoogle, sendPasswordReset } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [view, setView] = useState<'auth' | 'reset'>('auth');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The origin the page is served from — the value Firebase's Authorized
  // domains gate compares against. Computed client-side so the error message
  // names the exact domain that needs adding.
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;

  const showError = (err: unknown) => {
    setError(authErrorMessage(err, origin));
    setErrorCode(authErrorCode(err));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const onReset = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setResetSent(false);
    try {
      await sendPasswordReset(resetEmail);
      setResetSent(true);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  // Start reset with the email already typed into the sign-in form, when present.
  const openReset = () => {
    if (!resetEmail && email) setResetEmail(email);
    setError(null);
    setErrorCode(null);
    setResetSent(false);
    setView('reset');
  };

  const consoleUrl = authConsoleUrl(errorCode, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const ErrorBanner = ({ children }: { children: ReactNode }) => (
    <div
      className="rounded-lg border border-paprika-200 bg-paprika-50 px-3 py-2 text-xs font-medium text-paprika-700 dark:border-paprika-800 dark:bg-paprika-950 dark:text-paprika-300"
      role="alert"
    >
      {children}
      {consoleUrl && (
        <span className="mt-1.5 block">
          <a
            href={consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-tomato-600 underline underline-offset-2 hover:text-tomato-700 dark:text-tomato-300"
          >
            Open Firebase → Authentication → Authorized domains ↗
          </a>
          <span className="mt-0.5 block font-normal text-paprika-600 dark:text-paprika-300">
            Add {origin} to the list and Save — no redeploy needed.
          </span>
        </span>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-flour-50 px-4 py-8 dark:bg-pepper-900">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl2 bg-gradient-spice text-white shadow-warm">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-pepper-900 dark:text-flour-50">App Portfolio Command Center</h1>
            <p className="mt-1 text-sm text-pepper-500 dark:text-pepper-300">
              Sign in to sync every AI-built implementation of your app concept.
            </p>
          </div>
        </div>

        <Card>
          {view === 'reset' ? (
            <form className="space-y-4" onSubmit={onReset} noValidate>
              <div>
                <h2 className="text-base font-semibold text-pepper-900 dark:text-flour-50">Reset Password</h2>
                <p className="mt-1 text-sm text-pepper-500 dark:text-pepper-300">
                  Enter your account email and we&apos;ll send you a link to set a new password.
                </p>
              </div>

              <Field label="Email">
                <Input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                />
              </Field>

              {resetSent && (
                <p
                  className="rounded-lg border border-basil-200 bg-basil-50 px-3 py-2 text-xs font-medium text-basil-700 dark:border-basil-800 dark:bg-basil-950 dark:text-basil-300"
                  role="status"
                >
                  Password reset link sent! Please check your inbox.
                </p>
              )}

              {error && <ErrorBanner>{error}</ErrorBanner>}

              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                Send Reset Link
              </button>

              <button
                type="button"
                className="btn-ghost w-full text-sm"
                onClick={() => { setView('auth'); setError(null); }}
                disabled={busy}
              >
                ← Back to Sign In
              </button>
            </form>
          ) : (
          <>
          <div className="mb-4 flex gap-1 rounded-lg bg-butter-100 p-1 dark:bg-pepper-700">
            {([
              { key: 'signin', label: 'Sign in' },
              { key: 'signup', label: 'Create account' },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setMode(t.key); setError(null); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === t.key
                    ? 'bg-white text-pepper-900 shadow-sm dark:bg-pepper-600 dark:text-flour-50'
                    : 'text-pepper-500 hover:text-pepper-700 dark:text-pepper-300 dark:hover:text-flour-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            {mode === 'signup' && (
              <Field label="Display name">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Chef Labs"
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </Field>

            {mode === 'signin' && (
              <div className="-mt-1 text-right">
                <button
                  type="button"
                  className="text-sm font-medium text-sage-700 underline-offset-2 hover:underline dark:text-sage-400"
                  onClick={openReset}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-2 text-xs text-pepper-400 dark:text-pepper-500">
            <span className="h-px flex-1 bg-butter-200 dark:bg-pepper-700" aria-hidden="true" />
            <span className="uppercase tracking-wider font-semibold">Or</span>
            <span className="h-px flex-1 bg-butter-200 dark:bg-pepper-700" aria-hidden="true" />
          </div>

          <button type="button" className="btn-secondary w-full" onClick={onGoogle} disabled={busy}>
            <GoogleMark /> Continue with Google
          </button>

          <p className="mt-4 text-center text-xs text-pepper-400 dark:text-pepper-400">
            Your data is isolated per account and synced to Firestore.
          </p>

          <div className="mt-4 border-t border-butter-200 pt-3 text-center dark:border-pepper-700">
            <VercelEnvSettingsLink label="Wire live integrations — open Vercel env settings" />
          </div>
          </>
          )}
        </Card>
      </div>
    </div>
  );
};
