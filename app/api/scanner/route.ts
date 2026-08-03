import { NextResponse, type NextRequest } from 'next/server';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createDataService } from '@/lib/firestore';
import { RepositorySchema } from '@/types';

const DEMO_SCANS_FILE = path.join(process.cwd(), 'data', 'scans.json');

/**
 * POST /api/scanner
 *
 * Ingests git metadata (NOT source code) reported by the local CLI companion
 * (scripts/repo-scanner.mjs). Payload shape:
 *
 * {
 *   "owner": "chef-labs",
 *   "repositoryName": "weeknight-planner",
 *   "repositoryUrl": "https://github.com/...",
 *   "provider": "github",
 *   "branch": "main",
 *   "defaultBranch": "main",
 *   "private": false,
 *   "lastCommitSha": "abc123",
 *   "lastCommitMessage": "…",
 *   "lastCommitAt": "2026-08-01T…",
 *   "commitsAhead": 3,
 *   "commitsBehind": 0,
 *   "hasUncommittedChanges": true,
 *   "hasUnpushedCommits": true,
 *   "projectVersionId": "v-…"      // optional
 * }
 *
 * Responds 202 Accepted once persisted. Payloads are validated with the
 * RepositorySchema (types/index.ts) before they touch the data layer.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const now = new Date().toISOString();

    const service = await createDataService();
    const userId = service.mode === 'demo' ? 'demo-user' : await (await import('@/lib/firebase')).getUserId();
    const all = await service.loadAll(userId);

    const provider = ['github', 'bitbucket', 'gitlab', 'other'].includes(payload.provider) ? payload.provider : 'github';

    // Match an existing repository by URL or name, else create one.
    const existing = all.repositories.find(
      (r) => (payload.repositoryUrl && r.repositoryUrl === payload.repositoryUrl) ||
        r.repositoryName.toLowerCase() === String(payload.repositoryName ?? '').toLowerCase(),
    );

    // Build the candidate record, then validate it against the zod schema.
    const candidate = {
      id: existing?.id ?? `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      userId,
      projectVersionId: payload.projectVersionId ?? existing?.projectVersionId,
      provider,
      owner: String(payload.owner ?? 'local'),
      repositoryName: String(payload.repositoryName ?? 'local-repo'),
      repositoryUrl: String(payload.repositoryUrl ?? `https://github.com/${payload.owner ?? 'local'}/${payload.repositoryName ?? 'local-repo'}`),
      defaultBranch: String(payload.defaultBranch ?? 'main'),
      currentBranch: String(payload.branch ?? payload.defaultBranch ?? 'main'),
      private: Boolean(payload.private),
      lastCommitSha: payload.lastCommitSha ?? undefined,
      lastCommitMessage: payload.lastCommitMessage ?? undefined,
      lastCommitAt: payload.lastCommitAt ?? undefined,
      openPullRequests: Number(payload.openPullRequests ?? 0),
      openIssues: Number(payload.openIssues ?? 0),
      workflowStatus: ['success', 'failure', 'pending'].includes(payload.workflowStatus) ? payload.workflowStatus : undefined,
      commitsAhead: Number(payload.commitsAhead ?? 0),
      commitsBehind: Number(payload.commitsBehind ?? 0),
      hasUncommittedChanges: Boolean(payload.hasUncommittedChanges),
      hasUnpushedCommits: Boolean(payload.hasUnpushedCommits),
      lastScannedAt: now,
      connectionStatus: 'CONNECTED' as const,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const parsed = RepositorySchema.safeParse(candidate);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Payload failed validation', issues: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const repository = parsed.data;

    if (service.mode === 'demo') {
      // The client DemoService persists to browser localStorage (a no-op on
      // the server), so demo scans are stored server-side so nothing is lost.
      // Serverless platforms (e.g. Vercel) mount a read-only filesystem, so the
      // file write is best-effort: if it fails, the scan is still accepted and
      // validated, just not persisted (real persistence arrives with Firestore).
      try {
        await mkdir(path.dirname(DEMO_SCANS_FILE), { recursive: true });
        let scans: unknown[] = [];
        try {
          scans = JSON.parse(await readFile(DEMO_SCANS_FILE, 'utf8'));
        } catch {
          // first scan
        }
        scans = [...scans.filter((s) => (s as { id?: string }).id !== repository.id), repository];
        await writeFile(DEMO_SCANS_FILE, JSON.stringify(scans, null, 2));
        return NextResponse.json({ ok: true, repositoryId: repository.id, stored: 'server-file' }, { status: 202 });
      } catch (persistErr) {
        console.warn('demo scan persistence skipped (read-only server fs):', persistErr);
        return NextResponse.json(
          { ok: true, repositoryId: repository.id, stored: 'ephemeral', note: 'Demo mode: scan accepted but not persisted (read-only server filesystem).' },
          { status: 202 },
        );
      }
    }

    await service.saveRepository(repository);
    await service.saveActivity({
      id: `a-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      userId,
      projectVersionId: repository.projectVersionId,
      kind: 'scan_ingested',
      message: `Scanner ingested ${repository.owner}/${repository.repositoryName} (${repository.commitsAhead} ahead, ${repository.commitsBehind} behind)`,
      createdAt: now,
    });

    return NextResponse.json({ ok: true, repositoryId: repository.id, stored: 'firestore' }, { status: 202 });
  } catch (err) {
    console.error('scanner ingest failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to ingest scan.' },
      { status: 500 },
    );
  }
}
