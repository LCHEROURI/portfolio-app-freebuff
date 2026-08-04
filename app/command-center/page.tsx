'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  FolderKanban, AlertTriangle, CalendarClock, GitBranch, ArrowUpFromLine, Rocket,
  HeartPulse, Clock4, ShieldAlert, ArrowRight, ListChecks, TrendingUp, Plug, Sparkles,
  RefreshCw, FileDiff,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard, Card, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge, PriorityBadge, ModelBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { VercelEnvSettingsLink } from '@/components/integrations/VercelEnvSettingsLink';
import { isFirebaseConfigured } from '@/lib/firebase';
import { fetchTopThreeNarration, isAiBriefingsEnabled, readLiveFlags } from '@/lib/liveData';
import { useStore } from '@/lib/store';
import {
  computeMetrics, buildPriorityQueue, buildTopThree, runAutomationRules, timeAgo,
  type QueueItem,
} from '@/lib/engine';
import { QUEUE_RULE_LABELS } from '@/lib/labels';
import type { Repository } from '@/types';

// Session-scoped persistence so the briefing (paragraph, cited projects, active
// brief chip) survives back navigation and remounts without refiring an AI call.
// Stored under the signature of the actions it described: if the underlying data
// changed while away, the stored briefing is discarded instead of shown stale.
const BRIEFING_STORAGE_KEY = 'freebuff-command-center-briefing';

const SCAN_STALE_MS = 24 * 3_600_000;

/** Resolve the repository a queue item's unpushed/uncommitted facts refer to. */
const repoOfQueueItem = (item: QueueItem, repos: Repository[]): Repository | undefined =>
  item.version?.repositoryId
    ? repos.find((r) => r.id === item.version!.repositoryId)
    : repos.find((r) => r.projectVersionId === item.version?.id);

type StoredBriefing = {
  paragraph: string;
  model: string;
  projectIds: string[];
  scope: string | 'all';
  signature: string;
};

