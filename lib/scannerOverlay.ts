import type { Repository } from '@/types';

/**
 * Overlay local scanner facts (uncommitted/unpushed, branch, ahead/behind)
 * onto the live GitHub feed.
 *
 * Shared by the client store (lib/store.tsx) and the server cron snapshot
 * loader (lib/server/reporting/data.ts) so the dashboard and the emailed
 * reports always agree on which repos need a push.
 */
export const mergeScannerOverlay = (live: Repository[], local: Repository[]): Repository[] => {
  if (local.length === 0) return live;
  const localByKey = new Map(
    local.map((r) => [`${r.owner}/${r.repositoryName}`.toLowerCase(), r]),
  );
  return live.map((repo) => {
    const key = `${repo.owner}/${repo.repositoryName}`.toLowerCase();
    const localMatch = localByKey.get(key);
    if (!localMatch) return repo;
    return {
      ...repo,
      projectVersionId: localMatch.projectVersionId ?? repo.projectVersionId,
      hasUncommittedChanges: localMatch.hasUncommittedChanges,
      hasUnpushedCommits: localMatch.hasUnpushedCommits,
      commitsAhead: localMatch.hasUnpushedCommits ? localMatch.commitsAhead : repo.commitsAhead,
      commitsBehind: localMatch.commitsBehind,
      lastScannedAt: localMatch.lastScannedAt,
    };
  });
};
