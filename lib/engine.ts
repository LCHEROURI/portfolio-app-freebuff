import {
  type Project, type ProjectVersion, type Repository, type Deployment,
  type Task, type ModelEvaluation, type UserProfile, type ActivityEntry,
} from '@/types';
import { LOCAL_SCAN_EMAIL_HEADING, SCAN_STALE_MS } from './scan';
import { modelLabel } from './labels';

// ============================================================================
// DATE HELPERS
// ============================================================================

export const nowIso = () => new Date().toISOString();

export const daysBetween = (from: string, to: string): number =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);

/**
 * Normalize a date value for local-midnight comparison. `<input type="date">`
 * yields "YYYY-MM-DD", which `new Date()` parses as UTC midnight — in
 * timezones behind UTC that would make a task due today look overdue late
 * yesterday. Parse date-only values as *local* midnight instead.
 */
const toLocalMidnight = (value: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
};

export const isSameDay = (a: string | undefined, b = new Date().toISOString()): boolean => {
  if (!a) return false;
  const da = toLocalMidnight(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

export const isOverdue = (dueDate: string | undefined): boolean => {
  if (!dueDate) return false;
  const due = toLocalMidnight(dueDate).getTime();
  return due < Date.now() && !isSameDay(dueDate);
};

export const isDueToday = (date: string | undefined): boolean => isSameDay(date);

export const isWithin = (date: string | undefined, hours: number): boolean => {
  if (!date) return false;
  return Date.now() - new Date(date).getTime() <= hours * 3_600_000;
};

export const isStale = (date: string | undefined, staleDays: number): boolean => {
  if (!date) return false;
  return Date.now() - new Date(date).getTime() > staleDays * 86_400_000;
};

export const timeAgo = (date: string): string => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

export const formatDate = (date: string | undefined): string => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// ============================================================================
// AGGREGATE STATE
// ============================================================================

export interface AppState {
  profile: UserProfile;
  projects: Project[];
  versions: ProjectVersion[];
  repositories: Repository[];
  deployments: Deployment[];
  tasks: Task[];
  evaluations: ModelEvaluation[];
  activity: ActivityEntry[];
}

export const computeOverallProgress = (versions: ProjectVersion[]): number => {
  if (versions.length === 0) return 0;
  return Math.round(versions.reduce((sum, v) => sum + v.progress, 0) / versions.length);
};

// ============================================================================
// METRICS CARDS
// ============================================================================

export interface Metrics {
  activeProjects: number;
  needingAttention: number;
  overdueTasks: number;
  uncommittedRepos: number;
  unpushedCommits: number;
  failedDeployments: number;
  healthyDeployments: number;
  staleProjects: number;
  blockedProjects: number;
  tasksDueToday: number;
}

export const computeMetrics = (state: AppState): Metrics => {
  const active = state.projects.filter((p) => !p.archived && p.overallStatus !== 'ARCHIVED');
  const staleDays = state.profile.defaultStaleDays;
  return {
    activeProjects: active.length,
    needingAttention: active.filter((p) => queueRank(state, p) > 0).length,
    overdueTasks: state.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate)).length,
    uncommittedRepos: state.repositories.filter((r) => r.hasUncommittedChanges).length,
    unpushedCommits: state.repositories.filter((r) => r.hasUnpushedCommits).length,
    failedDeployments: state.deployments.filter((d) => d.status === 'ERROR' || d.healthStatus === 'FAILED').length,
    healthyDeployments: state.deployments.filter((d) => d.healthStatus === 'HEALTHY').length,
    staleProjects: active.filter((p) => isStale(p.lastActivityAt, staleDays)).length,
    blockedProjects: active.filter((p) => Boolean(p.blocker) || Boolean(activeVersions(state, p.id).find((v) => v.blocker))).length,
    tasksDueToday: state.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isDueToday(t.dueDate)).length,
  };
};

const activeVersions = (state: AppState, projectId: string): ProjectVersion[] =>
  state.versions.filter((v) => v.projectId === projectId && !v.isArchived);

// ============================================================================
// PRIORITY QUEUE
// ============================================================================
// Ranked feed, ordered by rule number:
//   1. Production deployment failure
//   2. Unpushed local work
//   3. Overdue task
//   4. Blocked project
//   5. Missing repository
//   6. Missing deployment
//   7. No next task
//   8. Stale project

export type QueueRule =
  | 'PROD_FAILURE' | 'UNPUSHED' | 'OVERDUE_TASK' | 'BLOCKED'
  | 'MISSING_REPO' | 'MISSING_DEPLOYMENT' | 'NO_NEXT_TASK' | 'STALE';

