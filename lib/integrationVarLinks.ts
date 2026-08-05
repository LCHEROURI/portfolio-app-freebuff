// ============================================================================
// Per-var credential source pages for the Integrations setup checklists.
//
// Each missing required env var deep-links to the exact page where its value
// lives (GitHub token page, Vercel token page, Firebase console project),
// alongside the existing Vercel env-settings link. Vars without a dedicated
// source page (CRON_SECRET, REPORT_EMAIL, GITHUB_OWNER — values you invent
// or copy from your own account) intentionally render as plain text.
//
// Firebase deep-links to the exact project when NEXT_PUBLIC_FIREBASE_PROJECT_ID
// is set (it's a NEXT_PUBLIC_ var, so it is available client-side when
// configured); otherwise it falls back to the console root (project picker).
//
// varEnvLine() pairs with the source link: it returns the .env.example
// template line to paste into Vercel (mirroring the repo's .env.example and
// the SETUP_GUIDES step blocks in app/integrations/page.tsx), so the flow is
// open the console page → copy the real value → paste it over the
// placeholder in the env line.
// ============================================================================

export interface VarSource {
  label: string;
  href: string;
}

export const firebaseConsoleUrl = (projectId?: string): VarSource =>
  projectId
    ? {
        label: 'Firebase console',
        href: `https://console.firebase.google.com/project/${projectId}/settings/general`,
      }
    : { label: 'Firebase console', href: 'https://console.firebase.google.com' };

const VAR_SOURCE_URLS: Record<string, VarSource> = {
  GITHUB_TOKEN: { label: 'GitHub token page', href: 'https://github.com/settings/personal-access-tokens/new' },
  VERCEL_TOKEN: { label: 'Vercel token page', href: 'https://vercel.com/account/tokens' },
  RESEND_API_KEY: { label: 'Resend API keys', href: 'https://resend.com/api-keys' },
};

/**
 * The page where a given env var's value lives, or null when there isn't one
 * (values you invent yourself). Firebase client-config vars all resolve to
 * the console's project settings page.
 */
export const varSourceUrl = (name: string, firebaseProjectId?: string): VarSource | null =>
  name.startsWith('NEXT_PUBLIC_FIREBASE_')
    ? firebaseConsoleUrl(firebaseProjectId)
    : VAR_SOURCE_URLS[name] ?? null;

/**
 * The source page of the first var in `names` that has one, or null when none
 * do. This is how the footer "get the token" link is derived from the same
 * per-var map as the deep-links above — the two URL sets can never drift.
 */
export const firstVarSource = (names: string[], firebaseProjectId?: string): VarSource | null => {
  for (const name of names) {
    const src = varSourceUrl(name, firebaseProjectId);
    if (src) return src;
  }
  return null;
};

// .env.example template lines for the vars that have a source page — the exact
// text to paste into Vercel (replace the <placeholder> with the real value
// from the console page).
const VAR_ENV_LINES: Record<string, string> = {
  GITHUB_TOKEN: 'GITHUB_TOKEN=<github_pat_...>',
  VERCEL_TOKEN: 'VERCEL_TOKEN=<token>',
  RESEND_API_KEY: 'RESEND_API_KEY=<key>',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'NEXT_PUBLIC_FIREBASE_API_KEY=<api-key>',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>',
};

/**
 * The .env.example line to paste for a var (placeholder included), or null
 * when there is none (values you invent yourself).
 */
export const varEnvLine = (name: string): string | null => VAR_ENV_LINES[name] ?? null;
