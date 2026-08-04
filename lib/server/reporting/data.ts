import { fetchGitHubRepos } from '@/lib/server/github';
import { fetchLiveDeployments } from '@/lib/server/deployments';
import { fromEvaluationRow, fromProjectRow, fromTaskRow, fromVersionRow, type Row } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseSelect } from '@/lib/server/supabase';
import { mergeScannerOverlay } from '@/lib/scannerOverlay';
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

  // Overlay local scanner facts (uncommitted/unpushed, branch, ahead/behind)
  // onto the live GitHub feed using the SAME merge the client store applies,
  // so the emailed report shows the same 'push these repos' items as the
  // dashboard. Scanner metadata is written server-side by /api/scanner in demo
  // mode (data/scans.json); when the file is absent or unreadable (e.g. a
  // read-only serverless filesystem) this degrades to the live feed untouched.
  const scanned = await safe(async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const raw = await readFile(join(process.cwd(), 'data', 'scans.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is import('@/types').Repository =>
      typeof s === 'object' && s !== null && typeof (s as { id?: unknown }).id === 'string');
  });
  const merged = mergeScannerOverlay(repositories ?? [], scanned ?? []);

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
      repositories: merged,
      deployments: deployments ?? [],
    },
  };
};
