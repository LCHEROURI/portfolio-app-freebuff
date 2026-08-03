import { fetchGitHubRepos } from '@/lib/server/github';
import { fetchLiveDeployments } from '@/lib/server/deployments';
import { fromEvaluationRow, fromProjectRow, fromTaskRow, fromVersionRow, type Row } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseSelect } from '@/lib/server/supabase';
import type { AppState } from '@/lib/engine';
import type { UserProfile } from '@/types';

// ============================================================================
// Live snapshot assembly for the automation engine.
//
// The cron evaluates the exact same rules as the UI (lib/engine.ts is pure and
// server-safe) against one assembled AppState: Supabase-backed tasks/projects/
// versions/evaluations, the live GitHub repo feed, and live Vercel/Firebase
// deployments with health checks. Every source degrades to [] when unconfigured
// or unreachable so the engine never throws.
// ============================================================================

export interface LiveSnapshot {
  userId: string;
  configured: { supabase: boolean; github: boolean; deployments: boolean };
  collections: Pick<
    AppState,
    'projects' | 'versions' | 'repositories' | 'deployments' | 'tasks' | 'evaluations'
  >;
}

const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

/** Minimal profile the engine's rule/report builders need (defaults from env). */
export const serverProfile = (ownerId: string): UserProfile => ({
  id: ownerId,
  name: process.env.REPORT_NAME ?? 'Command Center',
  email: process.env.REPORT_EMAIL ?? 'owner@local',
  timezone: process.env.REPORT_TIMEZONE ?? 'UTC',
  dailyReportEnabled: true,
  dailyReportTime: process.env.REPORT_TIME ?? '07:00',
  weeklyReportEnabled: true,
  weeklyReportDay: Number(process.env.REPORT_WEEKLY_DAY ?? 1), // 1 = Monday
  weeklyReportTime: process.env.REPORT_TIME ?? '07:00',
  defaultStaleDays: Number(process.env.REPORT_STALE_DAYS ?? 7),
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

export const loadLiveSnapshot = async (ownerId: string): Promise<LiveSnapshot> => {
  const supabase = isSupabaseConfigured();

  const [tasks, projects, versions, evaluations] = await Promise.all([
    supabase
      ? safe(() => supabaseSelect<Row>('tasks', ownerId, { order: 'position' }).then((r) => r.map(fromTaskRow)))
      : Promise.resolve(null),
    supabase
      ? safe(() => supabaseSelect<Row>('projects', ownerId, { order: 'updated_at.desc' }).then((r) => r.map(fromProjectRow)))
      : Promise.resolve(null),
    supabase
      ? safe(() => supabaseSelect<Row>('versions', ownerId, { order: 'created_at' }).then((r) => r.map(fromVersionRow)))
      : Promise.resolve(null),
    supabase
      ? safe(() => supabaseSelect<Row>('evaluations', ownerId, { order: 'updated_at.desc' }).then((r) => r.map(fromEvaluationRow)))
      : Promise.resolve(null),
  ]);

  const [repositories, deployments] = await Promise.all([
    safe(() => fetchGitHubRepos(ownerId)),
    safe(() => fetchLiveDeployments(ownerId)),
  ]);

  return {
    userId: ownerId,
    configured: {
      supabase,
      github: Boolean(process.env.GITHUB_TOKEN) || (repositories?.length ?? 0) > 0,
      deployments: Boolean(process.env.VERCEL_TOKEN) || Boolean(process.env.FIREBASE_TOKEN),
    },
    collections: {
      tasks: tasks ?? [],
      projects: projects ?? [],
      versions: versions ?? [],
      evaluations: evaluations ?? [],
      repositories: repositories ?? [],
      deployments: deployments ?? [],
    },
  };
};
