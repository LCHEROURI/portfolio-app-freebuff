import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

admin.initializeApp();

const db = admin.firestore();

// ============================================================================
// COLLECTIONS
// ============================================================================

interface UserProfile {
  id: string;
  name?: string;
  email?: string;
  timezone?: string;
  dailyReportEnabled?: boolean;
  dailyReportTime?: string;
  weeklyReportEnabled?: boolean;
  weeklyReportDay?: number;
  weeklyReportTime?: string;
  defaultStaleDays?: number;
}

// ============================================================================
// RULE ENGINE (mirrors lib/engine.ts on the client)
// ============================================================================

const nowIso = () => new Date().toISOString();

const daysSince = (iso?: string): number | null => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
};

const hoursSince = (iso?: string): number | null => {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
};

const isOverdue = (dueDate?: string): boolean => {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
};

export interface AutomationAlert {
  ruleNumber: number;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  projectId?: string;
  versionId?: string;
}

interface RuleContext {
  projects: Array<Record<string, unknown> & { id: string }>;
  versions: Array<Record<string, unknown> & { id: string; projectId?: string; isArchived?: boolean; status?: string; lastActivityAt?: string; progress?: number }>;
  repositories: Array<Record<string, unknown> & { id: string; projectVersionId?: string; hasUncommittedChanges?: boolean; hasUnpushedCommits?: boolean; commitsAhead?: number; lastScannedAt?: string; connectionStatus?: string }>;
  deployments: Array<Record<string, unknown> & { id: string; projectVersionId?: string; environment?: string; status?: string; healthStatus?: string; lastFailureMessage?: string; deploymentUrl?: string; responseCode?: number; responseTimeMs?: number }>;
  tasks: Array<Record<string, unknown> & { id: string; projectId?: string; title?: string; status?: string; dueDate?: string }>;
  evaluations: Array<Record<string, unknown> & { id: string; projectVersionId?: string }>;
  staleDays: number;
}

export const runRules = (ctx: RuleContext): AutomationAlert[] => {
  const alerts: AutomationAlert[] = [];
  const { projects, versions, repositories, deployments, tasks, evaluations, staleDays } = ctx;
  const active = projects.filter((p) => !(p.archived as boolean) && p.overallStatus !== 'ARCHIVED');

  // Rule 1 — stale project (no activity for N days).
  active.forEach((p) => {
    const d = daysSince(p.lastActivityAt as string | undefined);
    if (d !== null && d >= staleDays) {
      alerts.push({ ruleNumber: 1, severity: 'medium', title: 'Stale project', description: `${p.name} idle for ${d} days (threshold ${staleDays}).`, projectId: p.id });
    }
  });

  // Rule 2 — uncommitted changes for 24h.
  repositories.filter((r) => r.hasUncommittedChanges && (hoursSince(r.lastScannedAt) ?? 999) < 48).forEach((r) => {
    alerts.push({ ruleNumber: 2, severity: 'high', title: 'Uncommitted changes', description: `Repo ${r.id} has uncommitted local changes.` });
  });

  // Rule 3 — unpushed commits for 24h.
  repositories.filter((r) => r.hasUnpushedCommits).forEach((r) => {
    alerts.push({ ruleNumber: 3, severity: 'high', title: 'Unpushed commits', description: `Repo ${r.id} is ${r.commitsAhead ?? 0} commit(s) ahead of remote.` });
  });

  // Rule 4 — production deployment fails.
  deployments.filter((d) => d.environment === 'production' && (d.status === 'ERROR' || d.healthStatus === 'FAILED')).forEach((d) => {
    alerts.push({ ruleNumber: 4, severity: 'critical', title: 'Production deployment failing', description: d.lastFailureMessage ?? 'Health check failed.' });
  });

  // Rule 5 — repo exists with no deployment.
  repositories.forEach((r) => {
    const hasDeploy = deployments.some((d) => d.projectVersionId === r.projectVersionId);
    if (!hasDeploy) alerts.push({ ruleNumber: 5, severity: 'medium', title: 'Repository with no deployment', description: `Repo ${r.id} has nothing deployed.` });
  });

  // Rule 6 — deployment exists with no repo.
  deployments.forEach((d) => {
    const hasRepo = repositories.some((r) => r.projectVersionId === d.projectVersionId);
    if (!hasRepo) alerts.push({ ruleNumber: 6, severity: 'low', title: 'Deployment with no repository', description: `Deployment ${d.id} has no linked repo.` });
  });

  // Rule 7 — project has no next task.
  active.forEach((p) => {
    const open = tasks.some((t) => t.projectId === p.id && t.status !== 'COMPLETED' && t.status !== 'CANCELED');
    if (!open && p.overallStatus !== 'CONCEPT') alerts.push({ ruleNumber: 7, severity: 'low', title: 'No next task', description: `${p.name} has no open tasks.`, projectId: p.id });
  });

  // Rule 8 — task is overdue.
  tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELED' && isOverdue(t.dueDate)).forEach((t) => {
    alerts.push({ ruleNumber: 8, severity: 'high', title: 'Overdue task', description: `"${t.title}" is overdue.`, projectId: t.projectId });
  });

  // Rule 9 — progress hasn't changed in 14 days.
  versions.filter((v) => !v.isArchived && (daysSince(v.lastActivityAt) ?? 0) >= 14).forEach((v) => {
    alerts.push({ ruleNumber: 9, severity: 'low', title: 'Progress stalled', description: `${v.id} progress (${v.progress ?? 0}%) unchanged in 14+ days.`, projectId: v.projectId, versionId: v.id });
  });

  // Rule 10 — multiple versions, no winner.
  active.forEach((p) => {
    const vs = versions.filter((v) => v.projectId === p.id && !v.isArchived);
    if (vs.length > 1 && !p.winningVersionId && !vs.some((v) => v.isWinner)) {
      alerts.push({ ruleNumber: 10, severity: 'medium', title: 'Multiple versions, no winner', description: `${p.name} has ${vs.length} builds with no winner selected.`, projectId: p.id });
    }
  });

  // Rule 11 — production URL health check failing.
  deployments.filter((d) => d.environment === 'production' && (d.healthStatus === 'FAILED' || d.healthStatus === 'DEGRADED')).forEach((d) => {
    alerts.push({ ruleNumber: 11, severity: 'high', title: 'Production health check failing', description: `${d.deploymentUrl ?? d.id} responded ${d.responseCode ?? 'unknown'}.` });
  });

  // Rule 12 — OAuth token expires (auth error on repo).
  repositories.filter((r) => r.connectionStatus === 'AUTH_ERROR').forEach((r) => {
    alerts.push({ ruleNumber: 12, severity: 'high', title: 'Repository auth error', description: `Repo ${r.id} needs re-authorization.` });
  });

  // Rule 13 — project lacks status review in 7 days.
  active.filter((p) => (daysSince(p.updatedAt as string | undefined) ?? 0) >= 7 && p.overallStatus !== 'CONCEPT').forEach((p) => {
    alerts.push({ ruleNumber: 13, severity: 'low', title: 'Needs status review', description: `${p.name} hasn't had a status update in 7+ days.`, projectId: p.id });
  });

  // Rule 14 — version complete without evaluation.
  versions.filter((v) => (v.status === 'TESTING' || v.status === 'WINNER_SELECTED') && !evaluations.some((e) => e.projectVersionId === v.id)).forEach((v) => {
    alerts.push({ ruleNumber: 14, severity: 'medium', title: 'Completed without evaluation', description: `${v.id} has no Model Evaluation.`, projectId: v.projectId, versionId: v.id });
  });

  return alerts.sort((a, b) => a.ruleNumber - b.ruleNumber);
};

