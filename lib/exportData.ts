import type {
  ActivityEntry, Deployment, ModelEvaluation, Project, ProjectVersion,
  Report, Repository, Task, UserProfile,
} from '@/types';

// ============================================================================
// Shared data-export payload.
//
// The one-click "Export my data" feature downloads every owner-scoped entity
// as a single JSON file. The server route (/api/export) and the client helper
// (lib/liveData.ts downloadExportData) both build the SAME payload through
// this module, so a demo-mode export and a live Firestore export can never
// disagree on structure. The payload is deliberately flat and versioned: a
// future restore/import feature can read `version` and map each collection
// back to Firestore with the ids intact (the doc id IS the entity id).
// ============================================================================

export const EXPORT_APP = 'freebuff';
export const EXPORT_VERSION = 1;

/** The downloaded filename, e.g. freebuff-export-2026-08-10.json. */
export const exportFileName = (at: Date): string =>
  `freebuff-export-${at.toISOString().slice(0, 10)}.json`;

/** The full owner-scoped export payload (every collection the app stores). */
export interface ExportPayload {
  app: typeof EXPORT_APP;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  userId: string;
  profile: UserProfile | null;
  projects: Project[];
  versions: ProjectVersion[];
  repositories: Repository[];
  deployments: Deployment[];
  tasks: Task[];
  evaluations: ModelEvaluation[];
  activity: ActivityEntry[];
  reports: Report[];
}

/** The per-collection data the export assembles (source-agnostic). */
export interface ExportData {
  profile: UserProfile | null;
  projects: Project[];
  versions: ProjectVersion[];
  repositories: Repository[];
  deployments: Deployment[];
  tasks: Task[];
  evaluations: ModelEvaluation[];
  activity: ActivityEntry[];
  reports: Report[];
}

export const buildExportPayload = (
  userId: string,
  data: ExportData,
  now: Date = new Date(),
): ExportPayload => ({
  app: EXPORT_APP,
  version: EXPORT_VERSION,
  exportedAt: now.toISOString(),
  userId,
  ...data,
});
