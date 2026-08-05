// ============================================================================
// Friendly Firebase auth error mapping.
// The bare Firebase errors ("Firebase: Error (auth/xxx).") are developerese;
// the AuthGate maps the common ones to human guidance — and for
// auth/unauthorized-domain (the Firebase console's Authorized domains gate)
// it produces an actionable message with a deep link to the exact console
// settings page so the fix is one click, not a search.
// ============================================================================

/** Extract the auth/<code> from a Firebase error, or null when absent. */
export const authErrorCode = (err: unknown): string | null => {
  if (typeof err === 'object' && err && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code.replace(/^auth\//, '');
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = /\(auth\/([a-z0-9-]+)\)/.exec(msg);
  return m ? m[1] : null;
};

export const authErrorMessage = (err: unknown, origin?: string): string => {
  const code = authErrorCode(err);
  switch (code) {
    case 'unauthorized-domain':
      return origin
        ? `Sign-in is blocked: ${origin} is not in this Firebase project's authorized domains.`
        : 'Sign-in is blocked — this site is not in the Firebase project\u2019s authorized domains.';
    case 'invalid-credential':
    case 'wrong-password':
    case 'user-not-found':
      return 'Those credentials do not match our records.';
    case 'too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'operation-not-allowed':
      return 'Email/password sign-in is not enabled for this Firebase project.';
    case 'popup-closed-by-user':
      return 'The Google sign-in popup was closed before finishing.';
    case 'email-already-in-use':
      return 'An account with this email already exists — try signing in instead.';
    case 'weak-password':
      return 'Password should be at least 6 characters.';
    default:
      return err instanceof Error ? err.message.replace('Firebase: ', '') : 'Authentication failed.';
  }
};

/** Deep link to the Firebase console page where the fix lives, when one exists. */
export const authConsoleUrl = (code: string | null, projectId?: string): string | null => {
  if (code !== 'unauthorized-domain' || !projectId) return null;
  return `https://console.firebase.google.com/project/${projectId}/authentication/settings`;
};
