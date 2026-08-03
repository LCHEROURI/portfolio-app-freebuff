import type { IntegrationEndpoint, IntegrationEnvVar, IntegrationStatus } from '@/lib/liveData';

// ============================================================================
// Integration connection-status checks (server-only).
//
// For each integration we report (a) which env vars are set — booleans only,
// never values — and (b) a live ping of the provider's endpoint with HTTP
// status + latency. Every check is independent, bounded by a timeout, and
// never throws: an unreachable provider degrades to a reported status.
// ============================================================================

const flagSet = (name: string): boolean => process.env[name] === '1';
const varSet = (name: string): boolean => Boolean((process.env[name] ?? '').trim());

const envVar = (name: string, required = false, flag = false): IntegrationEnvVar => ({
  name,
  set: flag ? flagSet(name) : varSet(name),
  required,
});

interface PingResult {
  status: number | null;
  ms: number;
  json: unknown;
}

const ping = async (url: string, init?: RequestInit, timeoutMs = 8000): Promise<PingResult> => {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    return { status: res.status, ms: Date.now() - start, json };
  } catch {
    return { status: null, ms: Date.now() - start, json: null };
  } finally {
    clearTimeout(timer);
  }
};

const endpoint = (r: PingResult, detail: string, okOverride?: boolean): IntegrationEndpoint => ({
  // A provider may respond 200 while its data feed is actually broken (e.g.
  // GitHub /rate_limit at remaining: 0) — callers can override `ok` for that.
  ok: okOverride ?? (r.status !== null && r.status >= 200 && r.status < 400),
  status: r.status,
  ms: r.ms,
  detail,
});

const unsetEndpoint = (): IntegrationEndpoint | null => null;

// ─── Supabase ───────────────────────────────────────────────────────────────
const checkSupabase = async (): Promise<IntegrationStatus> => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configured = Boolean(url && key);
  const env = [
    envVar('SUPABASE_URL', true),
    envVar('SUPABASE_SERVICE_ROLE_KEY', true),
    envVar('NEXT_PUBLIC_LIVE_TASKS', false, true),
    envVar('NEXT_PUBLIC_LIVE_PROJECTS', false, true),
  ];

  let ep = unsetEndpoint();
  if (configured && url) {
    const r = await ping(`${url}/rest/v1/tasks?select=id&limit=1`, {
      headers: { apikey: key as string, Authorization: `Bearer ${key}` },
    });
    const json = r.json as { code?: string; message?: string } | null;
    const detail =
      r.status === 200 ? 'Tasks table reachable'
      : r.status === 404 && json?.code === '42P01' ? 'Tables missing — run supabase/schema.sql'
      : r.status === 401 ? 'Service-role key invalid'
      : r.status === null ? 'Unreachable'
      : r.status === 404 ? `HTTP ${r.status} (${json?.message ?? 'not found'})`
      : `HTTP ${r.status}`;
    ep = endpoint(r, detail);
  }

  return {
    id: 'supabase', name: 'Supabase', enabled: flagSet('NEXT_PUBLIC_LIVE_TASKS'),
    configured, env, endpoint: ep,
  };
};