export const QUEUE_RULE_ORDER: QueueRule[] = [
  'PROD_FAILURE', 'UNPUSHED', 'OVERDUE_TASK', 'BLOCKED',
  'MISSING_REPO', 'MISSING_DEPLOYMENT', 'NO_NEXT_TASK', 'STALE',
];

export interface QueueItem {
  project: Project;
  rule: QueueRule;
  ruleNumber: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  version?: ProjectVersion;
  task?: Task;
}

export const queueRank = (state: AppState, project: Project): number => {
  const item = buildQueueItem(state, project);
  return item ? item.ruleNumber : 0;
};

export const buildQueueItem = (state: AppState, project: Project): QueueItem | null => {
  if (project.archived || project.overallStatus === 'ARCHIVED') return null;
  const versions = activeVersions(state, project.id);
  const current = versions.find((v) => v.id === project.currentVersionId) ?? versions[0];
  const repo = current?.repositoryId
    ? state.repositories.find((r) => r.id === current.repositoryId)
    : state.repositories.find((r) => r.projectVersionId === current?.id);
  const deploys = state.deployments.filter((d) => d.projectVersionId === current?.id);
  const prodFailed = deploys.find((d) => d.environment === 'production' && (d.status === 'ERROR' || d.healthStatus === 'FAILED'));
  const openTasks = state.tasks.filter((t) => t.projectId === project.id && t.status !== 'COMPLETED' && t.status !== 'CANCELED');
  const overdueTask = openTasks.find((t) => isOverdue(t.dueDate));
  const hasNextTask = openTasks.some((t) => t.status === 'NEXT' || t.status === 'IN_PROGRESS');
  const staleDays = state.profile.defaultStaleDays;

  const make = (
    rule: QueueRule, severity: QueueItem['severity'], title: string, description: string, task?: Task,
  ): QueueItem => ({
    project, rule, ruleNumber: QUEUE_RULE_ORDER.indexOf(rule) + 1, severity,
    title, description, version: current, task,
  });

  if (prodFailed) {
    return make('PROD_FAILURE', 'critical',
      `Production deployment failing: ${prodFailed.projectName}`,
      `${prodFailed.lastFailureMessage ?? 'Deployment health check failed.'} (${prodFailed.provider})`);
  }
  if (repo?.hasUnpushedCommits) {
    return make('UNPUSHED', 'high',
      `Unpushed work in ${repo.owner}/${repo.repositoryName}`,
      `${repo.commitsAhead} commit(s) ahead of ${repo.defaultBranch}${repo.hasUncommittedChanges ? ', plus local changes' : ''}. Push to protect your work.`);
  }
  if (overdueTask) {
    return make('OVERDUE_TASK', 'high',
      `Overdue task: ${overdueTask.title}`,
      `Due ${formatDate(overdueTask.dueDate)} — ${project.name}.`,
      overdueTask);
  }
  if (project.blocker || current?.blocker) {
    return make('BLOCKED', 'medium',
      `Blocked: ${project.blocker ?? current?.blocker}`,
      `${project.name} cannot move forward until resolved.`);
  }
  if (!current?.repositoryId && !repo) {
    return make('MISSING_REPO', 'medium',
      'No repository connected',
      `${project.name} has no linked git repository.`);
  }
  if ((repo || current?.repositoryId) && deploys.length === 0) {
    return make('MISSING_DEPLOYMENT', 'medium',
      'No deployment found',
      `${project.name} has a repository but nothing deployed.`);
  }
  if (!hasNextTask) {
    return make('NO_NEXT_TASK', 'low',
      'No next task defined',
      `${project.name} has no NEXT / IN_PROGRESS task. Define the next action.`);
  }
  if (isStale(project.lastActivityAt, staleDays)) {
    return make('STALE', 'low',
      'Project is stale',
      `No activity on ${project.name} for ${staleDays}+ days.`);
  }
  return null;
};

export const buildPriorityQueue = (state: AppState): QueueItem[] =>
  state.projects
    .map((p) => buildQueueItem(state, p))
    .filter((x): x is QueueItem => x !== null)
    .sort((a, b) => a.ruleNumber - b.ruleNumber || a.project.priority.localeCompare(b.project.priority));

/** Resolve the repository a queue item's unpushed/uncommitted facts refer to. */
export const repoOfQueueItem = (item: QueueItem, repos: Repository[]): Repository | undefined =>
  item.version?.repositoryId
    ? repos.find((r) => r.id === item.version!.repositoryId)
    : repos.find((r) => r.projectVersionId === item.version?.id);