const persistBriefing = (
  narration: { paragraph: string; model: string; projectIds: string[] } | null,
  scope: string | 'all',
  signature: string,
) => {
  try {
    if (!narration) {
      sessionStorage.removeItem(BRIEFING_STORAGE_KEY);
      return;
    }
    const stored: StoredBriefing = {
      paragraph: narration.paragraph,
      model: narration.model,
      projectIds: narration.projectIds,
      scope,
      signature,
    };
    sessionStorage.setItem(BRIEFING_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable (private mode / quota): the briefing still shows for
    // this session, it just won't survive a remount.
  }
};

export default function CommandCenterPage() {
  const store = useStore();
  const metrics = computeMetrics(store);
  const queue = buildPriorityQueue(store);
  const topThree = buildTopThree(store);
  const alerts = runAutomationRules(store);

  // AI narration of today's top three — an enhancement layer. When OpenRouter
  // is unconfigured or the call fails, narration stays null and the card shows
  // the rule-based list unchanged. `scopeProjectId` narrows the narration to a
  // single project's queue items (drill-down); 'all' is the whole top three.
  const [narration, setNarration] = useState<{
    paragraph: string;
    model: string;
    projectIds: string[];
  } | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [scopeProjectId, setScopeProjectId] = useState<string | 'all'>('all');

  const projectNameOf = (id: string | undefined) =>
    id ? store.projects.find((p) => p.id === id)?.name : undefined;

  // Projects present in the current top three — the drill-down targets. The
  // name is resolved once per action so the filter and the map agree; Map
  // dedupes by project id, and Array.from keeps the spread ES5-safe.
  const involvedProjects = Array.from(new Map(
    topThree
      .map((a) => ({ id: a.projectId, name: projectNameOf(a.projectId) }))
      .filter((a): a is { id: string; name: string } => Boolean(a.id && a.name))
      .map((a) => [a.id, a.name] as [string, string]),
  ).entries()).map(([id, name]) => ({ id, name }));

  // The narration request input, optionally narrowed to one project's actions.
  const buildNarrationActions = (projectId: string | 'all') =>
    (projectId === 'all' ? topThree : topThree.filter((a) => a.projectId === projectId))
      .map((a) => ({
        priority: a.priority,
        title: a.title,
        description: a.description,
        projectId: a.projectId,
        projectName: projectNameOf(a.projectId),
      }));

  // A narration describes the actions that existed when it was generated. If the
  // underlying data changes (task completed, deploy recovered) the deterministic
  // list is recomputed, so drop the stale paragraph rather than show a story
  // about actions that no longer exist. The AI Explain button stays available as
  // a manual regenerate.
  // The signature includes the project id so a stored briefing can't be
  // resurrected against a different project's identical-looking action.
  const topThreeSignature = topThree.map((a) => `${a.projectId}::${a.title}::${a.description}`).join('|');
  useEffect(() => {
    setNarration(null);
  }, [topThreeSignature]);

  // Latest-wins guard for the narration. A drill-down chip (or All) click during
  // an in-flight call must win: the newest request supersedes older ones, and a
  // stale response is discarded instead of overwriting the newer scope's
  // paragraph. Each call records its own id; a call only applies its result and
  // only clears the narrating state when it is still the latest.
  const latestNarrationRequestRef = useRef(0);

  const explainTopThree = async (projectId: string | 'all' = scopeProjectId) => {
    const actions = buildNarrationActions(projectId);
    if (actions.length === 0) return;
    const requestId = ++latestNarrationRequestRef.current;
    setNarrating(true);
    try {
      const result = await fetchTopThreeNarration(store.userId, {
        actions,
        // Per-user model preference from Settings → AI summaries.
        model: store.profile.aiModel || undefined,
      });
      // A newer scope was requested while this call was in flight — drop this
      // stale paragraph rather than show a briefing for the wrong scope.
      if (latestNarrationRequestRef.current !== requestId) return;
      const next = result.narration
        ? { paragraph: result.narration.paragraph, model: result.narration.model, projectIds: result.narration.projectIds ?? [] }
        : null;
      setNarration(next);
      // Persist with the scope the narration was generated for and the signature
      // of the actions it describes, so back navigation can restore it later.
      persistBriefing(next, projectId, topThreeSignature);
    } catch {
      // Only the latest request owns the error state; a stale failure must not
      // clear a newer request's in-flight or resolved paragraph.
      if (latestNarrationRequestRef.current === requestId) setNarration(null);
    } finally {
      if (latestNarrationRequestRef.current === requestId) setNarrating(false);
    }
  };

  // Drill-down: re-run the narration against a single project's queue items.
  // The previous scope's paragraph is cleared so the card never shows a stale
  // briefing (e.g. the 'all' summary) while the scoped call is in flight.
  const briefProject = (projectId: string) => {
    setScopeProjectId(projectId);
    setNarration(null);
    void explainTopThree(projectId);
  };

  // Auto-briefing: when NEXT_PUBLIC_ENABLE_AI_BRIEFINGS=1 the narration fires on
  // load instead of on click. The ref makes it run once per mount (the signature
  // effect above clears the paragraph on data changes without refiring a fresh
  // AI call); the manual AI Explain button remains as a regenerate affordance.
  const autoBriefedRef = useRef(false);

  // Restore a briefing persisted earlier in this tab (back navigation / remount).
  // Only restores when the stored signature matches the current actions: a data
  // change while away makes the stored paragraph stale, so it is discarded. The
  // signature also settles asynchronously with store hydration, so this re-checks
  // whenever it changes.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BRIEFING_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as StoredBriefing;
      if (stored.signature !== topThreeSignature) {
        sessionStorage.removeItem(BRIEFING_STORAGE_KEY);
        return;
      }
      setNarration({ paragraph: stored.paragraph, model: stored.model, projectIds: stored.projectIds });
      setScopeProjectId(stored.scope);
      // The restored briefing replaces the auto-brief: don't spend another
      // OpenRouter call on content the user already has on screen.
      autoBriefedRef.current = true;
    } catch {
      // Malformed or unreadable storage is ignored; the next generation
      // overwrites it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topThreeSignature]);

  // Depends on the signature, not []: the store hydrates asynchronously, so the
  // mount render may have an empty top three. When the actions arrive the
  // signature changes and this re-runs — the ref still guarantees a single fire
  // per mount, and later signature changes (data updates) are ignored.
  useEffect(() => {
    if (autoBriefedRef.current || !isAiBriefingsEnabled() || topThree.length === 0) return;
    autoBriefedRef.current = true;
    void explainTopThree('all');
    // The ref guards the re-renders caused by the state updates, so the closure
    // capture (topThree, store) from the first non-empty render is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topThreeSignature]);

  // Landing surface for a missing integration: when no live data source is
  // connected, surface a one-click path to wire one up (Integrations page +
  // Vercel env settings deep-link). Mirrors the Integrations page banner.
  const flags = readLiveFlags();
  // Matches the Integrations page's live-count logic (tasks/repositories/
  // deployments/Firebase); LIVE_PROJECTS alone doesn't count as an integration
  // being connected there, so it shouldn't hide this banner either.
  const anyLive = flags.tasks || flags.repositories || flags.deployments || isFirebaseConfigured();

  const queueTone = (severity: string) =>
    severity === 'critical'
      ? 'border-l-paprika-500 bg-paprika-50 dark:bg-paprika-950/40'
      : severity === 'high'
        ? 'border-l-tomato-500 bg-tomato-50 dark:bg-tomato-950/30'
        : severity === 'medium'
          ? 'border-l-turmeric-500 bg-turmeric-50 dark:bg-turmeric-950/30'
          : 'border-l-pepper-400 bg-butter-50 dark:bg-pepper-800';

  return (
    <div>
      <PageHeader
        title="Command Center"
        description={`${store.projects.filter((p) => !p.archived).length} active implementations tracked across ${new Set(store.versions.map((v) => v.model)).size} models.`}
        action={
          <Link href="/projects" className="btn-primary">
            <FolderKanban size={16} aria-hidden="true" /> New Project
          </Link>
        }
      />

      {/* No live integrations — one-click setup nudge on the landing page */}
      {!anyLive && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl2 border border-turmeric-300 bg-turmeric-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-turmeric-800 dark:bg-turmeric-900/40">
          <div className="flex items-start gap-3">
            <Plug size={18} className="mt-0.5 shrink-0 text-turmeric-700 dark:text-turmeric-300" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-pepper-800 dark:text-flour-100">No live integrations connected yet</p>
              <p className="mt-0.5 text-sm text-pepper-600 dark:text-pepper-300">
                The Command Center is running on local demo data. Add your API keys and flip the live flags, then redeploy to pull real tasks, repos, and deployments.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pl-7">
            <Link href="/integrations" className="btn-ghost text-sm">
              Open Integrations <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <VercelEnvSettingsLink label="Vercel env settings" className="btn-secondary text-sm" />
          </div>
        </div>
      )}

      {/* Summary metrics */}
      <section aria-label="Summary metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Active projects" value={metrics.activeProjects} icon={<FolderKanban size={20} aria-hidden="true" />} tone="basil" hint={`${metrics.needingAttention} need attention`} />
        <StatCard label="Needing attention" value={metrics.needingAttention} icon={<AlertTriangle size={20} aria-hidden="true" />} tone={metrics.needingAttention > 0 ? 'paprika' : 'basil'} />
        <StatCard label="Overdue tasks" value={metrics.overdueTasks} icon={<CalendarClock size={20} aria-hidden="true" />} tone={metrics.overdueTasks > 0 ? 'tomato' : 'basil'} />
        <StatCard label="Tasks due today" value={metrics.tasksDueToday} icon={<ListChecks size={20} aria-hidden="true" />} tone="turmeric" />
        <StatCard label="Uncommitted repos" value={metrics.uncommittedRepos} icon={<GitBranch size={20} aria-hidden="true" />} tone={metrics.uncommittedRepos > 0 ? 'tomato' : 'basil'} />
        <StatCard label="Unpushed commits" value={metrics.unpushedCommits} icon={<ArrowUpFromLine size={20} aria-hidden="true" />} tone={metrics.unpushedCommits > 0 ? 'tomato' : 'basil'} />
        <StatCard label="Failed deployments" value={metrics.failedDeployments} icon={<Rocket size={20} aria-hidden="true" />} tone={metrics.failedDeployments > 0 ? 'paprika' : 'basil'} />
        <StatCard label="Healthy deployments" value={metrics.healthyDeployments} icon={<HeartPulse size={20} aria-hidden="true" />} tone="basil" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Priority queue */}
        <section className="lg:col-span-2" aria-label="Priority queue">
          <Card>
            <CardHeader
              title="Priority Queue"
              subtitle="Ranked feed — production failures first, stale projects last."
              action={
                <Link href="/reports" className="btn-ghost text-sm">
                  Run report <ArrowRight size={14} aria-hidden="true" />
                </Link>
              }
            />
            {queue.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert size={32} aria-hidden="true" />}
                title="Queue is clear"
                description="No projects currently need attention. Nice work."
              />
            ) : (
              <ul className="space-y-2.5">
                {queue.map((item) => {
                  // A queue item built on scanner-reported facts (unpushed /
                  // uncommitted) is only as current as its last scan. When that
                  // scan is 24h+ old, flag the item so stale local facts never
                  // masquerade as current next to the live feed.
                  const repo = repoOfQueueItem(item, store.repositories);
                  const staleScan = Boolean(
                    repo?.lastScannedAt
                    && (repo.hasUnpushedCommits || repo.hasUncommittedChanges)
                    && Date.now() - new Date(repo.lastScannedAt).getTime() > SCAN_STALE_MS,
                  );
                  return (
                  <li key={`${item.project.id}-${item.rule}`} className={`rounded-xl2 border border-butter-200 border-l-4 p-4 ${queueTone(item.severity)}`}>
                    <Link href={`/projects/${item.project.id}`} className="block group">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-pepper-400">
                            Rule {item.ruleNumber} · {QUEUE_RULE_LABELS[item.rule]}
                          </p>
                          <h3 className="mt-0.5 truncate font-semibold text-pepper-900 group-hover:text-tomato-600 dark:text-flour-50 dark:group-hover:text-tomato-300">
                            {item.title}
                          </h3>
                          <p className="mt-0.5 text-sm text-pepper-500 dark:text-pepper-300">{item.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {staleScan && repo?.lastScannedAt && (
                            <Badge tone="turmeric" title={`Local scanner captured this repo ${timeAgo(repo.lastScannedAt)}`}>
                              <FileDiff size={11} aria-hidden="true" />
                              stale scan · {timeAgo(repo.lastScannedAt)}
                            </Badge>
                          )}
                          <StatusBadge status={item.project.overallStatus} />
                          <PriorityBadge priority={item.project.priority} />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-pepper-400">
                        <span className="font-medium text-pepper-600 dark:text-pepper-200">{item.project.name}</span>
                        <span>activity {timeAgo(item.project.lastActivityAt)}</span>
                      </div>
                    </Link>
                  </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>

        {/* Right column */}
        <div className="space-y-6">
          {/* Today's Top Three */}
          <section aria-label="Today's top three">
            <Card>
              <CardHeader
                title="Today's Top Three"
                subtitle="Highest-impact actions computed automatically."
                action={
                  <div className="flex items-center gap-2">
                    {topThree.length > 0 && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={narrating}
                        aria-label="Explain today's top three with AI"
                        onClick={() => void explainTopThree()}
                      >
                        <Sparkles size={14} className={narrating ? 'animate-pulse' : ''} aria-hidden="true" />
                        {narrating ? 'Thinking…' : 'AI Explain'}
                      </button>
                    )}
                    <TrendingUp size={18} className="text-tomato-500" aria-hidden="true" />
                  </div>
                }
              />
              {(narration || (narrating && !narration)) && (
                <div className="mb-3 rounded-xl2 border border-eggplant-200 bg-eggplant-50 p-3 dark:border-eggplant-800 dark:bg-eggplant-950/60">
                  {narration ? (
                    <>
                      <div className="mb-1 flex items-center gap-2">
                        <Sparkles size={13} className="text-eggplant-600 dark:text-eggplant-300" aria-hidden="true" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-eggplant-700 dark:text-eggplant-300">
                          Why these three matter today
                        </span>
                        <ModelBadge model={narration.model} />
                        <button
                          type="button"
                          aria-label="Regenerate briefing"
                          disabled={narrating}
                          className="ml-auto rounded-md p-1 text-eggplant-500 transition-colors hover:bg-eggplant-100 hover:text-eggplant-700 disabled:opacity-50 dark:hover:bg-eggplant-900"
                          onClick={() => void explainTopThree()}
                        >
                          <RefreshCw size={13} className={narrating ? 'animate-spin' : ''} aria-hidden="true" />
                        </button>
                      </div>
                      <p className="text-sm leading-relaxed text-pepper-700 dark:text-pepper-200">{narration.paragraph}</p>
                      {/* Cite-back links: the projects the paragraph explicitly refers to */}
                      {narration.projectIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-eggplant-500 dark:text-eggplant-400">Cited:</span>
                          {narration.projectIds.map((pid) => {
                            const name = projectNameOf(pid);
                            return name ? (
                              <Link key={pid} href={`/projects/${pid}`} className="chip text-xs">
                                {name} <ArrowRight size={11} aria-hidden="true" />
                              </Link>
                            ) : null;
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Skeleton shimmer while the auto-briefing loads */
                    <div
                      role="status"
                      aria-label="Loading AI briefing"
                      aria-live="polite"
                      className="animate-pulse space-y-2"
                    >
                      <div className="h-2.5 w-32 rounded bg-eggplant-200 dark:bg-eggplant-800" />
                      <div className="h-2.5 w-full rounded bg-eggplant-200 dark:bg-eggplant-800" />
                      <div className="h-2.5 w-3/4 rounded bg-eggplant-200 dark:bg-eggplant-800" />
                    </div>
                  )}
                </div>
              )}

              {/* Per-project drill-down: re-run the narration against one project's queue items */}
              {topThree.length > 0 && involvedProjects.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-pepper-400">Brief one project:</span>
                  <button
                    type="button"
                    aria-pressed={scopeProjectId === 'all'}
                    className={`chip text-xs ${scopeProjectId === 'all' ? 'chip-active' : ''}`}
                    onClick={() => {
                      setScopeProjectId('all');
                      setNarration(null);
                      void explainTopThree('all');
                    }}
                  >
                    All
                  </button>
                  {involvedProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={scopeProjectId === p.id}
                      className={`chip text-xs ${scopeProjectId === p.id ? 'chip-active' : ''}`}
                      onClick={() => briefProject(p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              {topThree.length === 0 ? (
                <p className="text-sm text-pepper-500 dark:text-pepper-300">Nothing urgent. Revisit comparisons and roadmap instead.</p>
              ) : (
                <ol className="space-y-3">
                  {topThree.map((action, i) => (
                    <li key={i} className="flex gap-3">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${i === 0 ? 'bg-paprika-500' : i === 1 ? 'bg-tomato-500' : 'bg-turmeric-500'}`}>
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold leading-snug text-pepper-900 dark:text-flour-50">{action.title}</p>
                        <p className="mt-0.5 text-xs text-pepper-500 dark:text-pepper-300">{action.description}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>

          {/* Automation alerts */}
          <section aria-label="Automation alerts">
            <Card>
              <CardHeader
                title="Automation Alerts"
                subtitle={`${alerts.length} of 14 rules triggered.`}
                action={
                  <Link href="/activity" className="btn-ghost text-sm">
                    Log <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                }
              />
              {alerts.length === 0 ? (
                <p className="text-sm text-pepper-500 dark:text-pepper-300">All rules green. 🎉</p>
              ) : (
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {alerts.slice(0, 8).map((a) => (
                    <li key={`${a.ruleNumber}-${a.title}`} className="flex items-start gap-2 text-sm">
                      <Clock4 size={15} className="mt-0.5 shrink-0 text-pepper-400" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-pepper-800 dark:text-flour-100">
                          <span className="mr-1 text-xs text-pepper-400">R{a.ruleNumber}</span>
                          {a.title}
                        </p>
                        <p className="text-xs text-pepper-500 dark:text-pepper-300">{a.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          {/* Stale watch */}
          <section aria-label="Stale projects">
            <Card>
              <CardHeader title="Stale Watch" subtitle={`No activity for ${store.profile.defaultStaleDays}+ days.`} />
              {metrics.staleProjects === 0 ? (
                <p className="text-sm text-pepper-500 dark:text-pepper-300">No stale projects. 🎉</p>
              ) : (
                <ul className="space-y-2">
                  {store.projects
                    .filter((p) => !p.archived)
                    .map((p) => ({ p, days: Math.floor((Date.now() - new Date(p.lastActivityAt).getTime()) / 86_400_000) }))
                    .filter(({ days }) => days >= store.profile.defaultStaleDays)
                    .sort((a, b) => b.days - a.days)
                    .slice(0, 5)
                    .map(({ p, days }) => (
                      <li key={p.id} className="flex items-center justify-between text-sm">
                        <Link href={`/projects/${p.id}`} className="font-medium hover:text-tomato-600">{p.name}</Link>
                        <span className="text-xs text-pepper-400">{days}d idle</span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
