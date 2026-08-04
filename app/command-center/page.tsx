'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FolderKanban, AlertTriangle, CalendarClock, GitBranch, ArrowUpFromLine, Rocket,
  HeartPulse, Clock4, ShieldAlert, ArrowRight, ListChecks, TrendingUp, Plug, Sparkles,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard, Card, CardHeader } from '@/components/ui/Card';
import { Badge, StatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { VercelEnvSettingsLink } from '@/components/integrations/VercelEnvSettingsLink';
import { isFirebaseConfigured } from '@/lib/firebase';
import { fetchTopThreeNarration, readLiveFlags } from '@/lib/liveData';
import { useStore } from '@/lib/store';
import {
  computeMetrics, buildPriorityQueue, buildTopThree, runAutomationRules, timeAgo,
} from '@/lib/engine';
import { QUEUE_RULE_LABELS } from '@/lib/labels';

export default function CommandCenterPage() {
  const store = useStore();
  const metrics = computeMetrics(store);
  const queue = buildPriorityQueue(store);
  const topThree = buildTopThree(store);
  const alerts = runAutomationRules(store);

  // AI narration of today's top three — an enhancement layer. When OpenRouter
  // is unconfigured or the call fails, narration stays null and the card shows
  // the rule-based list unchanged.
  const [narration, setNarration] = useState<{ paragraph: string; model: string } | null>(null);
  const [narrating, setNarrating] = useState(false);

  // A narration describes the actions that existed when it was generated. If the
  // underlying data changes (task completed, deploy recovered) the deterministic
  // list is recomputed, so drop the stale paragraph rather than show a story
  // about actions that no longer exist. The AI Explain button stays available as
  // a manual regenerate.
  const topThreeSignature = topThree.map((a) => `${a.title}::${a.description}`).join('|');
  useEffect(() => {
    setNarration(null);
  }, [topThreeSignature]);

  const explainTopThree = async () => {
    if (narrating || topThree.length === 0) return;
    setNarrating(true);
    try {
      const result = await fetchTopThreeNarration(store.userId, {
        actions: topThree.map((a) => ({ priority: a.priority, title: a.title, description: a.description })),
        // Per-user model preference from Settings → AI summaries.
        model: store.profile.aiModel || undefined,
      });
      setNarration(result.narration ? { paragraph: result.narration.paragraph, model: result.narration.model } : null);
    } catch {
      setNarration(null);
    } finally {
      setNarrating(false);
    }
  };

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
                {queue.map((item) => (
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
                ))}
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
                        onClick={explainTopThree}
                      >
                        <Sparkles size={14} className={narrating ? 'animate-pulse' : ''} aria-hidden="true" />
                        {narrating ? 'Thinking…' : 'AI Explain'}
                      </button>
                    )}
                    <TrendingUp size={18} className="text-tomato-500" aria-hidden="true" />
                  </div>
                }
              />
              {narration && (
                <div className="mb-3 rounded-xl2 border border-eggplant-200 bg-eggplant-50 p-3 dark:border-eggplant-800 dark:bg-eggplant-950/60">
                  <div className="mb-1 flex items-center gap-2">
                    <Sparkles size={13} className="text-eggplant-600 dark:text-eggplant-300" aria-hidden="true" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-eggplant-700 dark:text-eggplant-300">
                      Why these three matter today
                    </span>
                    {narration.model && <Badge tone="eggplant">{narration.model}</Badge>}
                  </div>
                  <p className="text-sm leading-relaxed text-pepper-700 dark:text-pepper-200">{narration.paragraph}</p>
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