/**
 * Stale-scan marker for a queue item. A queue item built on scanner-reported
 * facts (unpushed/uncommitted) is only as current as its last scan; when that
 * scan is 24h+ old, the emailed priority queue appends a '⚠ stale scan' note so
 * stale local facts never masquerade as current. Returns '' when current.
 */
export const staleScanMarker = (state: AppState, item: QueueItem): string => {
  const repo = repoOfQueueItem(item, state.repositories);
  if (!repo?.lastScannedAt) return '';
  if (!repo.hasUnpushedCommits && !repo.hasUncommittedChanges) return '';
  if (Date.now() - new Date(repo.lastScannedAt).getTime() <= SCAN_STALE_MS) return '';
  return ` ⚠ stale scan · ${timeAgo(repo.lastScannedAt)}`;
};

/**
 * Newest/oldest lastScannedAt across scanned repos plus the stale count — the
 * deterministic data behind both the dashboard's LastScanStrip and the emailed
 * report's 'Local scan freshness' section, so the two always agree.
 */
export interface ScanFreshnessSummary {
  scannedCount: number;
  staleCount: number;
  newest?: Repository;
  newestStale: boolean;
  oldest?: Repository;
  oldestStale: boolean;
}

export const scanFreshnessSummary = (state: AppState): ScanFreshnessSummary => {
  const scanned = state.repositories.filter((r) => r.lastScannedAt);
  if (scanned.length === 0) {
    return { scannedCount: 0, staleCount: 0, newestStale: false, oldestStale: false };
  }
  const sorted = [...scanned].sort((a, b) => b.lastScannedAt!.localeCompare(a.lastScannedAt!));
  const staleOf = (repo: Repository) =>
    Date.now() - new Date(repo.lastScannedAt!).getTime() > SCAN_STALE_MS;
  return {
    scannedCount: scanned.length,
    staleCount: sorted.filter(staleOf).length,
    newest: sorted[0],
    newestStale: staleOf(sorted[0]),
    oldest: sorted[sorted.length - 1],
    oldestStale: staleOf(sorted[sorted.length - 1]),
  };
};

// ============================================================================
// TODAY'S TOP THREE
// ============================================================================

export interface ActionItem {
  priority: number;
  title: string;
  description: string;
  projectId?: string;
  taskId?: string;
}

export const buildTopThree = (state: AppState): ActionItem[] => {
  const actions: ActionItem[] = [];

  // Deployments/repositories link to a project through their version, so the
  // narration can cite-back to the project's detail page.
  const projectOfVersion = (versionId: string | undefined): string | undefined => {
    if (!versionId) return undefined;
    return state.versions.find((v) => v.id === versionId)?.projectId;
  };

  // 1. Critical deployment failures first.
  state.deployments
    .filter((d) => d.environment === 'production' && (d.status === 'ERROR' || d.healthStatus === 'FAILED'))
    .forEach((d) => actions.push({
      priority: 1,
      title: `Fix failed production deployment: ${d.projectName}`,
      description: `Health check failed${d.lastFailureMessage ? ` — ${d.lastFailureMessage}` : ''}.`,
      projectId: projectOfVersion(d.projectVersionId),
    }));

  // 2. Unpushed local work.
  state.repositories.filter((r) => r.hasUnpushedCommits).forEach((r) => actions.push({
    priority: 2,
    title: `Push ${r.owner}/${r.repositoryName}`,
    description: `${r.commitsAhead} unpushed commit(s)${r.hasUncommittedChanges ? ' + uncommitted changes' : ''}.`,
    projectId: projectOfVersion(r.projectVersionId),
  }));

  // 3. Overdue tasks (highest priority first).
  state.tasks
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate))
    .sort((a, b) => a.priority.localeCompare(b.priority))
    .forEach((t) => actions.push({
      priority: 3,
      title: `Complete overdue task: ${t.title}`,
      description: `Project ${state.projects.find((p) => p.id === t.projectId)?.name ?? 'unknown'} — due ${formatDate(t.dueDate)}.`,
      projectId: t.projectId,
      taskId: t.id,
    }));

  // 4. Tasks due today.
  state.tasks
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isDueToday(t.dueDate))
    .forEach((t) => actions.push({
      priority: 4,
      title: `Today: ${t.title}`,
      description: `Due today in ${state.projects.find((p) => p.id === t.projectId)?.name ?? 'unknown'}.`,
      projectId: t.projectId,
      taskId: t.id,
    }));

  return actions.slice(0, 3);
};

