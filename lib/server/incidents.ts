import type { DeployIncident, IncidentsSummary } from '@/lib/reportPreview';

// ============================================================================
// Deploy-incident history (server-only).
//
// Both deploy workflows (deploy-portfolio-app.yml, deploy-car-app.yml) and the
// scheduled rollout-health watch (rollout-health.yml) file exactly ONE shared
// open issue labeled `deploy-failure` — created on the first failure, commented
// on repeat failures, closed with a "✅ Resolved"/"✅ Rollout healthy again"
// comment on recovery. Closed issues stay in the repo, so that labeled-issue
// log IS the durable week-long history of deploy failures and rollout-health
// incidents. This module turns it into the structured summary the weekly
// report renders.
//
// Best-effort by design: every failure path degrades to an empty summary (with
// the fetch error recorded) so the cron report can never fail because this
// section is missing — the same graceful-degradation contract as
// lib/server/deployments.ts and lib/server/github.ts.
// ============================================================================

/** Comment markers the automation itself writes (never incident entries). */
const RESOLVED_MARKERS = ['✅ Resolved:', '✅ Rollout healthy again'];

/** Issue title → human-readable source label for the summary. */
const sourceFromTitle = (title: string): DeployIncident['source'] => {
  if (/car-app rollout unhealthy/i.test(title)) return 'rollout-health';
  if (/deploy failed/i.test(title)) return 'deploy';
  return 'deploy';
};

interface IssueShape {
  number?: number;
  title?: string;
  created_at?: string;
  closed_at?: string | null;
  html_url?: string;
}

interface CommentShape {
  body?: string;
  created_at?: string;
}

const ghGet = async <T>(path: string): Promise<{ ok: boolean; data: T | null; error?: string }> => {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-API-Version': '2022-11-28',
    };
    // GITHUB_TOKEN is baked into the deployed container by the deploy script
    // (SERVER_ENV_KEYS) — authenticated issues reads avoid the 60-req/hour
    // unauthenticated cap. Falls back to unauthenticated when absent (the
    // repos are public, so the read still works).
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com${path}`, { headers, cache: 'no-store' });
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}` };
    // 204 No Content → null data (same convention as lib/server/github.ts).
    const data = res.status === 204 ? null : ((await res.json()) as T);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : 'Network error' };
  }
};

/**
 * Summarize the deploy-failure incident log over the past `days` days (7 = the
 * weekly window). Everything degrades gracefully: an unreachable API, a missing
 * log, or zero incidents all produce an empty summary — never a thrown error.
 */
export const fetchIncidentsSummary = async (days = 7): Promise<IncidentsSummary> => {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const failures: DeployIncident[] = [];
  const recoveries: string[] = [];
  let fetchError: string | undefined;

  try {
    const listRes = await ghGet<IssueShape[]>(
      `/repos/${process.env.GITHUB_OWNER ?? 'LCHEROURI'}/portfolio-app-freebuff/issues?labels=deploy-failure&state=all&since=${encodeURIComponent(since)}&per_page=50`,
    );
    if (!listRes.ok || !Array.isArray(listRes.data)) {
      return { incidents: [], recoveries: [], resolvedCount: 0, fetchError: listRes.error };
    }

    for (const issue of listRes.data) {
      const created = issue.created_at ?? '';
      // `since` filters updated-at, so an OLD issue that was updated in the
      // window (commented on a repeat failure, or closed on recovery) still
      // appears — include it when EITHER boundary is recent enough.
      if (created && created < since) continue;

      const commentsRes = await ghGet<CommentShape[]>(
        `/repos/${process.env.GITHUB_OWNER ?? 'LCHEROURI'}/portfolio-app-freebuff/issues/${issue.number}/comments?per_page=100`,
      );
      const comments = Array.isArray(commentsRes.data) ? commentsRes.data : [];
      const incidentComments = comments.filter(
        (c) => c.body && !RESOLVED_MARKERS.some((m) => c.body!.startsWith(m)),
      );
      const resolvedComment = comments.find((c) => c.body && RESOLVED_MARKERS.some((m) => c.body!.startsWith(m)));

      // An issue CREATED in the window is this week's incident even when it
      // was already resolved (quick-recover failures still belong in the
      // weekly list); an older issue counts only when it gained new incident
      // comments in the window (a repeat failure). Issues with only a
      // recovery comment are recoveries of earlier incidents (counted, not
      // re-listed).
      const hasIncidentBody = incidentComments.length > 0 || created >= since;
      if (hasIncidentBody) {
        failures.push({
          source: sourceFromTitle(issue.title ?? ''),
          title: issue.title ?? `Issue #${issue.number}`,
          firstSeenAt: created || undefined,
          lastSeenAt: comments.at(-1)?.created_at ?? issue.closed_at ?? undefined,
          resolvedAt: issue.closed_at ?? undefined,
          url: issue.html_url,
        });
      }
      if (resolvedComment?.created_at && resolvedComment.created_at >= since) {
        recoveries.push(`${issue.title ?? `Issue #${issue.number}`} — resolved ${resolvedComment.created_at.slice(0, 10)}`);
      }
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'Incident log fetch failed';
  }

  return {
    incidents: failures,
    recoveries,
    resolvedCount: recoveries.length,
    fetchError,
  };
};
