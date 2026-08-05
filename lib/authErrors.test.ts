import { describe, it, expect } from 'vitest';

import { authErrorMessage, authErrorCode, authConsoleUrl } from '../lib/authErrors';

describe('authErrorCode', () => {
  it('extracts the code from a Firebase-style error message', () => {
    expect(authErrorCode(new Error('Firebase: Error (auth/unauthorized-domain).'))).toBe('unauthorized-domain');
  });

  it('extracts the code from a structured Firebase error object', () => {
    expect(authErrorCode({ code: 'auth/invalid-credential' })).toBe('invalid-credential');
  });

  it('returns null when no code is present', () => {
    expect(authErrorCode(new Error('Network error'))).toBeNull();
    expect(authErrorCode('plain string')).toBeNull();
  });
});

describe('authErrorMessage', () => {
  it('names the offending origin for unauthorized-domain', () => {
    expect(authErrorMessage(new Error('Firebase: Error (auth/unauthorized-domain).'), 'https://portfolio-app-freebuff.vercel.app'))
      .toContain('portfolio-app-freebuff.vercel.app');
    expect(authErrorMessage(new Error('Firebase: Error (auth/unauthorized-domain).'), 'https://portfolio-app-freebuff.vercel.app'))
      .toContain('authorized domains');
  });

  it('falls back gracefully when the origin is unknown', () => {
    const msg = authErrorMessage(new Error('Firebase: Error (auth/unauthorized-domain).'));
    expect(msg).toContain('authorized domains');
  });

  it('maps the common credential errors to friendly text', () => {
    expect(authErrorMessage(new Error('Firebase: Error (auth/invalid-credential).'))).toContain('do not match');
    expect(authErrorMessage(new Error('Firebase: Error (auth/user-not-found).'))).toContain('do not match');
    expect(authErrorMessage(new Error('Firebase: Error (auth/too-many-requests).'))).toContain('later');
  });

  it('passes through unknown errors with the Firebase: prefix stripped', () => {
    expect(authErrorMessage(new Error('Firebase: Error (auth/network-request-failed).'))).toContain('(auth/network-request-failed)');
    expect(authErrorMessage(new Error('Firebase: Error (auth/network-request-failed).'))).not.toContain('Firebase:');
  });
});

describe('authConsoleUrl', () => {
  it('deep-links to the authorized-domains settings page', () => {
    expect(authConsoleUrl('unauthorized-domain', 'portfolio-app-freebuff2')).toBe(
      'https://console.firebase.google.com/project/portfolio-app-freebuff2/authentication/settings',
    );
  });

  it('returns null for other codes or a missing project id', () => {
    expect(authConsoleUrl('invalid-credential', 'portfolio-app-freebuff2')).toBeNull();
    expect(authConsoleUrl('unauthorized-domain', undefined)).toBeNull();
  });
});