// ============================================================================
// AUTOMATION RULES (14)
// ============================================================================

export interface AutomationAlert {
  ruleNumber: number;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  projectId?: string;
  versionId?: string;
  deploymentId?: string;
  repositoryId?: string;
}

export const runAutomationRules = (state: AppState): AutomationAlert[] => {
  const alerts: AutomationAlert[] = [];
  const staleDays = state.profile.defaultStaleDays;
  const activeProjects = state.projects.filter((p) => !p.archived && p.overallStatus !== 'ARCHIVED');

  // Rule 1 — no activity for N days (stale).
  activeProjects.filter((p) => isStale(p.lastActivityAt, staleDays)).forEach((p) => {
    alerts.push({
      ruleNumber: 1, severity: 'medium',
      title: 'Stale project',
      description: `${p.name} has had no activity for ${daysBetween(p.lastActivityAt, nowIso())} days (threshold ${staleDays}).`,
      projectId: p.id,
    });
  });

  // Rule 2 — uncommitted changes for 24h.
  // We can't know how long changes have existed from a scan snapshot, so we
  // alert whenever a repo reports uncommitted changes and has been scanned.
  state.repositories.filter((r) => r.hasUncommittedChanges).forEach((r) => {
    alerts.push({
      ruleNumber: 2, severity: 'high',
      title: 'Uncommitted changes',
      description: `${r.owner}/${r.repositoryName} has uncommitted local changes.`,
      repositoryId: r.id,
    });
  });

  // Rule 3 — unpushed commits for 24h.
  state.repositories.filter((r) => r.hasUnpushedCommits).forEach((r) => {
    alerts.push({
      ruleNumber: 3, severity: 'high',
      title: 'Unpushed commits',
      description: `${r.owner}/${r.repositoryName} is ${r.commitsAhead} commit(s) ahead of remote.`,
      repositoryId: r.id,
    });
  });

  // Rule 4 — production deployment fails.
  state.deployments
    .filter((d) => d.environment === 'production' && (d.status === 'ERROR' || d.healthStatus === 'FAILED'))
    .forEach((d) => {
      alerts.push({
        ruleNumber: 4, severity: 'critical',
        title: 'Production deployment failing',
        description: `${d.projectName}: ${d.lastFailureMessage ?? 'health check failed'}.`,
        deploymentId: d.id,
      });
    });

  // Rule 5 — repo exists with no deployment.
  state.repositories.forEach((r) => {
    const version = state.versions.find((v) => v.id === r.projectVersionId);
    const deploys = state.deployments.filter((d) => d.projectVersionId === r.projectVersionId);
    if (deploys.length === 0) {
      alerts.push({
        ruleNumber: 5, severity: 'medium',
        title: 'Repository with no deployment',
        description: `${r.owner}/${r.repositoryName} has nothing deployed${version ? ` (${version.versionName})` : ''}.`,
        repositoryId: r.id,
      });
    }
  });

  // Rule 6 — deployment exists with no repo.
  state.deployments.forEach((d) => {
    const version = state.versions.find((v) => v.id === d.projectVersionId);
    const repo = version?.repositoryId
      ? state.repositories.find((r) => r.id === version.repositoryId)
      : state.repositories.find((r) => r.projectVersionId === d.projectVersionId);
    if (!repo) {
      alerts.push({
        ruleNumber: 6, severity: 'low',
        title: 'Deployment with no repository',
        description: `${d.projectName} is deployed but has no linked git repo.`,
        deploymentId: d.id,
      });
    }
  });

  // Rule 7 — project has no next task.
  activeProjects.forEach((p) => {
    const hasNext = state.tasks.some((t) => t.projectId === p.id && t.status !== 'COMPLETED' && t.status !== 'CANCELED');
    if (!hasNext && p.overallStatus !== 'CONCEPT' && !p.overallStatus.includes('ARCHIVED')) {
      alerts.push({
        ruleNumber: 7, severity: 'low',
        title: 'No next task',
        description: `${p.name} has no open tasks. Define the next action.`,
        projectId: p.id,
      });
    }
  });

  // Rule 8 — task is overdue.
  state.tasks
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate))
    .forEach((t) => {
      alerts.push({
        ruleNumber: 8, severity: 'high',
        title: 'Overdue task',
        description: `"${t.title}" was due ${formatDate(t.dueDate)}.`,
        projectId: t.projectId,
      });
    });

  // Rule 9 — progress hasn't changed in 14 days.
  const fourteenDaysAgo = Date.now() - 14 * 86_400_000;
  state.versions.forEach((v) => {
    if (!v.isArchived && new Date(v.lastActivityAt).getTime() < fourteenDaysAgo) {
      alerts.push({
        ruleNumber: 9, severity: 'low',
        title: 'Progress stalled',
        description: `${v.versionName} progress (${v.progress}%) unchanged in 14+ days.`,
        projectId: v.projectId, versionId: v.id,
      });
    }
  });

  // Rule 10 — multiple versions, no winner selected.
  activeProjects.forEach((p) => {
    const versions = activeVersions(state, p.id);
    if (versions.length > 1 && !p.winningVersionId && !versions.some((v) => v.isWinner)) {
      alerts.push({
        ruleNumber: 10, severity: 'medium',
        title: 'Multiple versions, no winner',
        description: `${p.name} has ${versions.length} active builds. Run the comparison and pick a winner.`,
        projectId: p.id,
      });
    }
  });

  // Rule 11 — production URL fails health check.
  state.deployments
    .filter((d) => d.environment === 'production' && (d.healthStatus === 'FAILED' || d.healthStatus === 'DEGRADED'))
    .forEach((d) => {
      alerts.push({
        ruleNumber: 11, severity: 'high',
        title: 'Production health check failing',
        description: `${d.deploymentUrl} responded ${d.responseCode ?? 'unknown'} in ${d.responseTimeMs ?? '?'}ms.`,
        deploymentId: d.id,
      });
    });

  // Rule 12 — OAuth token expires (repo auth errors surface here).
  state.repositories.filter((r) => r.connectionStatus === 'AUTH_ERROR').forEach((r) => {
    alerts.push({
      ruleNumber: 12, severity: 'high',
      title: 'Repository auth error',
      description: `${r.owner}/${r.repositoryName} — re-authorize the token.`,
      repositoryId: r.id,
    });
  });

  // Rule 13 — project lacks status review in 7 days.
  activeProjects.forEach((p) => {
    if (isStale(p.updatedAt, 7) && p.overallStatus !== 'CONCEPT') {
      alerts.push({
        ruleNumber: 13, severity: 'low',
        title: 'Needs status review',
        description: `${p.name} hasn't had a status update in 7+ days.`,
        projectId: p.id,
      });
    }
  });

  // Rule 14 — version marked complete without an evaluation.
  state.versions.forEach((v) => {
    const isComplete = v.status === 'TESTING' || v.status === 'WINNER_SELECTED';
    const hasEval = state.evaluations.some((e) => e.projectVersionId === v.id);
    if (isComplete && !hasEval) {
      alerts.push({
        ruleNumber: 14, severity: 'medium',
        title: 'Completed without evaluation',
        description: `${v.versionName} is ${v.status} but has no Model Evaluation scores.`,
        projectId: v.projectId, versionId: v.id,
      });
    }
  });

  return alerts.sort((a, b) => a.ruleNumber - b.ruleNumber);
};