// ─── GitHub ─────────────────────────────────────────────────────────────────
const checkGithub = async (): Promise<IntegrationStatus> => {
  const token = varSet('GITHUB_TOKEN');
  const env = [
    envVar('GITHUB_TOKEN'),
    envVar('GITHUB_OWNER'),
    envVar('GITHUB_REPOS'),
    envVar('NEXT_PUBLIC_LIVE_REPOS', false, true),
  ];

  // The feed works against the public API without a token; `configured` here
  // reflects whether anything meaningful is actually set (token/owner/repos/flag)
  // so a fresh install reads honestly instead of "Configured".
  const configured =
    varSet('GITHUB_TOKEN') || varSet('GITHUB_OWNER') || varSet('GITHUB_REPOS') || flagSet('NEXT_PUBLIC_LIVE_REPOS');

  const r = await ping('https://api.github.com/rate_limit', {
    headers: token ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN as string}` } : undefined,
  });
  const json = r.json as { resources?: { core?: { remaining?: number; limit?: number } }; message?: string } | null;
  const remaining = json?.resources?.core?.remaining;
  const limit = json?.resources?.core?.limit;
  const exhausted = r.status === 200 && typeof remaining === 'number' && remaining === 0;
  const detail =
    r.status === 200 && json?.resources?.core
      ? `${token ? 'Authenticated' : 'Public API'} — ${remaining}/${limit} req/h left${exhausted ? ' (exhausted — add GITHUB_TOKEN)' : ''}`
      : r.status === 401 ? 'Token invalid'
      : r.status === 403 ? 'Rate-limited or token blocked'
      : r.status === null ? 'Unreachable'
      : `HTTP ${r.status}`;

  return {
    id: 'github', name: 'GitHub', enabled: flagSet('NEXT_PUBLIC_LIVE_REPOS'),
    configured, env, endpoint: endpoint(r, detail, exhausted ? false : undefined),
  };
};

// ─── Vercel ─────────────────────────────────────────────────────────────────
const checkVercel = async (): Promise<IntegrationStatus> => {
  const token = varSet('VERCEL_TOKEN');
  const env = [
    envVar('VERCEL_TOKEN', true),
    envVar('VERCEL_TEAM_ID'),
    envVar('VERCEL_PROJECTS'),
    envVar('NEXT_PUBLIC_LIVE_DEPLOYMENTS', false, true),
  ];

  let ep = unsetEndpoint();
  if (token) {
    const r = await ping('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN as string}` },
    });
    const detail =
      // Deliberately no account details — just validity.
      r.status === 200 ? 'Token valid'
      : r.status === 401 ? 'Token invalid'
      : r.status === 403 ? 'Token lacks access'
      : r.status === null ? 'Unreachable'
      : `HTTP ${r.status}`;
    ep = endpoint(r, detail);
  }

  return {
    id: 'vercel', name: 'Vercel', enabled: flagSet('NEXT_PUBLIC_LIVE_DEPLOYMENTS'),
    configured: token, env, endpoint: ep,
  };
};

// ─── Firebase ───────────────────────────────────────────────────────────────
const checkFirebase = async (): Promise<IntegrationStatus> => {
  const clientConfigured =
    varSet('NEXT_PUBLIC_FIREBASE_API_KEY') && varSet('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  const fbToken = varSet('FIREBASE_TOKEN');
  const env = [
    envVar('NEXT_PUBLIC_FIREBASE_API_KEY', true),
    envVar('NEXT_PUBLIC_FIREBASE_PROJECT_ID', true),
    envVar('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    envVar('FIREBASE_TOKEN'),
    envVar('FIREBASE_PROJECT_ID'),
    envVar('FIREBASE_SITES'),
  ];

  let ep = unsetEndpoint();
  if (fbToken) {
    const r = await ping('https://firebase.googleapis.com/v1beta1/projects?pageSize=1', {
      headers: { Authorization: `Bearer ${process.env.FIREBASE_TOKEN as string}` },
    });
    const detail =
      r.status === 200 ? 'Token valid'
      : r.status === 401 ? 'Token invalid'
      : r.status === 403 ? 'Token lacks access'
      : r.status === null ? 'Unreachable'
      : `HTTP ${r.status}`;
    ep = endpoint(r, detail);
  }

  return {
    id: 'firebase', name: 'Firebase', enabled: clientConfigured,
    configured: clientConfigured, env, endpoint: ep,
    note: clientConfigured && !fbToken
      ? 'Client SDK configured — auth verified via ID token. Hosting feed needs FIREBASE_TOKEN.'
      : undefined,
  };
};

// ─── Automation engine ──────────────────────────────────────────────────────
const checkAutomation = (): IntegrationStatus => {
  const configured =
    varSet('CRON_SECRET') && varSet('RESEND_API_KEY') && varSet('REPORT_EMAIL');
  return {
    id: 'automation', name: 'Automation engine', enabled: configured, configured,
    env: [
      envVar('CRON_SECRET', true),
      envVar('RESEND_API_KEY', true),
      envVar('REPORT_EMAIL', true),
      envVar('REPORT_WEEKLY_DAY'),
      envVar('REPORT_STALE_DAYS'),
    ],
    endpoint: null,
    note: 'Vercel Cron invokes /api/cron/reports daily at 07:00 UTC — no endpoint to ping.',
  };
};

export const checkIntegrations = async (): Promise<IntegrationStatus[]> => {
  const [supabase, github, vercel, firebase] = await Promise.all([
    checkSupabase(), checkGithub(), checkVercel(), checkFirebase(),
  ]);
  return [supabase, github, vercel, firebase, checkAutomation()];
};
