import { NextResponse, type NextRequest } from 'next/server';

import {
  FIRESTORE_COLLECTIONS, firestoreList,
} from '@/lib/server/firestoreAdmin';
import { getRequestUserId } from '@/lib/server/user';
import { buildExportPayload, exportFileName } from '@/lib/exportData';
import type {
  ActivityEntry, Deployment, ModelEvaluation, Project, ProjectVersion,
  Report, Repository, Task, UserProfile,
} from '@/types';

export const dynamic = 'force-dynamic';

// ============================================================================
// GET /api/export — one-click data backup.
//
// Reads EVERY owner-scoped collection (profiles, projects, versions,
// repositories, deployments, tasks, evaluations, activity, reports) through
// the shared firestoreList helper and returns the whole bundle as a
// downloadable JSON attachment. This is an explicit user action, not a page
// load, so the bounded-read guard does NOT apply: an export must be complete —
// the entire point is that the file is a full backup. On Blaze the one-shot
// read cost is negligible; on Spark a single export is still far under the
// daily cap.
//
// Auth: owner-scoped like every live-data route — verified Firebase ID token
// (or the demo x-app-user header when no token issuer exists). The route is
// idempotent and read-only: it never writes, so a stale export cannot corrupt
// anything.
// ============================================================================

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  const {
    profiles, projects, versions, repositories, deployments,
    tasks, evaluations, activity, reports,
  } = FIRESTORE_COLLECTIONS;

  const [
    profileRows, projectRows, versionRows, repositoryRows, deploymentRows,
    taskRows, evaluationRows, activityRows, reportRows,
  ] = await Promise.all([
    firestoreList<UserProfile>(profiles, userId),
    firestoreList<Project>(projects, userId),
    firestoreList<ProjectVersion>(versions, userId),
    firestoreList<Repository>(repositories, userId),
    firestoreList<Deployment>(deployments, userId),
    firestoreList<Task>(tasks, userId),
    firestoreList<ModelEvaluation>(evaluations, userId),
    firestoreList<ActivityEntry>(activity, userId),
    firestoreList<Report>(reports, userId),
  ]);

  const payload = buildExportPayload(userId, {
    profile: profileRows[0] ?? null,
    projects: projectRows,
    versions: versionRows,
    repositories: repositoryRows,
    deployments: deploymentRows,
    tasks: taskRows,
    evaluations: evaluationRows,
    activity: activityRows,
    reports: reportRows,
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(new Date())}"`,
      'Cache-Control': 'no-store',
    },
  });
}
