// ============================================================================
// Client-side live-data facade.
//
// The store calls these functions when the matching live source is enabled:
//   NEXT_PUBLIC_LIVE_TASKS=1        → Tasks + Reminders via Supabase
//   NEXT_PUBLIC_LIVE_REPOS=1        → Repositories via GitHub API
//   NEXT_PUBLIC_LIVE_DEPLOYMENTS=1  → Deployments via Vercel API + health checks
//
// Every call goes through the app's own server routes (which hold the real
// secrets). When Firebase is wired the acting user is proven by a verified
// ID token (`Authorization: Bearer <idToken>`); in demo mode — where no token
// issuer exists and data is per-browser local — the stable local id is sent in
// the `x-app-user` header instead.
// ============================================================================

import { getFirebaseAuth } from '@/lib/firebase';
import type { Task, Reminder, Repository, Deployment, Project, ProjectVersion, ModelEvaluation } from '@/types';

export interface LiveFlags {
  tasks: boolean;
  reminders: boolean;
  repositories: boolean;
  deployments: boolean;
  projects: boolean;
}

export const readLiveFlags = (): LiveFlags => ({
  tasks: process.env.NEXT_PUBLIC_LIVE_TASKS === '1',
  reminders: process.env.NEXT_PUBLIC_LIVE_TASKS === '1',
  repositories: process.env.NEXT_PUBLIC_LIVE_REPOS === '1',
  deployments: process.env.NEXT_PUBLIC_LIVE_DEPLOYMENTS === '1',
  projects: process.env.NEXT_PUBLIC_LIVE_PROJECTS === '1',
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

// ─── Tasks ──────────────────────────────────────────────────────────────────
export const fetchLiveTasks = (userId: string) =>
  call<{ tasks: Task[]; configured: boolean }>('/api/tasks', userId);

export const saveLiveTask = (userId: string, task: Task) => {
  const { id, ...rest } = task;
  return call<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, userId, {
    method: 'PATCH',
    body: JSON.stringify(rest),
  });
};

export const createLiveTask = (userId: string, task: Task) =>
  call<{ task: Task }>('/api/tasks', userId, { method: 'POST', body: JSON.stringify(task) });

export const deleteLiveTask = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/tasks/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });

// ─── Reminders ──────────────────────────────────────────────────────────────
export const fetchLiveReminders = (userId: string) =>
  call<{ reminders: Reminder[]; configured: boolean }>('/api/reminders', userId);

export const createLiveReminder = (userId: string, reminder: Reminder) =>
  call<{ reminder: Reminder }>('/api/reminders', userId, {
    method: 'POST',
    body: JSON.stringify(reminder),
  });

export const updateLiveReminder = (userId: string, reminder: Reminder) => {
  const { id, ...rest } = reminder;
  return call<{ reminder: Reminder }>(`/api/reminders/${encodeURIComponent(id)}`, userId, {
    method: 'PATCH',
    body: JSON.stringify(rest),
  });
};

export const deleteLiveReminder = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/reminders/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });

// ─── Repositories (live GitHub feed) ────────────────────────────────────────
export const fetchLiveRepos = (userId: string) =>
  call<{ repositories: Repository[]; configured: boolean }>('/api/repos', userId);

// ─── Deployments (live Vercel feed + health checks) ─────────────────────────
export const fetchLiveDeployments = (userId: string) =>
  call<{ deployments: Deployment[]; configured: boolean }>('/api/deployments', userId);

// ─── Projects (Supabase-backed, powers the automation engine) ───────────────
export const fetchLiveProjects = (userId: string) =>
  call<{ projects: Project[]; configured: boolean }>('/api/projects', userId);

export const saveLiveProject = (userId: string, project: Project) =>
  call<{ project: Project }>('/api/projects', userId, { method: 'POST', body: JSON.stringify(project) });

export const deleteLiveProject = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });

// ─── Versions (Supabase-backed) ─────────────────────────────────────────────
export const fetchLiveVersions = (userId: string) =>
  call<{ versions: ProjectVersion[]; configured: boolean }>('/api/versions', userId);

export const saveLiveVersion = (userId: string, version: ProjectVersion) =>
  call<{ version: ProjectVersion }>('/api/versions', userId, { method: 'POST', body: JSON.stringify(version) });

export const deleteLiveVersion = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/versions/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });

// ─── Evaluations (Supabase-backed) ──────────────────────────────────────────
export const fetchLiveEvaluations = (userId: string) =>
  call<{ evaluations: ModelEvaluation[]; configured: boolean }>('/api/evaluations', userId);

// ─── Manual report delivery (POST /api/reports/send) ────────────────────────
export interface SendReportNowInput {
  kind: 'daily' | 'weekly';
  title: string;
  body: string;
  attentionCount: number;
  /** AI executive summary text (optional — prepended like the cron does). */
  aiSummary?: string | null;
  /** Model id that wrote the summary (friendly heading + raw footer). */
  aiModel?: string | null;
}

export interface SendReportNowResult {
  ok: true;
  sent: boolean;
  emailId: string | null;
  reason: string | null;
}

/**
 * Trigger a manual delivery of a composed report. The route reuses the same
 * Resend client as the scheduled cron but verifies the acting user instead of
 * CRON_SECRET, so the Reports page's 'Save and email now' works in the browser.
 * Returns `sent: false` with a reason when email is unconfigured (graceful).
 */
export const sendReportNow = (userId: string, input: SendReportNowInput) =>
  call<SendReportNowResult>('/api/reports/send', userId, {
    method: 'POST',
    body: JSON.stringify(input),
  });

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

export interface IntegrationStatus {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  env: IntegrationEnvVar[];
  endpoint: IntegrationEndpoint | null;
  note?: string;
}

export const fetchIntegrationStatus = (userId: string, refresh = false) =>
  call<{ ok: true; checkedAt: string; integrations: IntegrationStatus[] }>(
    `/api/status${refresh ? '?refresh=1' : ''}`,
    userId,
  );

export const saveLiveEvaluation = (userId: string, evaluation: ModelEvaluation) =>
  call<{ evaluation: ModelEvaluation }>('/api/evaluations', userId, { method: 'POST', body: JSON.stringify(evaluation) });

export const deleteLiveEvaluation = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/evaluations/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });
