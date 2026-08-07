import { fetchGitHubRepos } from '@/lib/server/github';
import { fetchLiveDeployments } from '@/lib/server/deployments';
import {
  FIRESTORE_COLLECTIONS, firestoreList, isFirestoreAdminConfigured,
} from '@/lib/server/firestoreAdmin';
import { mergeScannerOverlay } from '@/lib/scannerOverlay';
import type { AppState } from '@/lib/engine';
import type { UserProfile, Task, Project, ProjectVersion, ModelEvaluation } from '@/types';

// ============================================================================
// Live snapshot assembly for the automation engine.
//
// The cron evaluates the exact same rules as the UI (lib/engine.ts is pure and
// server-safe) against one assembled AppState: Firestore-backed tasks/projects/
// versions/evaluations (written by the client's FirestoreService), the live
// GitHub repo feed, and live Vercel/Firebase deployments with health checks.
// Every source degrades to [] when unconfigured or unreachable so the engine
// never throws.
// ============================================================================

export interface LiveSnapshot {
  userId: string;
  configured: { firestore: boolean; github: boolean; deployments: boolean };
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
  const firestore = isFirestoreAdminConfigured();

  const [tasks, projects, versions, evaluations] = await Promise.all([
    firestore
      ? safe(() => firestoreList<Task>(FIRESTORE_COLLECTIONS.tasks, ownerId))
      : Promise.resolve(null),
    firestore
      ? safe(() => firestoreList<Project>(FIRESTORE_COLLECTIONS.projects, ownerId))
      : Promise.resolve(null),
    firestore
      ? safe(() => firestoreList<ProjectVersion>(FIRESTORE_COLLECTIONS.versions, ownerId))
      : Promise.resolve(null),
    firestore
      ? safe(() => firestoreList<ModelEvaluation>(FIRESTORE_COLLECTIONS.evaluations, ownerId))
      : Promise.resolve(null),
  ]);

  const [repositories, deployments] = await Promise.all([
    safe(() => fetchGitHubRepos(ownerId)),
    safe(() => fetchLiveDeployments(ownerId)),
  ]);

  // Overlay local scanner facts (uncommitted/unpushed, branch, ahead/behind)
  // onto the live GitHub feed using the SAME merge the client store applies,
  // so the emailed report shows the same 'push these repos' items as the
  // dashboard. Scanner metadata is source-aware (lib/server/scans.ts): with
  // FIREBASE_SERVICE_ACCOUNT configured it comes from the Firestore
  // `repositories` rows written by POST /api/scanner; without one it falls
  // back to the demo-mode data/scans.json file. Either source degrades to []
  // when absent or unreadable (e.g. a read-only serverless filesystem), which
  // leaves the live feed untouched.
  const scanned = await safe(async () => {
    const { readScannedRepositories } = await import('@/lib/server/scans');
    const rows = await readScannedRepositories(ownerId);
    return rows.filter((s): s is import('@/types').Repository =>
      typeof s === 'object' && s !== null && typeof (s as { id?: unknown }).id === 'string');
  });
  const merged = mergeScannerOverlay(repositories ?? [], scanned ?? []);

  return {
    userId: ownerId,
    configured: {
      firestore,
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
