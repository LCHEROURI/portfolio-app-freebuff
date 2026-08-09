import type { IntegrationAuthDomains, IntegrationEndpoint, IntegrationEnvVar, IntegrationStatus } from '@/lib/liveData';
import { isDomainAuthorized, originHostname } from '@/lib/authDomains';
import {
  getFirestoreAdminToken, getFirestoreProjectId, isFirestoreAdminConfigured,
} from '@/lib/server/firestoreAdmin';
import { mintServiceAccountToken } from '@/lib/server/sa-token.mjs';

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

const PING_TTL_MS = 120_000;

// Per-check cache: reuse the last *successful* ping within a short TTL so the
// Integrations panel's 30s polling doesn't re-hit provider APIs every poll
// (GitHub's unauthenticated budget is 60 req/h; a 2-min TTL keeps steady-state
// status pings around 30/h, and a GITHUB_TOKEN lifts the limit to 5,000/h).
// Responses that never returned an HTTP status (timeout/unreachable) are NOT
// cached, so a transient blip retries on the next poll instead of being served
// stale. A manual refresh (?refresh=1) clears the cache entirely.
const pingCache = new Map<string, { at: number; result: PingResult }>();
// In-flight promises so concurrent cold misses share a single ping (same
// pattern as the Firebase cert fetch).
const inFlightPings = new Map<string, Promise<PingResult>>();

