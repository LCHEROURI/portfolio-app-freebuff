import type { Deployment, HealthStatus } from '@/types';

import { mintServiceAccountToken } from './sa-token.mjs';

// ============================================================================
// Live deployment feed (server-only).
// Shared by /api/deployments (client refresh) and the automation engine cron.
//
// 1. Vercel API (when VERCEL_TOKEN is set): latest deployment per project.
// 2. Firebase Hosting releases (when the service account or FIREBASE_TOKEN
//    + FIREBASE_PROJECT_ID are set).
// 3. Live health checks: every deployment URL is fetched and scored
//    (200/503/…, response time), which feeds the health status.
//
// Projects are derived from GITHUB_REPOS by default so the same repo list
// drives both the GitHub feed and the deployment feed.
// ============================================================================

const DEFAULT_OWNER = 'LCHEROURI';
const DEFAULT_REPOS = [
  'portfolio-app-freebuff',
  'freebuff-meal',
  'newark-websites25',
  'prompt-vault-pro',
  'tip-compass',
  'reviewmaestro-production',
  'mortgage-zip-lead-engine',
];

const repoNames = () =>
  (process.env.GITHUB_REPOS ?? DEFAULT_REPOS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const now = () => new Date().toISOString();

const healthFromCode = (code: number | null, err: string | null): { health: HealthStatus; failure?: string } => {
  if (err) return { health: 'FAILED', failure: err };
  if (code == null) return { health: 'UNKNOWN' };
  if (code >= 200 && code < 400) return { health: 'HEALTHY' };
  if (code >= 500) return { health: 'FAILED', failure: `HTTP ${code}` };
  return { health: 'DEGRADED', failure: `HTTP ${code}` };
};

const checkUrl = async (url: string): Promise<{ code: number | null; ms: number | null; health: HealthStatus; failure?: string }> => {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'command-center-health-check/1.0' },
    });
    const ms = Date.now() - start;
    const { health, failure } = healthFromCode(res.status, null);
    return { code: res.status, ms, health, failure };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err instanceof Error && err.name === 'AbortError'
      ? 'Health check timed out'
      : 'Unreachable';
    const { health, failure } = healthFromCode(null, msg);
    return { code: null, ms, health, failure };
  } finally {
    clearTimeout(timer);
  }
};

interface VercelDeploymentShape {
  uid?: string;
  state?: string;
  readyState?: string;
  target?: string;
  url?: string;
  alias?: string[];
  created?: number;
  meta?: { githubCommitSha?: string; githubCommitRef?: string };
  error?: { message?: string };
}

const vercelStatus = (state: string | undefined): Deployment['status'] => {
  switch (state) {
    case 'READY': return 'READY';
    case 'ERROR': case 'ERRORED': return 'ERROR';
    case 'CANCELED': case 'CANCELLED': return 'CANCELED';
    case 'QUEUED': case 'BUILDING': case 'INITIALIZING': case 'DEPLOYING': return 'BUILDING';
    default: return 'READY';
  }
};

const ownerFallback = () => process.env.GITHUB_OWNER ?? DEFAULT_OWNER;

export const fetchLiveDeployments = async (userId: string): Promise<Deployment[]> => {
  const vercelToken = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const deployments: Deployment[] = [];

  // ── 1. Vercel latest deployments ──────────────────────────────────────────
  if (vercelToken) {
    const projectNames = process.env.VERCEL_PROJECTS
      ? process.env.VERCEL_PROJECTS.split(',').map((s) => s.trim()).filter(Boolean)
      : repoNames();
    const results = await Promise.allSettled(
      projectNames.map(async (project) => {
        const qs = new URLSearchParams({ limit: '1' });
        if (teamId) qs.set('teamId', teamId);
        const res = await fetch(
          `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/deployments?${qs}`,
          { headers: { Authorization: `Bearer ${vercelToken}` }, cache: 'no-store' },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { deployments?: VercelDeploymentShape[] };
        const d = body.deployments?.[0];
        if (!d) return null;
        const environment: Deployment['environment'] =
          d.target === 'production' ? 'production'
          : d.target === 'staging' ? 'staging'
          : 'preview';
        return {
          id: `vc-${project}-${d.uid ?? 'latest'}`,
          userId,
          provider: 'vercel' as const,
          projectName: project,
          environment,
          deploymentUrl: `https://${d.url ?? `${project}.vercel.app`}`,
          dashboardUrl: `https://vercel.com/${ownerFallback()}/${project}`,
          status: vercelStatus(d.readyState ?? d.state),
          healthStatus: 'NOT_CHECKED' as HealthStatus,
          lastDeploymentAt: d.created ? new Date(d.created).toISOString() : undefined,
          lastFailureMessage: d.error?.message,
          branch: d.meta?.githubCommitRef,
          commitSha: d.meta?.githubCommitSha,
          createdAt: now(),
          updatedAt: now(),
        };
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) deployments.push(r.value);
    }
  }

  // ── 1b. Firebase Hosting releases (SA-minted token or FIREBASE_TOKEN) ──
  const firebaseToken = process.env.FIREBASE_TOKEN;
  const firebaseProject = process.env.FIREBASE_PROJECT_ID;
  const firebaseSites = process.env.FIREBASE_SITES
    ? process.env.FIREBASE_SITES.split(',').map((s) => s.trim()).filter(Boolean)
    : (firebaseProject ? [firebaseProject] : []);
  // The Hosting Admin API lives at firebasehosting.googleapis.com — the
  // firebase.googleapis.com host only serves the Management API and 404s on
  // sites/releases. Token source: a static FIREBASE_TOKEN (legacy) or, when
  // the service account is present, a per-request mint — durable (no 1h
  // expiry), cached, and already in Vercel prod via FIREBASE_SERVICE_ACCOUNT.
  if ((firebaseToken || process.env.FIREBASE_SERVICE_ACCOUNT) && firebaseProject) {
    const token = firebaseToken ?? (await mintServiceAccountToken());
    const results = await Promise.allSettled(
      firebaseSites.map(async (site) => {
        const res = await fetch(
          `https://firebasehosting.googleapis.com/v1beta1/projects/${encodeURIComponent(firebaseProject)}/sites/${encodeURIComponent(site)}/releases?pageSize=1`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { releases?: Array<{ name?: string; type?: string; releaseTime?: string; message?: { text?: string } }> };
        const release = body.releases?.[0];
        if (!release) return null;
        return {
          id: `fh-${site}-${release.name?.split('/').pop() ?? 'latest'}`,
          userId,
          provider: 'firebase' as const,
          projectName: site,
          environment: 'production' as const,
          deploymentUrl: `https://${site}.web.app`,
          dashboardUrl: `https://console.firebase.google.com/project/${firebaseProject}/hosting/sites/${site}`,
          status: 'READY' as const,
          healthStatus: 'NOT_CHECKED' as HealthStatus,
          lastDeploymentAt: release.releaseTime ?? undefined,
          lastFailureMessage: release.message?.text,
          createdAt: now(),
          updatedAt: now(),
        };
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) deployments.push(r.value);
    }
  }

  // ── 2. Live health checks across every deployment URL ─────────────────────
  const checked = await Promise.all(
    deployments.map(async (d) => {
      const result = await checkUrl(d.deploymentUrl);
      return {
        ...d,
        healthStatus: result.health,
        responseCode: result.code ?? undefined,
        responseTimeMs: result.ms ?? undefined,
        lastFailureMessage: result.failure ?? d.lastFailureMessage,
        lastHealthCheckAt: now(),
        updatedAt: now(),
      };
    }),
  );

  return checked;
};