// ============================================================================
// REPORTS
// ============================================================================

export const buildDailyReportBody = (state: AppState): { title: string; body: string; attentionCount: number } => {
  const metrics = computeMetrics(state);
  const queue = buildPriorityQueue(state);
  const topThree = buildTopThree(state);
  const doneYesterday = state.tasks.filter((t) => {
    const done = t.completedAt ? new Date(t.completedAt) : null;
    if (!done) return false;
    const yesterday = new Date(Date.now() - 86_400_000);
    return done.getFullYear() === yesterday.getFullYear() && done.getMonth() === yesterday.getMonth() && done.getDate() === yesterday.getDate();
  });
  const dueToday = state.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isDueToday(t.dueDate));
  const overdue = state.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate));
  const scan = scanFreshnessSummary(state);

  const lines: string[] = [
    `# Daily Command Center Report — ${new Date().toLocaleDateString()}`,
    '',
    `**Attention items:** ${metrics.needingAttention}  ·  **Overdue:** ${metrics.overdueTasks}  ·  **Due today:** ${dueToday.length}  ·  **Failed deploys:** ${metrics.failedDeployments}  ·  **Unpushed:** ${metrics.unpushedCommits}`,
    '',
    `## ${LOCAL_SCAN_EMAIL_HEADING}`,
    ...(scan.scannedCount === 0
      ? ['- No local scans yet — run `npm run scan:all` to seed the feed.']
      : [
          `- Newest: **${scan.newest!.owner}/${scan.newest!.repositoryName}** — scanned ${timeAgo(scan.newest!.lastScannedAt!)}${scan.newestStale ? ' ⚠ stale' : ''}`,
          `- Oldest: **${scan.oldest!.owner}/${scan.oldest!.repositoryName}** — scanned ${timeAgo(scan.oldest!.lastScannedAt!)}${scan.oldestStale ? ' ⚠ stale' : ''}`,
          `- ${scan.staleCount} of ${scan.scannedCount} repo(s) have a scan older than 24h.`,
        ]),
    '',
    '## Top 3 actions',
    ...(topThree.length ? topThree.map((a, i) => `${i + 1}. **${a.title}** — ${a.description}`) : ['1. Nothing urgent. Enjoy the calm.']),
    '',
    '## Overdue tasks',
    ...(overdue.length ? overdue.map((t) => `- [ ] ${t.title} (due ${formatDate(t.dueDate)})`) : ['- None 🎉']),
    '',
    '## Due today',
    ...(dueToday.length ? dueToday.map((t) => `- [ ] ${t.title}`) : ['- Nothing due today.']),
    '',
    '## Completed yesterday',
    ...(doneYesterday.length ? doneYesterday.map((t) => `- [x] ${t.title}`) : ['- None.']),
    '',
    '## Priority queue',
    ...(queue.length
      ? queue.map((q) => `${q.ruleNumber}. [${q.severity.toUpperCase()}] ${q.title}${staleScanMarker(state, q)}`)
      : ['- Queue is clear.']),
  ];

  return { title: `Daily Report ${new Date().toLocaleDateString()}`, body: lines.join('\n'), attentionCount: metrics.needingAttention };
};