// ============================================================================
// HELPERS
// ============================================================================

const listAll = async <T>(name: string): Promise<T[]> => {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
};

const findProfile = async (userId: string): Promise<UserProfile | null> => {
  const snap = await db.collection('profiles').doc(userId).get();
  return snap.exists ? ({ id: userId, ...snap.data() } as UserProfile) : null;
};

const findAlertsForUser = async (userId: string) => {
  const [projects, versions, repositories, deployments, tasks, evaluations] = await Promise.all([
    listAll<RuleContext['projects'][number]>('projects'),
    listAll<RuleContext['versions'][number]>('versions'),
    listAll<RuleContext['repositories'][number]>('repositories'),
    listAll<RuleContext['deployments'][number]>('deployments'),
    listAll<RuleContext['tasks'][number]>('tasks'),
    listAll<RuleContext['evaluations'][number]>('evaluations'),
  ]);
  const profile = await findProfile(userId);
  const staleDays = profile?.defaultStaleDays ?? 7;
  const scoped = <T extends { userId?: string }>(rows: T[]): T[] => rows.filter((r) => !r.userId || r.userId === userId);
  return runRules({
    projects: scoped(projects),
    versions: scoped(versions),
    repositories: scoped(repositories),
    deployments: scoped(deployments),
    tasks: scoped(tasks),
    evaluations: scoped(evaluations),
    staleDays,
  });
};

