'use client';

import Link from 'next/link';
import { GitFork, Rocket, Pencil } from 'lucide-react';

import { StatusBadge, PriorityBadge, Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { timeAgo } from '@/lib/engine';
import type { Project, ProjectVersion, Deployment } from '@/types';

export const projectStats = (
  project: Project,
  versions: ProjectVersion[],
  deployments: Deployment[],
) => {
  const v = versions.filter((x) => x.projectId === project.id && !x.isArchived);
  const d = deployments.filter((x) => v.some((ver) => ver.id === x.projectVersionId));
  const failed = d.some((x) => x.status === 'ERROR' || x.healthStatus === 'FAILED');
  return { versions: v, deployments: d, failed };
};

export const ProjectCard = ({ project, versions, deployments, onEdit }: {
  project: Project; versions: ProjectVersion[]; deployments: Deployment[]; onEdit: () => void;
}) => {
  const { versions: v, deployments: d, failed } = projectStats(project, versions, deployments);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="card-base group relative flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:shadow-plate"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold group-hover:text-tomato-600">{project.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-pepper-500 dark:text-pepper-300">{project.description || project.category || 'No description yet.'}</p>
        </div>
        <button
          type="button"
          aria-label={`Edit ${project.name}`}
          className="btn-ghost shrink-0 rounded-md p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={project.overallStatus} />
        <PriorityBadge priority={project.priority} />
        {failed && <Badge tone="paprika">⚠ deploy issue</Badge>}
        {project.blocker && <Badge tone="paprika">blocked</Badge>}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-pepper-500 dark:text-pepper-300">Overall progress</span>
          <span className="font-semibold">{project.overallProgress}%</span>
        </div>
        <Progress value={project.overallProgress} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-butter-200 pt-3 text-xs text-pepper-400 dark:border-pepper-700">
        <span className="inline-flex items-center gap-1"><GitFork size={13} aria-hidden="true" /> {v.length} version{v.length === 1 ? '' : 's'}</span>
        <span className="inline-flex items-center gap-1"><Rocket size={13} aria-hidden="true" /> {d.length} deploys</span>
        <span>{timeAgo(project.lastActivityAt)}</span>
      </div>
    </Link>
  );
};

export const ProjectTableRow = ({ project, versions, deployments, onEdit }: {
  project: Project; versions: ProjectVersion[]; deployments: Deployment[]; onEdit: () => void;
}) => {
  const { versions: v, deployments: d, failed } = projectStats(project, versions, deployments);
  return (
    <tr className="group border-b border-butter-200 last:border-0 hover:bg-butter-100/60 dark:border-pepper-700 dark:hover:bg-pepper-700/50">
      <td className="py-3 pl-4">
        <Link href={`/projects/${project.id}`} className="block">
          <p className="font-semibold text-pepper-900 group-hover:text-tomato-600 dark:text-flour-50">{project.name}</p>
          <p className="text-xs text-pepper-400">{project.category || project.slug}</p>
        </Link>
      </td>
      <td className="py-3"><StatusBadge status={project.overallStatus} /></td>
      <td className="py-3"><PriorityBadge priority={project.priority} /></td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <span className="w-10 text-right text-xs font-semibold">{project.overallProgress}%</span>
          <div className="w-20"><Progress value={project.overallProgress} /></div>
        </div>
      </td>
      <td className="py-3 text-xs text-pepper-500 dark:text-pepper-300">{v.length} versions · {d.length} deploys{failed ? ' · ⚠' : ''}</td>
      <td className="py-3 pr-4 text-right">
        <button type="button" aria-label={`Edit ${project.name}`} className="btn-ghost rounded-md p-1.5" onClick={onEdit}>
          <Pencil size={15} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
};