export const buildWeeklyReportBody = (state: AppState): { title: string; body: string; attentionCount: number } => {
  const metrics = computeMetrics(state);
  const queue = buildPriorityQueue(state);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const advanced = state.versions.filter((v) => new Date(v.lastActivityAt).getTime() > weekAgo && v.progress > 0);
  const healthy = state.deployments.filter((d) => d.healthStatus === 'HEALTHY').length;
  const scan = scanFreshnessSummary(state);

  const lines: string[] = [
    `# Weekly Command Center Report — week of ${new Date().toLocaleDateString()}`,
    '',
    `**Active projects:** ${metrics.activeProjects}  ·  **Healthy deployments:** ${healthy}/${state.deployments.length}  ·  **Attention items:** ${metrics.needingAttention}`,
    '',
    `## ${LOCAL_SCAN_EMAIL_HEADING}`,
    ...(scan.scannedCount === 0
      ? ['- No local scans yet — run `npm run scan:all` to seed the feed.']
      : [
          `- Newest: **${scan.newest!.owner}/${scan.newest!.repositoryName}** — scanned ${timeAgo(scan.newest!.lastScannedAt!)}${scan.newestStale ? ' ⚠ stale' : ''}`,
          `- Oldest: **${scan.oldest!.owner}/${scan.oldest!.repositoryName}** — scanned ${timeAgo(scan.oldest!.lastScannedAt!)}${scan.oldestStale ? ' ⚠ stale' : ''}`,
          `- ${scan.staleCount} of ${scan.scannedCount} repo(s) have a scan older than 24h.`,
        ]),
    '',
    '## Projects advanced this week',
    ...(advanced.length
      ? advanced.map((v) => `- **${v.versionName}** (${v.builder} / ${v.model}) — ${v.progress}%`)
      : ['- No measurable progress this week.']),
    '',
    '## Deployment health',
    ...(state.deployments.length
      ? state.deployments.map((d) => `- ${d.projectName} [${d.environment}] → ${d.healthStatus} (${d.responseTimeMs ?? '?'}ms)`)
      : ['- No deployments tracked.']),
    '',
    '## Model performance breakdown',
    ...(state.evaluations.length
      ? state.evaluations.map((e) => `- ${modelLabel(e.model)} (${e.builder}): overall **${e.overallScore}/10**`)
      : ['- No evaluations yet.']),
    '',
    '## Winner recommendation',
    ...(queue.some((q) => q.rule === 'NO_NEXT_TASK' || q.rule === 'PROD_FAILURE')
      ? queue.filter((q) => ['PROD_FAILURE', 'NO_NEXT_TASK', 'BLOCKED'].includes(q.rule)).map((q) => `- ${q.title} — ${q.description}`)
      : ['- All projects healthy enough; re-run comparisons before choosing.']),
    '',
    '## Priority queue',
    ...(queue.length
      ? queue.map((q) => `${q.ruleNumber}. [${q.severity.toUpperCase()}] ${q.title}${staleScanMarker(state, q)}`)
      : ['- Queue is clear.']),
  ];

  return { title: `Weekly Report ${new Date().toLocaleDateString()}`, body: lines.join('\n'), attentionCount: metrics.needingAttention };
};

