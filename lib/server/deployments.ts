import type { Deployment, HealthStatus } from '@/types';

import { mintServiceAccountToken } from './sa-token.mjs';

// ============================================================================
// Live deployment feed (server-only).
// Shared by /api/deployments (client refresh) and the automation engine cron.
//
// 1. Firebase App Hosting rollouts (when the service account +
//    FIREBASE_PROJECT_ID are set): the newest SUCCEEDED rollout per known
//    backend in this project. The apps previously hosted on Vercel now serve
//    from App Hosting, so the feed reads rollouts instead of Vercel
//    deployments (the Vercel half was retired with the hosting migration).
// 2. Firebase Hosting releases (when the service account or FIREBASE_TOKEN
//    + FIREBASE_PROJECT_ID are set).
// 3. Live health checks: every deployment URL is fetched and scored
//    (200/503/…, response time), which feeds the health status.
// ============================================================================

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

// The App Hosting backends deployed from this repo/project. Each backend
// serves exactly one default hosted.app URL and its newest SUCCEEDED rollout
// is the live deployment.
const APPHOSTING_BACKENDS = [
  { id: 'portfolio-app-freebuff', repo: 'portfolio-app-freebuff' },
  { id: 'freebuff-car-app', repo: 'freebuff-car-app' },
  { id: 'cook-with-freebuff', repo: 'cook-with-freebuff' },
];

const appHostingUrl = (backendId: string, project: string) =>
  `https://${backendId}--${project}.us-central1.hosted.app`;

export const fetchLiveDeployments = async (userId: string): Promise<Deployment[]> => {
  const firebaseProject = process.env.FIREBASE_PROJECT_ID;
  const deployments: Deployment[] = [];

  // ── 1. Firebase App Hosting rollouts (SA-minted token) ───────────────────
  if (process.env.FIREBASE_SERVICE_ACCOUNT && firebaseProject) {
    const token = await mintServiceAccountToken();
    const results = await Promise.allSettled(
      APPHOSTING_BACKENDS.map(async ({ id, repo }) => {
        // The rollouts list is not newest-first, so sort by createTime and
        // take the newest SUCCEEDED rollout (that is the one currently
        // serving).
        const res = await fetch(
          `https://firebaseapphosting.googleapis.com/v1beta/projects/${encodeURIComponent(firebaseProject)}/locations/us-central1/backends/${encodeURIComponent(id)}/rollouts?pageSize=50`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        );
        if (!res.ok) return null;
        const body = (await res.json()) as { rollouts?: Array<{ name?: string; state?: string; createTime?: string; labels?: Record<string, string> }> };
        const rollouts = (body.rollouts ?? [])
          .filter((r) => r.state === 'SUCCEEDED')
          .sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''));
        const rollout = rollouts[0];
        if (!rollout) return null;
        const buildId = rollout.name?.split('/').pop() ?? 'latest';
        return {
          id: `ah-${id}-${buildId}`,
          userId,
          provider: 'apphosting' as const,
          projectName: repo,
          environment: 'production' as const,
          deploymentUrl: appHostingUrl(id, firebaseProject),
          dashboardUrl: `https://console.firebase.google.com/project/${firebaseProject}/apphosting`,
          status: 'READY' as const,
          healthStatus: 'NOT_CHECKED' as HealthStatus,
          lastDeploymentAt: rollout.createTime ?? undefined,
          commitSha: rollout.labels?.['commit-sha'],
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
