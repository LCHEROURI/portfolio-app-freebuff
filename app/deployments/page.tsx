'use client';

import { Rocket, ExternalLink, HeartPulse } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, StatCard } from '@/components/ui/Card';
import { HealthBadge, DeploymentStatusBadge, Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { timeAgo } from '@/lib/engine';
import { PROVIDER_LABELS } from '@/lib/labels';

export default function DeploymentsPage() {
  const store = useStore();
  const deployments = store.deployments.sort((a, b) => (b.lastDeploymentAt ?? '').localeCompare(a.lastDeploymentAt ?? ''));
  const healthy = deployments.filter((d) => d.healthStatus === 'HEALTHY').length;
  const failed = deployments.filter((d) => d.status === 'ERROR' || d.healthStatus === 'FAILED').length;

  const versionLabel = (id?: string) => {
    if (!id) return 'No version';
    const v = store.versions.find((x) => x.id === id);
    if (!v) return 'Unknown version';
    const p = store.projects.find((x) => x.id === v.projectId);
    return `${p?.name ?? 'Project'} / ${v.versionName}`;
  };

  return (
    <div>
      <PageHeader
        title="Deployments"
        description="Every environment, health check, and rollout across all versions."
      />

      <section aria-label="Deployment metrics" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Total deployments" value={deployments.length} icon={<Rocket size={20} aria-hidden="true" />} tone="eggplant" />
        <StatCard label="Healthy" value={healthy} icon={<HeartPulse size={20} aria-hidden="true" />} tone="basil" />
        <StatCard label="Failing" value={failed} icon={<HeartPulse size={20} aria-hidden="true" />} tone={failed > 0 ? 'paprika' : 'basil'} />
        <StatCard label="Production" value={deployments.filter((d) => d.environment === 'production').length} icon={<Rocket size={20} aria-hidden="true" />} tone="tomato" />
      </section>

      {deployments.length === 0 ? (
        <EmptyState icon={<Rocket size={32} aria-hidden="true" />} title="No deployments yet" description="Deployments appear here once a version has a live environment." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {deployments.map((d) => (
            <Card key={d.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-base font-bold">{d.projectName}</h3>
                  <p className="text-xs text-pepper-400">{PROVIDER_LABELS[d.provider]} · {d.environment}</p>
                </div>
                <HealthBadge health={d.healthStatus} />
              </div>

              <p className="mt-1 text-xs text-pepper-500 dark:text-pepper-300">{versionLabel(d.projectVersionId)}</p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <DeploymentStatusBadge status={d.status} />
                {d.framework && <Badge>{d.framework}</Badge>}
                {d.branch && <Badge>{d.branch}</Badge>}
                {d.responseCode != null && (
                  <span className="text-xs text-pepper-400">{d.responseCode} · {d.responseTimeMs}ms</span>
                )}
              </div>

              {d.lastFailureMessage && (
                <p className="mt-2 rounded-lg bg-paprika-50 px-2.5 py-1.5 text-xs text-paprika-700 dark:bg-paprika-950 dark:text-paprika-300">
                  {d.lastFailureMessage}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-butter-200 pt-3 text-xs text-pepper-400 dark:border-pepper-700">
                <span>deployed {timeAgo(d.lastDeploymentAt ?? d.createdAt)}</span>
                <a href={d.deploymentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-tomato-600 hover:underline dark:text-tomato-300">
                  Open <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