// ============================================================================
// MONTHLY REPORT
// ============================================================================

/** The rolling window the monthly report reasons over (30 days). */
export const MONTHLY_WINDOW_MS = 30 * 86_400_000;

/**
 * Structured facts the monthly AI briefing narrates. Kept separate from the
 * deterministic body so the cron can hand the AI the same figures the text
 * renders (never invented numbers) — mirroring how the daily top-three
 * narration receives the exact actions it must describe.
 */
export interface MonthlyBriefingFacts {
  /** Versions with activity in the window and progress > 0 (velocity). */
  velocity: string[];
  /** Best model this month, e.g. 'DeepSeek Chat (best 9/10)'. */
  leadingModel: string | null;
  /** Evaluation trend line per model in the window, best first. */
  trends: string[];
  /** Aging/overdue open-task facts for the drift section. */
  drift: string[];
  /** Deployment health this month. */
  deployments: string[];
  /** Tasks completed within the window. */
  completedCount: number;
}

/**
 * The deterministic facts behind the monthly report: what advanced (velocity),
 * which model led on evaluations (winner trends), and how the backlog aged
 * (drift). Consumed by buildMonthlyReportBody for the text and by the cron's
 * AI briefing for the narrative, so the two can never disagree.
 */
export const buildMonthlyBriefingFacts = (state: AppState): MonthlyBriefingFacts => {
  const since = Date.now() - MONTHLY_WINDOW_MS;

  const velocity = state.versions
    .filter((v) => new Date(v.lastActivityAt).getTime() > since && v.progress > 0)
    .map((v) => `${v.versionName} (${v.builder} / ${v.model}) — ${v.progress}%`);

  const monthEvals = state.evaluations.filter((e) => new Date(e.evaluatedAt).getTime() > since);
  const byModel = new Map<string, number[]>();
  for (const e of monthEvals) {
    byModel.set(e.model, [...(byModel.get(e.model) ?? []), e.overallScore]);
  }
  const rows = Array.from(byModel.entries())
    .map(([model, scores]) => ({
      model,
      count: scores.length,
      best: Math.max(...scores),
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => b.best - a.best);
  const trends = rows.map((r) => `${modelLabel(r.model)} — best ${r.best}/10, avg ${r.avg.toFixed(1)}/10 across ${r.count} evaluation(s)`);
  const leadingModel = rows[0] ? `${modelLabel(rows[0].model)} (best ${rows[0].best}/10)` : null;

  const open = state.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED');
  const drifted = open.filter((t) => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    return created < since || isOverdue(t.dueDate);
  });
  const oldest = [...drifted].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0];
  const drift = [`${drifted.length} open task(s) stale or overdue`];
  if (oldest) drift.push(`oldest: ${oldest.title} (created ${formatDate(oldest.createdAt)})`);
  for (const t of drifted.slice(0, 8)) {
    drift.push(t.dueDate ? `due ${formatDate(t.dueDate)}: ${t.title}` : `no due date: ${t.title}`);
  }

  const monthDeploys = state.deployments.filter((d) => {
    const at = d.lastDeploymentAt ? new Date(d.lastDeploymentAt).getTime() : 0;
    return at > since;
  });
  const healthy = monthDeploys.filter((d) => d.healthStatus === 'HEALTHY').length;
  const deployments = monthDeploys.length
    ? [`${healthy} of ${monthDeploys.length} deployment(s) healthy this month`]
    : ['no deployments this month'];

  const completedCount = state.tasks.filter((t) => {
    const done = t.completedAt ? new Date(t.completedAt).getTime() : 0;
    return done > since;
  }).length;

  return { velocity, leadingModel, trends, drift, deployments, completedCount };
};

/**
 * Deterministic monthly report: project velocity (what advanced this month),
 * winner trends (which model led evaluations), and backlog drift (how the
 * open-task backlog aged). This is the source of truth the AI briefing
 * narrates — AI only ever rephrases these facts.
 */
