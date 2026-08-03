import { type ReactNode } from 'react';
import {
  type PriorityLevel, type ProjectStatus, type TaskStatus, type HealthStatus,
  type DeploymentStatus, PRIORITY_LEVELS, PROJECT_STATUSES, TASK_STATUSES,
} from '@/types';

const tone = {
  tomato: 'bg-tomato-100 text-tomato-700 border-tomato-200 dark:bg-tomato-900/60 dark:text-tomato-200 dark:border-tomato-800',
  basil: 'bg-basil-100 text-basil-700 border-basil-200 dark:bg-basil-900/60 dark:text-basil-200 dark:border-basil-800',
  turmeric: 'bg-turmeric-100 text-turmeric-700 border-turmeric-200 dark:bg-turmeric-900/60 dark:text-turmeric-200 dark:border-turmeric-800',
  paprika: 'bg-paprika-100 text-paprika-700 border-paprika-200 dark:bg-paprika-900/60 dark:text-paprika-200 dark:border-paprika-800',
  pepper: 'bg-pepper-100 text-pepper-700 border-pepper-200 dark:bg-pepper-800 dark:text-flour-100 dark:border-pepper-600',
  eggplant: 'bg-eggplant-100 text-eggplant-700 border-eggplant-200 dark:bg-eggplant-900/60 dark:text-eggplant-200 dark:border-eggplant-800',
  lemon: 'bg-lemon-100 text-lemon-700 border-lemon-200 dark:bg-lemon-900/60 dark:text-lemon-200 dark:border-lemon-800',
} as const;

export type Tone = keyof typeof tone;

export const Badge = ({ tone: t = 'pepper', children, className = '' }: {
  tone?: Tone; children: ReactNode; className?: string;
}) => (
  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tone[t]} ${className}`}>
    {children}
  </span>
);

export const priorityTone = (p: PriorityLevel): Tone =>
  p === 'P0_CRITICAL' ? 'paprika' : p === 'P1_HIGH' ? 'tomato' : p === 'P2_MEDIUM' ? 'turmeric' : 'pepper';

export const PriorityBadge = ({ priority }: { priority: PriorityLevel }) => (
  <Badge tone={priorityTone(priority)}>{priority.replace('_', ' ')}</Badge>
);

export const statusTone = (s: ProjectStatus | TaskStatus): Tone => {
  switch (s) {
    case 'CONCEPT': case 'BACKLOG': return 'pepper';
    case 'BUILDING': case 'IN_PROGRESS': return 'turmeric';
    case 'TESTING': case 'REVIEW': return 'eggplant';
    case 'PAUSED': case 'CANCELED': return 'lemon';
    case 'WINNER_SELECTED': case 'COMPLETED': return 'basil';
    case 'BLOCKED': return 'paprika';
    case 'ARCHIVED': return 'pepper';
    default: return 'pepper';
  }
};

export const StatusBadge = ({ status }: { status: ProjectStatus | TaskStatus }) => (
  <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>
);

export const healthTone = (h: HealthStatus): Tone =>
  h === 'HEALTHY' ? 'basil' : h === 'DEGRADED' ? 'turmeric' : h === 'FAILED' ? 'paprika' : h === 'UNKNOWN' ? 'eggplant' : 'pepper';

export const HealthBadge = ({ health }: { health: HealthStatus }) => (
  <Badge tone={healthTone(health)}>{health.replace(/_/g, ' ')}</Badge>
);

export const deploymentTone = (s: DeploymentStatus): Tone =>
  s === 'READY' ? 'basil' : s === 'BUILDING' ? 'turmeric' : s === 'ERROR' ? 'paprika' : 'pepper';

export const DeploymentStatusBadge = ({ status }: { status: DeploymentStatus }) => (
  <Badge tone={deploymentTone(status)}>{status.replace(/_/g, ' ')}</Badge>
);

export { PROJECT_STATUSES, TASK_STATUSES, PRIORITY_LEVELS };