const storeReport = async (userId: string, kind: 'daily' | 'weekly', title: string, body: string, attentionCount: number) => {
  const ref = db.collection('reports').doc();
  await ref.set({
    userId,
    kind,
    title,
    body,
    attentionCount,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

// ============================================================================
// SCHEDULED FUNCTIONS
// ============================================================================

/**
 * Runs the full 14-rule automation engine every 6 hours and persists any
 * triggered alerts to the user's activity log.
 */
export const runAutomation = onSchedule(
  { schedule: 'every 6 hours', timeZone: 'UTC', memory: '256MiB' },
  async () => {
    const profiles = await listAll<UserProfile>('profiles');
    logger.info(`Running automation for ${profiles.length} profile(s).`);
    for (const profile of profiles) {
      const alerts = await findAlertsForUser(profile.id);
      const batch = db.batch();
      alerts.slice(0, 25).forEach((alert) => {
        const ref = db.collection('activity').doc();
        batch.set(ref, {
          userId: profile.id,
          projectId: alert.projectId ?? null,
          projectVersionId: alert.versionId ?? null,
          kind: 'alert_triggered',
          message: `Rule ${alert.ruleNumber}: ${alert.title} — ${alert.description}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      logger.info(`Profile ${profile.id}: ${alerts.length} alert(s) logged.`);
    }
  },
);

/**
 * Daily report — every day, honoring each user's dailyReportTime (UTC for
 * simplicity in the demo; production resolves per-profile timezone).
 */
export const generateDailyReports = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'UTC', memory: '256MiB' },
  async () => {
    const profiles = await listAll<UserProfile>('profiles');
    for (const profile of profiles.filter((p) => p.dailyReportEnabled !== false)) {
      const alerts = await findAlertsForUser(profile.id);
      const body = [
        `# Daily Command Center Report — ${new Date().toLocaleDateString()}`,
        '',
        `**Attention items:** ${alerts.length}`,
        '',
        ...alerts.map((a) => `- [R${a.ruleNumber}] ${a.title} — ${a.description}`),
        '',
        'Generated by Cloud Scheduler.',
      ].join('\n');
      await storeReport(profile.id, 'daily', `Daily Report ${new Date().toLocaleDateString()}`, body, alerts.length);
      logger.info(`Daily report stored for ${profile.id}.`);
    }
  },
);

/**
 * Weekly report — every Monday 09:00 UTC.
 */
export const generateWeeklyReports = onSchedule(
  { schedule: 'every monday 09:00', timeZone: 'UTC', memory: '256MiB' },
  async () => {
    const profiles = await listAll<UserProfile>('profiles');
    for (const profile of profiles.filter((p) => p.weeklyReportEnabled !== false)) {
      const alerts = await findAlertsForUser(profile.id);
      const body = [
        `# Weekly Command Center Report — week of ${new Date().toLocaleDateString()}`,
        '',
        `**Attention items:** ${alerts.length}`,
        '',
        ...alerts.map((a) => `- [R${a.ruleNumber}] ${a.title} — ${a.description}`),
        '',
        'Generated by Cloud Scheduler.',
      ].join('\n');
      await storeReport(profile.id, 'weekly', `Weekly Report ${new Date().toLocaleDateString()}`, body, alerts.length);
      logger.info(`Weekly report stored for ${profile.id}.`);
    }
  },
);

// ============================================================================
// ON-DEMAND ENDPOINTS
// ============================================================================

/** Health check for the Command Center backend. */
export const healthCheck = onRequest({ cors: true }, async (req, res) => {
  res.json({ ok: true, service: 'app-portfolio-command-center', time: nowIso() });
});

/** POST /api/automation/run — trigger the rule engine on demand for a user. */
export const runAutomationNow = onRequest({ cors: true }, async (req, res) => {
  try {
    const userId = String(req.body?.userId ?? '');
    if (!userId) {
      res.status(400).json({ ok: false, error: 'userId required' });
      return;
    }
    const alerts = await findAlertsForUser(userId);
    res.json({ ok: true, alerts });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ ok: false, error: 'Automation run failed.' });
  }
});

/** POST /api/scanner — ingest git metadata from the local CLI companion. */
export const ingestScannerReport = onRequest({ cors: true }, async (req, res) => {
  try {
    const body = req.body ?? {};
    const userId = String(body.userId ?? '');
    if (!userId) {
      res.status(400).json({ ok: false, error: 'userId required' });
      return;
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const repoRef = db.collection('repositories').doc();
    await repoRef.set({
      userId,
      projectVersionId: body.projectVersionId ?? null,
      provider: body.provider ?? 'github',
      owner: body.owner ?? 'local',
      repositoryName: body.repositoryName ?? 'local-repo',
      repositoryUrl: body.repositoryUrl ?? '',
      defaultBranch: body.defaultBranch ?? 'main',
      currentBranch: body.branch ?? 'main',
      private: Boolean(body.private),
      lastCommitSha: body.lastCommitSha ?? null,
      lastCommitMessage: body.lastCommitMessage ?? null,
      lastCommitAt: body.lastCommitAt ?? null,
      openPullRequests: Number(body.openPullRequests ?? 0),
      openIssues: Number(body.openIssues ?? 0),
      commitsAhead: Number(body.commitsAhead ?? 0),
      commitsBehind: Number(body.commitsBehind ?? 0),
      hasUncommittedChanges: Boolean(body.hasUncommittedChanges),
      hasUnpushedCommits: Boolean(body.hasUnpushedCommits),
      lastScannedAt: now,
      connectionStatus: 'CONNECTED',
      createdAt: now,
      updatedAt: now,
    });
    const activityRef = db.collection('activity').doc();
    await activityRef.set({
      userId,
      projectVersionId: body.projectVersionId ?? null,
      kind: 'scan_ingested',
      message: `Scanner ingested ${body.owner ?? 'local'}/${body.repositoryName ?? 'repo'}`,
      createdAt: now,
    });
    res.status(202).json({ ok: true, repositoryId: repoRef.id });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ ok: false, error: 'Scanner ingest failed.' });
  }
});