const cachedPing = async (
  key: string, url: string, init?: RequestInit, timeoutMs?: number,
): Promise<PingResult> => {
  const now = Date.now();
  const hit = pingCache.get(key);
  if (hit && now - hit.at < PING_TTL_MS) return hit.result;
  const pending = inFlightPings.get(key);
  if (pending) return pending;
  const promise = ping(url, init, timeoutMs)
    .then((result) => {
      if (result.status !== null) pingCache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => inFlightPings.delete(key));
  inFlightPings.set(key, promise);
  return promise;
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

// ─── Firestore (server-side data store for the automation engine) ───────────
const checkFirestore = async (): Promise<IntegrationStatus> => {
  const configured = isFirestoreAdminConfigured();
  const env = [
    envVar('FIREBASE_SERVICE_ACCOUNT', true),
    envVar('FIREBASE_SERVICE_ACCOUNT_PATH'),
    envVar('NEXT_PUBLIC_FIREBASE_PROJECT_ID', true),
  ];

  let ep = unsetEndpoint();
  if (configured) {
    try {
      const token = await getFirestoreAdminToken();
      const project = getFirestoreProjectId();
      // The probe must hit a REAL Firestore REST method: a bare GET on the
      // collection root (…/documents?pageSize=1) is rejected by Google's
      // frontend with a 404 before auth even runs, which rendered the
      // Firestore card as a perpetual 'Endpoint error (HTTP 404)' while the
      // data layer itself worked fine (the cron reads through the SAME
      // :runQuery call below). Query a non-existent collection: HTTP 200 with
      // an empty result set means the database + service account are healthy.
      // The collection id must NOT be a reserved form — Firestore rejects
      // ids wrapped in double underscores (__…__) with HTTP 400 — so the
      // probe uses a plain, never-created name.
      const r = await cachedPing(
        'firestore',
        `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: { from: [{ collectionId: 'zzz-health-probe' }], limit: 1 },
          }),
        },
      );
      const detail =
        r.status === 200 ? 'Service account can read documents'
        : r.status === 401 || r.status === 403 ? 'Service account lacks access'
        : r.status === null ? 'Unreachable'
        : `HTTP ${r.status}`;
      ep = endpoint(r, detail);
    } catch {
      ep = { ok: false, status: null, ms: null, detail: 'Token mint failed' };
    }
  }

  return {
    id: 'firestore', name: 'Firestore', enabled: configured,
    configured, env, endpoint: ep,
    note: configured
      ? 'Service account reads the same projects/versions/tasks/evaluations the client writes, so the cron evaluates real data.'
      : 'The automation cron falls back to empty live data until FIREBASE_SERVICE_ACCOUNT is set.',
  };
};

// ─── GitHub ─────────────────────────────────────────────────────────────────
const checkGithub = async (): Promise<IntegrationStatus> => {
  const token = varSet('GITHUB_TOKEN');
  // GITHUB_TOKEN is marked required so the Integrations setup checklist fires
  // on a fresh install (the feed works tokenless, but the token lifts the
  // 60 req/h cap and is the intended first step).
  const env = [
    envVar('GITHUB_TOKEN', true),
    envVar('GITHUB_OWNER'),
    envVar('GITHUB_REPOS'),
    envVar('NEXT_PUBLIC_LIVE_REPOS', false, true),
  ];

  // The feed works against the public API without a token; `configured` here
  // reflects whether anything meaningful is actually set (token/owner/repos/flag)
  // so a fresh install reads honestly instead of "Configured".
  const configured =
    varSet('GITHUB_TOKEN') || varSet('GITHUB_OWNER') || varSet('GITHUB_REPOS') || flagSet('NEXT_PUBLIC_LIVE_REPOS');

  const r = await cachedPing('github', 'https://api.github.com/rate_limit', {
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
    const r = await cachedPing('vercel', 'https://api.vercel.com/v2/user', {
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
const checkFirebase = async (origin?: string, projectOrigin?: string): Promise<IntegrationStatus> => {
  const clientConfigured =
    varSet('NEXT_PUBLIC_FIREBASE_API_KEY') && varSet('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
  const fbToken = varSet('FIREBASE_TOKEN');
  const fbSA = varSet('FIREBASE_SERVICE_ACCOUNT');
  const feedConfigured = fbToken || fbSA;
  const env = [
    envVar('NEXT_PUBLIC_FIREBASE_API_KEY', true),
    envVar('NEXT_PUBLIC_FIREBASE_PROJECT_ID', true),
    envVar('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    envVar('FIREBASE_TOKEN'),
    envVar('FIREBASE_SERVICE_ACCOUNT'),
    envVar('FIREBASE_PROJECT_ID'),
    envVar('FIREBASE_SITES'),
  ];

  let ep = unsetEndpoint();
  if (feedConfigured) {
    const token =
      process.env.FIREBASE_TOKEN ??
      (await mintServiceAccountToken().catch(() => ''));
    if (token) {
      const r = await cachedPing('firebase', 'https://firebase.googleapis.com/v1beta1/projects?pageSize=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const detail =
        r.status === 200 ? 'Token valid'
        : r.status === 401 ? 'Token invalid'
        : r.status === 403 ? 'Token lacks access'
        : r.status === null ? 'Unreachable'
        : `HTTP ${r.status}`;
      ep = endpoint(r, detail);
    } else {
      ep = endpoint({ status: null, ms: 0, json: null }, 'No token available');
    }
  }

  // Authorized-domains gate: Firebase silently blocks sign-in from an origin
  // that isn't in the project's list, so flag it here — before the user ever
  // hits the AuthGate — using the public getProjectConfig endpoint (no secret
  // needed; the API key is already public). Skipped when the origin is unknown
  // or the client SDK isn't configured. A ?project= override (deployment
  // preview domain) takes precedence over the request origin so a domain can
  // be validated before it ships.
  let authDomains: IntegrationAuthDomains | undefined;
  if (clientConfigured && (origin || projectOrigin)) {
    const target = projectOrigin ?? (origin as string);
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '';
    const r = await cachedPing(
      'firebase-domains',
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`,
    );
    const list = (r.json as { authorizedDomains?: string[] } | null)?.authorizedDomains ?? [];
    authDomains = {
      ok: isDomainAuthorized(list, target),
      origin: originHostname(target),
      href: `https://console.firebase.google.com/project/${projectId}/authentication/settings`,
    };
  }

  return {
    id: 'firebase', name: 'Firebase', enabled: clientConfigured,
    configured: clientConfigured, env, endpoint: ep, authDomains,
    note: clientConfigured && !feedConfigured
      ? 'Client SDK configured — auth verified via ID token. Hosting feed needs FIREBASE_SERVICE_ACCOUNT or FIREBASE_TOKEN.'
      : undefined,
  };
};

// ─── Google IdP (classic web OAuth client + google.com IdP record) ───────────
// Google sign-in works through a CLASSIC web OAuth client
// ({projectNumber}-{hash}.apps.googleusercontent.com + GOCSPX- secret) wired
// into the google.com IdP record — NOT a Workforce/IAP client from
// `gcloud iam oauth-clients`, which accounts.google.com rejects at the popup.
// The two env vars below are wiring-only: scripts/wire-google-client.mjs reads
// them once to PATCH the IdP record; the deployed app never reads them at
// runtime (it reads the IdP record the SDK queries at sign-in time).
const checkGoogleIdp = async (): Promise<IntegrationStatus> => {
  const wiringVars = varSet('GOOGLE_CLIENT_ID') && varSet('GOOGLE_CLIENT_SECRET');

  // The definitive live check: read the actual google.com IdP record the SDK
  // consults. Needs a service account + project id (same credential the
  // Firestore cron uses); without them we can only report env presence.
  // probeOk is undefined when the probe couldn't run, true when the record is
  // enabled AND carries a classic web client, false otherwise.
  let probeOk: boolean | undefined;
  let ep = unsetEndpoint();
  if (isFirestoreAdminConfigured() && getFirestoreProjectId()) {
    try {
      const token = await getFirestoreAdminToken();
      const project = getFirestoreProjectId();
      const r = await cachedPing(
        'google-idp',
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs/google.com`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = r.json as { enabled?: boolean; clientId?: string } | null;
      const registered = r.status === 200 && json?.enabled === true;
      const classicClient = registered && (json?.clientId ?? '').includes('apps.googleusercontent.com');
      probeOk = registered && classicClient;
      const detail =
        r.status === 200 && registered
          ? classicClient
            ? 'google.com IdP enabled with a classic web client'
            : 'google.com IdP enabled — but client id is not classic format'
          : r.status === 404 ? 'google.com IdP record missing — Google popup will fail'
          : r.status === 401 || r.status === 403 ? 'Service account lacks Identity Platform access'
          : r.status === null ? 'Unreachable'
          : `HTTP ${r.status}`;
      ep = endpoint(r, detail, probeOk);
    } catch {
      probeOk = false;
      ep = { ok: false, status: null, ms: null, detail: 'Token mint failed' };
    }
  }

  // The wiring vars are consumed ONCE by scripts/wire-google-client.mjs and
  // never exist in Vercel runtime — so `configured` keys off the IdP-record
  // probe (the real signal the SDK reads at popup time), falling back to env
  // presence only when the probe couldn't run (no service account). The vars'
  // `set` flag means "the wiring requirement is satisfied", which the probe
  // proves even when the vars themselves are absent from the runtime env.
  const wiringComplete = probeOk ?? wiringVars;
  const env = [
    { name: 'GOOGLE_CLIENT_ID', set: wiringComplete, required: true },
    { name: 'GOOGLE_CLIENT_SECRET', set: wiringComplete, required: true },
  ];

  return {
    id: 'google-idp', name: 'Google sign-in', enabled: wiringComplete,
    configured: wiringComplete, env, endpoint: ep,
    note: probeOk === true
      ? 'google.com IdP record verified live via the admin API — the Google popup opens the account chooser.'
      : probeOk === false
        ? 'Google sign-in needs a classic web OAuth client (GCP console → Auth → Clients) wired into the google.com IdP record via scripts/wire-google-client.mjs.'
        : wiringVars
          ? 'Wiring vars set — the one-shot wire script can patch the IdP record.'
          : 'Google sign-in needs a classic web OAuth client (GCP console → Auth → Clients) wired into the google.com IdP record via scripts/wire-google-client.mjs.',
  };
};

// ─── Automation engine ──────────────────────────────────────────────────────
const checkAutomation = (): IntegrationStatus => {
  const configured = varSet('CRON_SECRET');
  return {
    id: 'automation', name: 'Automation engine', enabled: configured, configured,
    env: [
      envVar('CRON_SECRET', true),
      envVar('REPORT_OWNER_ID'),
      envVar('REPORT_WEEKLY_DAY'),
      envVar('REPORT_STALE_DAYS'),
    ],
    endpoint: null,
    note: 'Vercel Cron invokes /api/cron/reports daily at 07:00 UTC — it composes daily/weekly report bodies that feed the in-app Reports page; nothing is emailed.',
  };
};

export const checkIntegrations = async (
  refresh = false,
  origin?: string,
  projectOrigin?: string,
): Promise<IntegrationStatus[]> => {
  if (refresh) pingCache.clear();
  const [firestore, github, vercel, firebase, googleIdp] = await Promise.all([
    checkFirestore(), checkGithub(), checkVercel(), checkFirebase(origin, projectOrigin),
    checkGoogleIdp(),
  ]);
  return [firestore, github, vercel, firebase, googleIdp, checkAutomation()];
};
