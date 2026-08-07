// ============================================================================
// Client-side live-data facade.
//
// The store calls these functions when the matching live source is enabled:
//   NEXT_PUBLIC_LIVE_REPOS=1        → Repositories via GitHub API
//   NEXT_PUBLIC_LIVE_DEPLOYMENTS=1  → Deployments via Vercel API + health checks
//
// Tasks/projects/versions/evaluations/activity are NOT here: they persist to
// Firestore through the client FirestoreService (lib/firestore.ts) — the app's
// single data store — so there are no server routes or live flags for them.
//
// Every call goes through the app's own server routes (which hold the real
// secrets). When Firebase is wired the acting user is proven by a verified
// ID token (`Authorization: Bearer <idToken>`); in demo mode — where no token
// issuer exists and data is per-browser local — the stable local id is sent in
// the `x-app-user` header instead.
// ============================================================================

import { getFirebaseAuth } from '@/lib/firebase';
import type { Repository, Deployment } from '@/types';

export interface LiveFlags {
  repositories: boolean;
  deployments: boolean;
}

export const readLiveFlags = (): LiveFlags => ({
  repositories: process.env.NEXT_PUBLIC_LIVE_REPOS === '1',
  deployments: process.env.NEXT_PUBLIC_LIVE_DEPLOYMENTS === '1',
});

/**
 * True when the Command Center should auto-generate the AI top-three briefing
 * on load instead of waiting for the AI Explain click. Build-time inlined like
 * every NEXT_PUBLIC_ flag, so flipping it requires a redeploy.
 */
export const isAiBriefingsEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_ENABLE_AI_BRIEFINGS === '1';

/**
 * Current Firebase ID token (the SDK auto-refreshes it near expiry), or null
 * when Firebase isn't configured / nobody is signed in (demo mode).
 */
const getAuthToken = async (): Promise<string | null> => {
  try {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
};

const call = async <T>(path: string, userId: string, init?: RequestInit): Promise<T> => {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    // Demo mode — no token issuer, so the local id is the only identity.
    headers.set('x-app-user', userId);
  }

  const res = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) {
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return body;
};

// ─── Repositories (live GitHub feed) ────────────────────────────────────────
export const fetchLiveRepos = (userId: string) =>
  call<{ repositories: Repository[]; configured: boolean }>('/api/repos', userId);

// ─── Deployments (live Vercel feed + health checks) ─────────────────────────
export const fetchLiveDeployments = (userId: string) =>
  call<{ deployments: Deployment[]; configured: boolean }>('/api/deployments', userId);

// ─── AI report summaries (OpenRouter via /api/ai/summarize) ──────────────────
export interface AiSummaryInput {
  kind: 'daily' | 'weekly';
  title: string;
  body: string;
  attentionCount: number;
  /** Per-user model override (Settings → AI summaries). Empty → env default. */
  model?: string;
}

export interface AiSummaryResult {
  ok: true;
  configured: boolean;
  summary: string | null;
  model: string | null;
}

/**
 * Request an AI executive summary for a generated report. The route returns
 * `summary: null` when OpenRouter is unconfigured or the call failed, so
 * callers fall back to the deterministic report text unchanged.
 */
export const fetchAiSummary = (userId: string, input: AiSummaryInput) =>
  call<AiSummaryResult>('/api/ai/summarize', userId, {
    method: 'POST',
    body: JSON.stringify(input),
  });

// ─── AI top-three narration (OpenRouter via /api/ai/top-three) ──────────────
export interface TopThreeActionInput {
  priority: number;
  title: string;
  description: string;
  /** Project the action belongs to, when known — powers cite-back links. */
  projectId?: string;
  projectName?: string;
}

export interface TopThreeNarrationResult {
  ok: true;
  configured: boolean;
  narration: {
    paragraph: string;
    model: string;
    /** Project ids the paragraph explicitly refers to — validated server-side. */
    projectIds: string[];
  } | null;
}

/**
 * Request a plain-language narration of today's top three actions. The route
 * returns `narration: null` when OpenRouter is unconfigured or the call
 * failed, so callers fall back to the rule-based list unchanged.
 */
export const fetchTopThreeNarration = (
  userId: string,
  input: { actions: TopThreeActionInput[]; model?: string },
) =>
  call<TopThreeNarrationResult>('/api/ai/top-three', userId, {
    method: 'POST',
    body: JSON.stringify(input),
  });

// ─── AI winner recommendation (OpenRouter via /api/ai/recommend-winner) ─────
export interface WinnerCandidateInput {
  versionId: string;
  versionName: string;
  builder: string;
  model: string;
  overallScore: number;
  scores: Record<string, number>;
}

export interface WinnerRecommendationResult {
  ok: true;
  configured: boolean;
  recommendation: {
    recommendedVersionId: string;
    note: string;
    model: string;
  } | null;
}

/**
 * Request an AI "why this version wins" recommendation for a project. The
 * route returns `recommendation: null` when OpenRouter is unconfigured or the
 * call failed, so callers fall back to the deterministic top score.
 */
export const fetchWinnerRecommendation = (
  userId: string,
  input: { projectName: string; candidates: WinnerCandidateInput[] },
) =>
  call<WinnerRecommendationResult>('/api/ai/recommend-winner', userId, {
    method: 'POST',
    body: JSON.stringify(input),
  });

// ─── Local scanner feed (GET /api/scans) ───────────────────────────────────
export interface ScansRow {
  id: string;
  owner: string;
  repositoryName: string;
  repositoryUrl: string;
  currentBranch: string;
  lastScannedAt: string;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  commitsAhead: number;
  commitsBehind: number;
}

/**
 * Fetch the per-repo local scan freshness feed. Goes through the same identity
 * facade as every other live route (verified Firebase ID token, or the demo
 * x-app-user header), because the route scopes the Firestore-backed feed to
 * the acting user — it is NOT a public endpoint.
 */
export const fetchScans = (userId: string) =>
  call<{ ok: boolean; repos: ScansRow[] }>('/api/scans', userId);

// ─── Integration connection status ──────────────────────────────────────────
export interface IntegrationEnvVar {
  name: string;
  set: boolean;
  required: boolean;
}

export interface IntegrationEndpoint {
  ok: boolean;
  status: number | null;
  ms: number | null;
  detail: string;
}

/** Firebase authorized-domains check result (client-origin vs. project list). */
export interface IntegrationAuthDomains {
  ok: boolean;
  /** Hostname that was checked against the project's Authorized domains. */
  origin: string;
  /** Deep link to the Firebase console Authorized domains settings. */
  href: string;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  env: IntegrationEnvVar[];
  endpoint: IntegrationEndpoint | null;
  note?: string;
  /** Present on the Firebase integration when the client SDK is configured. */
  authDomains?: IntegrationAuthDomains;
}

export const fetchIntegrationStatus = (userId: string, refresh = false) =>
  call<{ ok: true; checkedAt: string; integrations: IntegrationStatus[] }>(
    `/api/status${refresh ? '?refresh=1' : ''}`,
    userId,
  );
