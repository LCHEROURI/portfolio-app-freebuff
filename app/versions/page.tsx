'use client';

import Link from 'next/link';
import { GitFork, Trophy, ExternalLink } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { timeAgo } from '@/lib/engine';
import { PROVIDER_LABELS } from '@/lib/labels';

export default function VersionsPage() {
  const store = useStore();
  const versions = store.versions
    .filter((v) => !v.isArchived)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  return (
    <div>
      <PageHeader
        title="Versions"
        description="Every implementation of every project, across every builder and model."
      />

      {versions.length === 0 ? (
        <EmptyState icon={<GitFork size={32} aria-hidden="true" />} title="No versions yet" />
      ) : (
        <div className="space-y-4">
          {versions.map((v) => {
            const project = store.projects.find((p) => p.id === v.projectId);
            const repo = v.repositoryId
              ? store.repositories.find((r) => r.id === v.repositoryId)
              : store.repositories.find((r) => r.projectVersionId === v.id);
            const deploys = store.deployments.filter((d) => d.projectVersionId === v.id);
            const failed = deploys.some((d) => d.status === 'ERROR' || d.healthStatus === 'FAILED');
            return (
              <Card key={v.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-bold">{v.versionName}</h3>
                      <StatusBadge status={v.status} />
                      {v.isWinner && <Badge tone="basil"><Trophy size={12} aria-hidden="true" /> winner</Badge>}
                      {failed && <Badge tone="paprika">⚠ deploy</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-pepper-500 dark:text-pepper-300">
                      {project ? <Link href={`/projects/${project.id}`} className="font-medium text-tomato-600 hover:underline dark:text-tomato-300">{project.name}</Link> : 'Unknown project'}
                      {' · '}{v.builder} · {v.model}{v.modelVersion ? ` (${v.modelVersion})` : ''} · {v.developmentPlatform || '—'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-pepper-400">
                      {v.localFolderPath && <span className="font-mono">{v.localFolderPath}</span>}
                      {repo && (
                        <a href={repo.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-tomato-600">
                          {PROVIDER_LABELS[repo.provider]} · {repo.owner}/{repo.repositoryName} <ExternalLink size={11} aria-hidden="true" />
                        </a>
                      )}
                      <span>branch {v.branch}</span>
                      <span>${v.actualCost}/${v.estimatedCost} · {v.developmentHours}h</span>
                    </div>
                  </div>
                  <div className="w-full max-w-48 shrink-0 sm:w-48">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-pepper-400">progress</span>
                      <span className="font-semibold">{v.progress}%</span>
                    </div>
                    <Progress value={v.progress} />
                    <p className="mt-1 text-right text-xs text-pepper-400">activity {timeAgo(v.lastActivityAt)}</p>
                  </div>
                </div>
                {deploys.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {deploys.map((d) => (
                      <Badge key={d.id} tone={d.healthStatus === 'HEALTHY' ? 'basil' : d.healthStatus === 'FAILED' ? 'paprika' : d.healthStatus === 'DEGRADED' ? 'turmeric' : 'eggplant'}>
                        {PROVIDER_LABELS[d.provider]} · {d.environment} · {d.healthStatus.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