export const buildMonthlyReportBody = (state: AppState): { title: string; body: string; attentionCount: number } => {
  const metrics = computeMetrics(state);
  const queue = buildPriorityQueue(state);
  const f = buildMonthlyBriefingFacts(state);

  const lines: string[] = [
    `# Monthly Command Center Report — ${new Date().toLocaleDateString()}`,
    '',
    `**Active projects:** ${metrics.activeProjects}  ·  **Tasks completed this month:** ${f.completedCount}  ·  ${f.deployments[0] ?? 'no deployments'}  ·  **Attention items:** ${metrics.needingAttention}`,
    '',
    '## Velocity — what advanced this month',
    ...(f.velocity.length
      ? f.velocity.map((v) => `- ${v}`)
      : ['- No measurable progress this month.']),
    '',
    '## Winner trends — model performance this month',
    ...(f.trends.length
      ? f.trends.map((t, i) => `- ${i + 1}. ${t}`)
      : ['- No evaluations this month.']),
    ...(f.leadingModel ? [`- **Leading model this month:** ${f.leadingModel}.`] : []),
    '',
    '## Backlog drift',
    `- ${f.drift.length ? f.drift.join(' · ') : 'No stale or overdue open tasks 🎉'}`,
    ...(f.drift.length > 2 ? f.drift.slice(2).map((d) => `  - ${d}`) : []),
    '',
    '## Deployment health this month',
    ...(state.deployments.length
      ? state.deployments
          .filter((d) => (d.lastDeploymentAt ? new Date(d.lastDeploymentAt).getTime() > Date.now() - MONTHLY_WINDOW_MS : true))
          .map((d) => `- ${d.projectName} [${d.environment}] → ${d.healthStatus} (${d.responseTimeMs ?? '?'}ms)`)
      : ['- No deployments tracked.']),
    '',
    '## Priority queue',
    ...(queue.length
      ? queue.map((q) => `${q.ruleNumber}. [${q.severity.toUpperCase()}] ${q.title}${staleScanMarker(state, q)}`)
      : ['- Queue is clear.']),
  ];

  return { title: `Monthly Report ${new Date().toLocaleDateString()}`, body: lines.join('\n'), attentionCount: metrics.needingAttention };
};

// ============================================================================
// MODEL COMPARISON
// ============================================================================

export interface ComparisonRow {
  project: Project;
  evaluations: ModelEvaluation[];
}

export const buildComparison = (state: AppState): ComparisonRow[] =>
  state.projects
    .filter((p) => !p.archived)
    .map((project) => ({
      project,
      evaluations: state.evaluations.filter((e) => e.projectId === project.id),
    }))
    .filter((row) => row.evaluations.length > 0);

// ============================================================================
// WEEKLY WINNER RECOMMENDATION CANDIDATES
// ============================================================================

/** One project's AI winner-recommendation input (mirrors the Model Comparison UI). */
export interface WinnerCandidateInput {
  projectName: string;
  candidates: Array<{
    versionId: string;
    versionName: string;
    builder: string;
    model: string;
    overallScore: number;
    scores: Record<string, number>;
  }>;
}

/**
 * Projects ripe for an AI winner pick (rule 10: multiple active versions, no
 * winner selected, and at least one evaluation to reason over). Candidates are
 * the project's evaluations sorted by overall score so the model always sees
 * the strongest version first. Bounded to `limit` projects so the weekly cron's
 * OpenRouter budget stays predictable.
 */
export const buildWinnerCandidates = (state: AppState, limit = 3): WinnerCandidateInput[] => {
  const scoreKeys: Array<[string, keyof ModelEvaluation]> = [
    ['UI', 'uiScore'], ['Features', 'featureScore'], ['Code', 'codeQualityScore'],
    ['Stability', 'stabilityScore'], ['Performance', 'performanceScore'],
    ['Maint.', 'maintainabilityScore'], ['Speed', 'developmentSpeedScore'],
    ['Cost', 'costScore'], ['Mobile', 'mobileScore'], ['A11y', 'accessibilityScore'],
  ];
  const out: WinnerCandidateInput[] = [];
  for (const project of state.projects) {
    if (project.archived || project.overallStatus === 'ARCHIVED') continue;
    const versions = activeVersions(state, project.id);
    if (versions.length <= 1) continue;
    if (project.winningVersionId || versions.some((v) => v.isWinner)) continue;
    const evals = state.evaluations.filter((e) => e.projectId === project.id);
    if (evals.length === 0) continue;
    out.push({
      projectName: project.name,
      candidates: [...evals]
        .sort((a, b) => b.overallScore - a.overallScore)
        .map((e) => ({
          versionId: e.projectVersionId,
          versionName: state.versions.find((v) => v.id === e.projectVersionId)?.versionName ?? e.model,
          builder: e.builder,
          model: e.model,
          overallScore: e.overallScore,
          scores: Object.fromEntries(scoreKeys.map(([label, key]) => [label, e[key] as number])),
        })),
    });
    if (out.length >= limit) break;
  }
  return out;
};
