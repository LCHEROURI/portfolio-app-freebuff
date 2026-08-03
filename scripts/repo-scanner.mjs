#!/usr/bin/env node
/**
 * Local Repository Scanner Companion
 * ----------------------------------
 * Runs against a local git repo and reports METADATA ONLY (never source code)
 * to the App Portfolio Command Center API.
 *
 * Reads:
 *   - git status --porcelain            → hasUncommittedChanges
 *   - git remote -v                     → owner / repositoryName / repositoryUrl / provider
 *   - git branch --show-current         → currentBranch
 *   - git log -1 --format=…             → last commit sha / message / date
 *   - git rev-list --left-right --count HEAD...@{upstream} → commitsAhead / commitsBehind
 *   - git config --get remote.origin.url
 *
 * Usage:
 *   node scripts/repo-scanner.mjs \
 *     --path ~/dev/weeknight-planner/gemini \
 *     --api http://localhost:3000/api/scanner \
 *     --project-version "v-xxxx" \
 *     --token <optional bearer token>
 *
 * The --api flag defaults to the local dev server; point it at the deployed
 * Command Center endpoint in production.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const repoPath = path.resolve(getArg('path', process.cwd()));
const apiUrl = getArg('api', 'http://localhost:3000/api/scanner');
const projectVersionId = getArg('project-version', undefined);
const token = getArg('token', undefined);

const run = (cmd, fallback = '') => {
  try {
    return execFileSync('git', cmd, { cwd: repoPath, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

const log = (msg) => console.log(`[scanner] ${msg}`);
const warn = (msg) => console.warn(`[scanner] ⚠ ${msg}`);

async function main() {
  log(`Scanning ${repoPath}…`);

  const remote = run(['remote', 'get-url', 'origin']);
  if (!remote) {
    warn('No git remote named "origin" — repository will be reported with owner "local".');
  }

  const status = run(['status', '--porcelain']);
  const branch = run(['branch', '--show-current']) || run(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const lastCommit = run(['log', '-1', '--format=%H|%s|%aI']);
  const [sha = '', message = '', date = ''] = lastCommit.split('|');

  // commitsAhead / commitsBehind via rev-list --left-right --count
  let ahead = 0;
  let behind = 0;
  try {
    const counts = execFileSync(
      'git',
      ['rev-list', '--left-right', '--count', `HEAD...@{upstream}`],
      { cwd: repoPath, encoding: 'utf8' },
    ).trim().split(/\s+/);
    behind = Number(counts[0] ?? 0);
    ahead = Number(counts[1] ?? 0);
  } catch {
    // No upstream configured → counts stay 0.
  }

  const openPullRequests = 0; // Requires GitHub API token; populated by cloud integration.
  const openIssues = 0;

  // Parse owner/repo out of the remote URL: git@github.com:owner/repo.git
  let owner = 'local';
  let repositoryName = path.basename(repoPath);
  let repositoryUrl = remote;
  let provider = 'github';
  if (remote) {
    const ssh = remote.match(/[^@]+@([^:]+):(.+)\.git$/);
    const https = remote.match(/https?:\/\/(?:www\.)?([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (ssh) {
      provider = ssh[1].includes('bitbucket') ? 'bitbucket' : ssh[1].includes('gitlab') ? 'gitlab' : 'github';
      owner = ssh[2].split('/')[0];
      repositoryName = ssh[2].split('/')[1] ?? repositoryName;
    } else if (https) {
      provider = https[1].includes('bitbucket') ? 'bitbucket' : https[1].includes('gitlab') ? 'gitlab' : 'github';
      owner = https[2];
      repositoryName = https[3] ?? repositoryName;
      repositoryUrl = `https://${https[1]}/${owner}/${repositoryName}`;
    }
  }

  const hasUncommittedChanges = status.length > 0;
  const hasUnpushedCommits = ahead > 0;

  const payload = {
    owner,
    repositoryName,
    repositoryUrl,
    provider,
    branch,
    defaultBranch: branch === 'main' ? 'main' : 'main',
    private: false,
    lastCommitSha: sha || undefined,
    lastCommitMessage: message || undefined,
    lastCommitAt: date || undefined,
    openPullRequests,
    openIssues,
    commitsAhead: ahead,
    commitsBehind: behind,
    hasUncommittedChanges,
    hasUnpushedCommits,
    projectVersionId,
  };

  log(`  branch: ${branch}`);
  log(`  remote: ${remote || '(none)'}`);
  log(`  ${hasUncommittedChanges ? 'uncommitted changes present' : 'working tree clean'}`);
  log(`  ${ahead} ahead / ${behind} behind upstream`);
  log(`  last commit: ${message || '(none)'} (${sha || '—'})`);
  log(`POSTing metadata to ${apiUrl} …`);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API responded ${res.status}: ${body}`);
  }

  const result = await res.json();
  log(`✓ Accepted — repository id ${result.repositoryId}`);
  log('Done. No source code was transmitted.');
}

main().catch((err) => {
  console.error(`[scanner] ✗ ${err.message}`);
  process.exit(1);
});
