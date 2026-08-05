import {
  type UserProfile, type Project, type ProjectVersion, type Repository,
  type Deployment, type Task, type ModelEvaluation, type ActivityEntry,
  slugify, computeOverallScore,
} from '@/types';

/**
 * Demo data populator. Every record is clearly a demo row (source: 'demo'),
 * seeded with relative timestamps so the automation engine has something to
 * chew on: overdue tasks, stale projects, unpushed commits, a failed prod
 * deployment, a missing repository, a winner to select, etc.
 */

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (d: number, h = 0) => iso(now - d * 86_400_000 - h * 3_600_000);
const hoursAgo = (h: number) => iso(now - h * 3_600_000);
const minutesAgo = (m: number) => iso(now - m * 60_000);

export const DEMO_USER_ID = 'demo-user';
export const DEMO_USER_EMAIL = 'demo@command-center.local';

const uid = DEMO_USER_ID;

let counter = 0;
const id = (prefix: string) => `${prefix}-demo-${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// 1. Classic Chef Video Guide (Codex) — Building 57%
// ---------------------------------------------------------------------------
const p1 = id('p');
const v1a = id('v');
const v1b = id('v');
const r1 = id('r');
const d1a = id('d');
const d1b = id('d');
const t1a = id('t');
const t1b = id('t');
const t1c = id('t');
const e1 = id('e');

const p1obj: Project = {
    id: p1, userId: uid, name: 'Classic Chef Video Guide', slug: slugify('Classic Chef Video Guide'),
    description: 'Step-by-step video cooking guide with a classic-chef tone, built to test Codex code-generation speed on a single-page app.',
    category: 'Cooking / Video', businessGoal: 'Validate video-first recipe format engagement',
    targetCustomer: 'Home cooks 25–45 who prefer video over text',
    monetizationModel: 'Subscription', priority: 'P1_HIGH', overallStatus: 'BUILDING',
    overallProgress: 57, currentVersionId: v1a, nextAction: 'Finish recipe detail video player',
    nextActionDueDate: daysAgo(-2), blocker: undefined, archived: false,
    createdAt: daysAgo(32), updatedAt: hoursAgo(6), lastActivityAt: hoursAgo(6),
  };

const version1a: ProjectVersion = {
  id: v1a, projectId: p1, userId: uid, versionName: 'Codex Build', builder: 'Codex',
  model: 'GPT-4o Codex', modelVersion: 'codex-1', developmentPlatform: 'Next.js + Vercel',
  status: 'BUILDING', progress: 57, localFolderPath: '~/dev/chef-video-guide/codex',
  repositoryId: r1, deploymentIds: [d1a], primaryDeploymentId: d1a, branch: 'main',
  lastCommitAt: hoursAgo(5), lastActivityAt: hoursAgo(6), estimatedCost: 120, actualCost: 85,
  developmentHours: 34, isWinner: false, isArchived: false,
  notes: 'Fast codegen; needs manual video-player polish.', createdAt: daysAgo(30), updatedAt: hoursAgo(6),
};

const version1b: ProjectVersion = {
  id: v1b, projectId: p1, userId: uid, versionName: 'Claude Build', builder: 'Claude',
  model: 'Claude 3.5 Sonnet', developmentPlatform: 'Next.js + Vercel',
  status: 'PAUSED', progress: 12, localFolderPath: '~/dev/chef-video-guide/claude',
  repositoryId: undefined, deploymentIds: [], branch: 'main',
  lastActivityAt: daysAgo(9), estimatedCost: 80, actualCost: 20, developmentHours: 8,
  isWinner: false, isArchived: false,
  notes: 'Paused in favor of the Codex build.', createdAt: daysAgo(24), updatedAt: daysAgo(9),
};

const repo1: Repository = {
  id: r1, userId: uid, projectVersionId: v1a, provider: 'github', owner: 'chef-labs',
  repositoryName: 'chef-video-guide-codex', repositoryUrl: 'https://github.com/chef-labs/chef-video-guide-codex',
  defaultBranch: 'main', currentBranch: 'main', private: true,
  lastCommitSha: '9f3d1c', lastCommitMessage: 'Add video player controls', lastCommitAt: hoursAgo(5),
  openPullRequests: 1, openIssues: 3, workflowStatus: 'success', commitsAhead: 4, commitsBehind: 0,
  hasUncommittedChanges: true, hasUnpushedCommits: true, lastScannedAt: minutesAgo(42),
  connectionStatus: 'CONNECTED', createdAt: daysAgo(30), updatedAt: hoursAgo(1),
};

const deploy1a: Deployment = {
  id: d1a, userId: uid, projectVersionId: v1a, provider: 'vercel', projectName: 'chef-video-guide-codex',
  environment: 'production', deploymentUrl: 'https://chef-video-guide-codex.vercel.app',
  dashboardUrl: 'https://vercel.com/chef-labs/chef-video-guide-codex', status: 'READY',
  healthStatus: 'HEALTHY', lastDeploymentAt: daysAgo(2), lastSuccessfulDeploymentAt: daysAgo(2),
  framework: 'Next.js', branch: 'main', responseCode: 200, responseTimeMs: 480,
  lastHealthCheckAt: minutesAgo(30), createdAt: daysAgo(29), updatedAt: minutesAgo(30),
};

const deploy1b: Deployment = {
  id: d1b, userId: uid, projectVersionId: v1a, provider: 'vercel', projectName: 'chef-video-guide-codex',
  environment: 'preview', deploymentUrl: 'https://chef-video-guide-codex-git-main.vercel.app',
  status: 'READY', healthStatus: 'UNKNOWN', lastDeploymentAt: hoursAgo(5),
  framework: 'Next.js', branch: 'main', createdAt: hoursAgo(5), updatedAt: hoursAgo(5),
};

const tasks1: Task[] = [
  {
    id: t1a, userId: uid, projectId: p1, projectVersionId: v1a, title: 'Finish recipe detail video player',
    description: 'Autoplay next recipe, chapter markers, transcript toggle.',
    status: 'IN_PROGRESS', priority: 'P1_HIGH', taskType: 'FEATURE', dueDate: daysAgo(-1),
    estimatedMinutes: 180, actualMinutes: 120, position: 0, createdAt: daysAgo(6), updatedAt: hoursAgo(3),
  },
  {
    id: t1b, userId: uid, projectId: p1, projectVersionId: v1a, title: 'Fix mobile scrubber jank',
    status: 'NEXT', priority: 'P2_MEDIUM', taskType: 'BUG', dueDate: daysAgo(1),
    estimatedMinutes: 60, position: 1, createdAt: daysAgo(4), updatedAt: daysAgo(1),
  },
  {
    id: t1c, userId: uid, projectId: p1, projectVersionId: v1a, title: 'Write 10 starter video recipes',
    status: 'BACKLOG', priority: 'P2_MEDIUM', taskType: 'FEATURE', dueDate: undefined,
    estimatedMinutes: 600, position: 2, createdAt: daysAgo(4), updatedAt: daysAgo(4),
  },
];

const eval1: ModelEvaluation = {
  id: e1, userId: uid, projectId: p1, projectVersionId: v1a, builder: 'Codex', model: 'GPT-4o Codex',
  uiScore: 7, featureScore: 6, codeQualityScore: 7, stabilityScore: 6, performanceScore: 8,
  maintainabilityScore: 6, mobileScore: 5, accessibilityScore: 4, developmentSpeedScore: 9,
  costScore: 6, overallScore: 0, evaluatorNotes: 'Very fast, needs UI polish pass.',
  evaluatedAt: daysAgo(3), createdAt: daysAgo(3), updatedAt: daysAgo(3),
};
eval1.overallScore = computeOverallScore(eval1);

// ---------------------------------------------------------------------------
// 2. Weeknight Meal Planner (Gemini & Kimi K3) — Testing (AI Studio)
// ---------------------------------------------------------------------------
const p2 = id('p');
const v2a = id('v');
const v2b = id('v');
const r2 = id('r');
const d2a = id('d');
const d2b = id('d');
const t2a = id('t');
const t2b = id('t');
const t2c = id('t');
const e2a = id('e');
const e2b = id('e');

const p2obj: Project = {
  id: p2, userId: uid, name: 'Weeknight Meal Planner', slug: slugify('Weeknight Meal Planner'),
  description: 'AI meal planner that turns pantry + dietary constraints into a week of dinners. Running parallel Gemini and Kimi K3 builds.',
  category: 'Cooking / Meal Planning', businessGoal: 'Prove AI meal-planning retention',
  targetCustomer: 'Busy families, dietary-restricted cooks',
  monetizationModel: 'Freemium', priority: 'P0_CRITICAL', overallStatus: 'TESTING',
  overallProgress: 74, currentVersionId: v2a, nextAction: 'Run A/B retention test on both builds',
  nextActionDueDate: daysAgo(0), blocker: undefined, archived: false,
  createdAt: daysAgo(45), updatedAt: hoursAgo(2), lastActivityAt: hoursAgo(2),
};

const version2a: ProjectVersion = {
  id: v2a, projectId: p2, userId: uid, versionName: 'Gemini Build', builder: 'Google AI Studio',
  model: 'Gemini 1.5 Pro', modelVersion: 'gemini-1.5-pro-001', developmentPlatform: 'AI Studio + Firebase',
  status: 'TESTING', progress: 78, localFolderPath: '~/dev/weeknight-planner/gemini',
  repositoryId: r2, deploymentIds: [d2a], primaryDeploymentId: d2a, branch: 'main',
  lastCommitAt: hoursAgo(2), lastActivityAt: hoursAgo(2), estimatedCost: 220, actualCost: 190,
  developmentHours: 62, isWinner: false, isArchived: false,
  notes: 'Best recipes quality so far.', createdAt: daysAgo(42), updatedAt: hoursAgo(2),
};

const version2b: ProjectVersion = {
  id: v2b, projectId: p2, userId: uid, versionName: 'Kimi K3 Build', builder: 'FreeBuff',
  model: 'Kimi K3', developmentPlatform: 'React + Firebase',
  status: 'TESTING', progress: 71, localFolderPath: '~/dev/weeknight-planner/kimi',
  repositoryId: undefined, deploymentIds: [d2b], primaryDeploymentId: d2b, branch: 'main',
  lastDeploymentAt: daysAgo(1), lastActivityAt: hoursAgo(5), estimatedCost: 180, actualCost: 210,
  developmentHours: 55, isWinner: false, isArchived: false,
  notes: 'Fast iteration, slightly weaker dietary nuance.', createdAt: daysAgo(40), updatedAt: hoursAgo(5),
};

const repo2: Repository = {
  id: r2, userId: uid, projectVersionId: v2a, provider: 'github', owner: 'chef-labs',
  repositoryName: 'weeknight-meal-planner-gemini', repositoryUrl: 'https://github.com/chef-labs/weeknight-meal-planner-gemini',
  defaultBranch: 'main', currentBranch: 'feat/voice-input', private: true,
  lastCommitSha: '4a1e09', lastCommitMessage: 'Wire voice pantry input', lastCommitAt: hoursAgo(2),
  openPullRequests: 2, openIssues: 5, workflowStatus: 'pending', commitsAhead: 7, commitsBehind: 1,
  hasUncommittedChanges: false, hasUnpushedCommits: true, lastScannedAt: minutesAgo(12),
  connectionStatus: 'CONNECTED', createdAt: daysAgo(42), updatedAt: minutesAgo(12),
};

const deploy2a: Deployment = {
  id: d2a, userId: uid, projectVersionId: v2a, provider: 'firebase', projectName: 'weeknight-planner-gemini',
  environment: 'production', deploymentUrl: 'https://weeknight-planner-gemini.web.app',
  dashboardUrl: 'https://console.firebase.google.com/project/weeknight-planner-gemini/hosting', status: 'READY',
  healthStatus: 'HEALTHY', lastDeploymentAt: daysAgo(1), lastSuccessfulDeploymentAt: daysAgo(1),
  framework: 'React', branch: 'main', responseCode: 200, responseTimeMs: 320,
  lastHealthCheckAt: minutesAgo(20), createdAt: daysAgo(41), updatedAt: minutesAgo(20),
};

const deploy2b: Deployment = {
  id: d2b, userId: uid, projectVersionId: v2b, provider: 'vercel', projectName: 'weeknight-planner-kimi',
  environment: 'staging', deploymentUrl: 'https://weeknight-planner-kimi.vercel.app',
  dashboardUrl: 'https://vercel.com/chef-labs/weeknight-planner-kimi', status: 'READY',
  healthStatus: 'DEGRADED', lastDeploymentAt: daysAgo(1), lastSuccessfulDeploymentAt: daysAgo(1),
  framework: 'Next.js', branch: 'main', responseCode: 503, responseTimeMs: 1200,
  lastFailureMessage: 'Intermittent 503 on /api/plan', lastHealthCheckAt: minutesAgo(8),
  createdAt: daysAgo(39), updatedAt: minutesAgo(8),
};

const tasks2: Task[] = [
  {
    id: t2a, userId: uid, projectId: p2, projectVersionId: v2a, title: 'A/B retention test: Gemini vs Kimi',
    status: 'NEXT', priority: 'P0_CRITICAL', taskType: 'EVALUATION', dueDate: daysAgo(-2),
    estimatedMinutes: 240, position: 0, createdAt: daysAgo(8), updatedAt: daysAgo(2),
  },
  {
    id: t2b, userId: uid, projectId: p2, projectVersionId: v2b, title: 'Fix intermittent 503 on plan endpoint',
    status: 'IN_PROGRESS', priority: 'P0_CRITICAL', taskType: 'BUG', dueDate: daysAgo(1),
    blockedBy: 'Waiting on Vercel function cold-start fix', estimatedMinutes: 120, actualMinutes: 90,
    position: 1, createdAt: daysAgo(3), updatedAt: hoursAgo(4),
  },
  {
    id: t2c, userId: uid, projectId: p2, projectVersionId: v2a, title: 'Collect user feedback from 20 testers',
    status: 'REVIEW', priority: 'P2_MEDIUM', taskType: 'EVALUATION', dueDate: daysAgo(0),
    estimatedMinutes: 90, actualMinutes: 75, position: 2, createdAt: daysAgo(5), updatedAt: daysAgo(1),
  },
];

const eval2a: ModelEvaluation = {
  id: e2a, userId: uid, projectId: p2, projectVersionId: v2a, builder: 'Google AI Studio', model: 'Gemini 1.5 Pro',
  uiScore: 8, featureScore: 8, codeQualityScore: 7, stabilityScore: 7, performanceScore: 7,
  maintainabilityScore: 7, mobileScore: 8, accessibilityScore: 7, developmentSpeedScore: 7,
  costScore: 5, overallScore: 0, evaluatorNotes: 'Strong recipes; AI Studio hosting is limiting.',
  evaluatedAt: daysAgo(4), createdAt: daysAgo(4), updatedAt: daysAgo(4),
};
eval2a.overallScore = computeOverallScore(eval2a);

const eval2b: ModelEvaluation = {
  id: e2b, userId: uid, projectId: p2, projectVersionId: v2b, builder: 'FreeBuff', model: 'Kimi K3',
  uiScore: 7, featureScore: 7, codeQualityScore: 6, stabilityScore: 6, performanceScore: 8,
  maintainabilityScore: 6, mobileScore: 7, accessibilityScore: 6, developmentSpeedScore: 9,
  costScore: 7, overallScore: 0, evaluatorNotes: 'Ships fast, iteration speed is a superpower.',
  evaluatedAt: daysAgo(4), createdAt: daysAgo(4), updatedAt: daysAgo(4),
};
eval2b.overallScore = computeOverallScore(eval2b);

// ---------------------------------------------------------------------------
// 3. Restaurant Social Media Manager (Lovable & DeepSeek) — Building / Blocked
// ---------------------------------------------------------------------------
const p3 = id('p');
const v3a = id('v');
const v3b = id('v');
const r3 = id('r');
const d3a = id('d');
const t3a = id('t');
const t3b = id('t');

const p3obj: Project = {
  id: p3, userId: uid, name: 'Restaurant Social Media Manager', slug: slugify('Restaurant Social Media Manager'),
  description: 'Auto-generates daily social posts for restaurants from menu + photos.',
  category: 'Restaurant Ops', businessGoal: 'Sell to local restaurants as a monthly service',
  targetCustomer: 'Independent restaurant owners',
  monetizationModel: 'SaaS monthly', priority: 'P1_HIGH', overallStatus: 'BUILDING',
  overallProgress: 41, currentVersionId: v3a, nextAction: 'Unblock Lovable OAuth callback',
  nextActionDueDate: daysAgo(-3), blocker: 'Facebook API app review pending (2 weeks)',
  archived: false, createdAt: daysAgo(38), updatedAt: daysAgo(1), lastActivityAt: daysAgo(1),
};

const version3a: ProjectVersion = {
  id: v3a, projectId: p3, userId: uid, versionName: 'Lovable Build', builder: 'Lovable',
  model: 'Lovable default', developmentPlatform: 'Lovable + Firebase',
  status: 'BUILDING', progress: 46, localFolderPath: '~/dev/resto-social/lovable',
  repositoryId: r3, deploymentIds: [d3a], primaryDeploymentId: d3a, branch: 'main',
  blocker: 'Facebook API app review pending', lastActivityAt: daysAgo(1),
  estimatedCost: 150, actualCost: 110, developmentHours: 40, isWinner: false, isArchived: false,
  notes: 'Blocked by external API review.', createdAt: daysAgo(36), updatedAt: daysAgo(1),
};

const version3b: ProjectVersion = {
  id: v3b, projectId: p3, userId: uid, versionName: 'DeepSeek Build', builder: 'DeepSeek',
  model: 'DeepSeek-R1', developmentPlatform: 'React + Vercel',
  status: 'CONCEPT', progress: 5, localFolderPath: '~/dev/resto-social/deepseek',
  deploymentIds: [], branch: 'main', lastActivityAt: daysAgo(6), estimatedCost: 90, actualCost: 0,
  developmentHours: 2, isWinner: false, isArchived: false,
  notes: 'Kick off once Lovable is unblocked.', createdAt: daysAgo(7), updatedAt: daysAgo(6),
};

const repo3: Repository = {
  id: r3, userId: uid, projectVersionId: v3a, provider: 'github', owner: 'chef-labs',
  repositoryName: 'resto-social-lovable', repositoryUrl: 'https://github.com/chef-labs/resto-social-lovable',
  defaultBranch: 'main', currentBranch: 'main', private: true,
  lastCommitAt: daysAgo(1), openPullRequests: 0, openIssues: 4, workflowStatus: 'failure',
  commitsAhead: 0, commitsBehind: 2, hasUncommittedChanges: false, hasUnpushedCommits: false,
  lastScannedAt: daysAgo(1), connectionStatus: 'CONNECTED', createdAt: daysAgo(36), updatedAt: daysAgo(1),
};

const deploy3a: Deployment = {
  id: d3a, userId: uid, projectVersionId: v3a, provider: 'lovable', projectName: 'resto-social-lovable',
  environment: 'production', deploymentUrl: 'https://resto-social-lovable.lovable.app',
  status: 'READY', healthStatus: 'HEALTHY', lastDeploymentAt: daysAgo(2),
  lastSuccessfulDeploymentAt: daysAgo(2), createdAt: daysAgo(35), updatedAt: daysAgo(2),
};

const tasks3: Task[] = [
  {
    id: t3a, userId: uid, projectId: p3, projectVersionId: v3a, title: 'Complete Facebook app review form',
    status: 'BLOCKED', priority: 'P1_HIGH', taskType: 'DEPLOYMENT', dueDate: daysAgo(-5),
    blockedBy: 'External review queue', estimatedMinutes: 60, position: 0,
    createdAt: daysAgo(10), updatedAt: daysAgo(5),
  },
  {
    id: t3b, userId: uid, projectId: p3, projectVersionId: v3a, title: 'Add Instagram publishing fallback',
    status: 'NEXT', priority: 'P2_MEDIUM', taskType: 'FEATURE', dueDate: daysAgo(2),
    estimatedMinutes: 120, position: 1, createdAt: daysAgo(4), updatedAt: daysAgo(2),
  },
];

// ---------------------------------------------------------------------------
// 4. Restaurant 86-to-0 Board (Replit) — Repository not connected
// ---------------------------------------------------------------------------
const p4 = id('p');
const v4a = id('v');
const t4a = id('t');

const p4obj: Project = {
  id: p4, userId: uid, name: 'Restaurant 86-to-0 Board', slug: slugify('Restaurant 86-to-0 Board'),
  description: 'Real-time "86 this item" kitchen board with a countdown to zero servings left.',
  category: 'Restaurant Ops', businessGoal: 'Reduce food waste and kitchen confusion',
  targetCustomer: 'Kitchen staff and line cooks',
  monetizationModel: 'One-time license', priority: 'P2_MEDIUM', overallStatus: 'TESTING',
  overallProgress: 63, currentVersionId: v4a, nextAction: 'Connect repo to track work',
  archived: false, createdAt: daysAgo(26), updatedAt: daysAgo(3), lastActivityAt: daysAgo(3),
};

const version4a: ProjectVersion = {
  id: v4a, projectId: p4, userId: uid, versionName: 'Replit Build', builder: 'Replit',
  model: 'Replit Agent', developmentPlatform: 'Replit',
  status: 'TESTING', progress: 63, deploymentIds: [], branch: 'main', lastActivityAt: daysAgo(3),
  estimatedCost: 60, actualCost: 25, developmentHours: 15, isWinner: false, isArchived: false,
  notes: 'No repository linked — Replit workspace only.', createdAt: daysAgo(24), updatedAt: daysAgo(3),
};

const tasks4: Task[] = [
  {
    id: t4a, userId: uid, projectId: p4, projectVersionId: v4a, title: 'Export Replit project to GitHub',
    status: 'NEXT', priority: 'P2_MEDIUM', taskType: 'REFACTOR', dueDate: daysAgo(4),
    estimatedMinutes: 45, position: 0, createdAt: daysAgo(5), updatedAt: daysAgo(4),
  },
];

// ---------------------------------------------------------------------------
// 5. Menu Competitor Analyzer (Gemini & FreeBuff) — Testing
// ---------------------------------------------------------------------------
const p5 = id('p');
const v5a = id('v');
const v5b = id('v');
const r5 = id('r');
const d5a = id('d');
const t5a = id('t');
const e5a = id('e');

const p5obj: Project = {
  id: p5, userId: uid, name: 'Menu Competitor Analyzer', slug: slugify('Menu Competitor Analyzer'),
  description: 'Scrapes competitor menus and summarizes pricing/positioning with AI.',
  category: 'Market Intelligence', businessGoal: 'Give restaurants an edge on menu strategy',
  targetCustomer: 'Restaurant owners & consultants',
  monetizationModel: 'Usage credits', priority: 'P2_MEDIUM', overallStatus: 'TESTING',
  overallProgress: 58, currentVersionId: v5a, nextAction: 'Rate-limit scraper to avoid bans',
  archived: false, createdAt: daysAgo(21), updatedAt: daysAgo(1), lastActivityAt: daysAgo(1),
};

const version5a: ProjectVersion = {
  id: v5a, projectId: p5, userId: uid, versionName: 'Gemini Build', builder: 'Gemini',
  model: 'Gemini 1.5 Flash', developmentPlatform: 'Next.js',
  status: 'TESTING', progress: 60, localFolderPath: '~/dev/menu-analyzer/gemini',
  repositoryId: r5, deploymentIds: [d5a], primaryDeploymentId: d5a, branch: 'main',
  lastCommitAt: daysAgo(1), lastActivityAt: daysAgo(1), estimatedCost: 100, actualCost: 70,
  developmentHours: 28, isWinner: false, isArchived: false, createdAt: daysAgo(20), updatedAt: daysAgo(1),
};

const version5b: ProjectVersion = {
  id: v5b, projectId: p5, userId: uid, versionName: 'FreeBuff Build', builder: 'FreeBuff',
  model: 'FreeBuff (DeepSeek-v4)', developmentPlatform: 'React + Firebase',
  status: 'CONCEPT', progress: 8, deploymentIds: [], branch: 'main', lastActivityAt: daysAgo(7),
  estimatedCost: 50, actualCost: 0, developmentHours: 1, isWinner: false, isArchived: false,
  createdAt: daysAgo(8), updatedAt: daysAgo(7),
};

const repo5: Repository = {
  id: r5, userId: uid, projectVersionId: v5a, provider: 'github', owner: 'chef-labs',
  repositoryName: 'menu-competitor-analyzer', repositoryUrl: 'https://github.com/chef-labs/menu-competitor-analyzer',
  defaultBranch: 'main', currentBranch: 'main', private: true,
  lastCommitAt: daysAgo(1), openPullRequests: 0, openIssues: 6, workflowStatus: 'success',
  commitsAhead: 2, commitsBehind: 0, hasUncommittedChanges: false, hasUnpushedCommits: true,
  lastScannedAt: hoursAgo(20), connectionStatus: 'CONNECTED', createdAt: daysAgo(20), updatedAt: hoursAgo(20),
};

const deploy5a: Deployment = {
  id: d5a, userId: uid, projectVersionId: v5a, provider: 'vercel', projectName: 'menu-competitor-analyzer',
  environment: 'production', deploymentUrl: 'https://menu-competitor-analyzer.vercel.app',
  status: 'READY', healthStatus: 'HEALTHY', lastDeploymentAt: daysAgo(1),
  lastSuccessfulDeploymentAt: daysAgo(1), framework: 'Next.js', branch: 'main',
  responseCode: 200, responseTimeMs: 610, lastHealthCheckAt: hoursAgo(22),
  createdAt: daysAgo(19), updatedAt: hoursAgo(22),
};

const tasks5: Task[] = [
  {
    id: t5a, userId: uid, projectId: p5, projectVersionId: v5a, title: 'Rate-limit scraper to avoid IP bans',
    status: 'IN_PROGRESS', priority: 'P1_HIGH', taskType: 'BUG', dueDate: daysAgo(1),
    estimatedMinutes: 150, actualMinutes: 60, position: 0, createdAt: daysAgo(3), updatedAt: hoursAgo(10),
  },
];

const eval5a: ModelEvaluation = {
  id: e5a, userId: uid, projectId: p5, projectVersionId: v5a, builder: 'Gemini', model: 'Gemini 1.5 Flash',
  uiScore: 6, featureScore: 7, codeQualityScore: 6, stabilityScore: 7, performanceScore: 8,
  maintainabilityScore: 6, mobileScore: 5, accessibilityScore: 5, developmentSpeedScore: 8,
  costScore: 8, overallScore: 0, evaluatorNotes: 'Cheap and fast; scraping needs throttling.',
  evaluatedAt: daysAgo(2), createdAt: daysAgo(2), updatedAt: daysAgo(2),
};
eval5a.overallScore = computeOverallScore(eval5a);

// ---------------------------------------------------------------------------
// 6. Takeout Voice 2 (Anti-Gravity) — Staging deployment
// ---------------------------------------------------------------------------
const p6 = id('p');
const v6a = id('v');
const d6a = id('d');
const t6a = id('t');

const p6obj: Project = {
  id: p6, userId: uid, name: 'Takeout Voice 2', slug: slugify('Takeout Voice 2'),
  description: 'Voice-driven takeout ordering assistant — second iteration built with Anti-Gravity.',
  category: 'Voice / Ordering', businessGoal: 'Test voice-first ordering UX',
  targetCustomer: 'People who order takeout on the go',
  monetizationModel: 'Per-order fee', priority: 'P3_LOW', overallStatus: 'BUILDING',
  overallProgress: 35, currentVersionId: v6a, nextAction: 'Promote staging to production',
  nextActionDueDate: daysAgo(-1), archived: false, createdAt: daysAgo(14), updatedAt: hoursAgo(9),
  lastActivityAt: hoursAgo(9),
};

const version6a: ProjectVersion = {
  id: v6a, projectId: p6, userId: uid, versionName: 'Anti-Gravity Build', builder: 'Anti-Gravity',
  model: 'Anti-Gravity', developmentPlatform: 'Anti-Gravity',
  status: 'BUILDING', progress: 35, deploymentIds: [d6a], primaryDeploymentId: d6a, branch: 'main',
  lastDeploymentAt: hoursAgo(9), lastActivityAt: hoursAgo(9), estimatedCost: 40, actualCost: 15,
  developmentHours: 6, isWinner: false, isArchived: false,
  notes: 'Staging only, no repo yet.', createdAt: daysAgo(13), updatedAt: hoursAgo(9),
};

const deploy6a: Deployment = {
  id: d6a, userId: uid, projectVersionId: v6a, provider: 'other', projectName: 'takeout-voice-2',
  environment: 'staging', deploymentUrl: 'https://takeout-voice-2.antigravity.app/staging',
  status: 'READY', healthStatus: 'UNKNOWN', lastDeploymentAt: hoursAgo(9),
  lastSuccessfulDeploymentAt: hoursAgo(9), createdAt: hoursAgo(9), updatedAt: hoursAgo(9),
};

const tasks6: Task[] = [
  {
    id: t6a, userId: uid, projectId: p6, projectVersionId: v6a, title: 'Promote staging to production',
    status: 'NEXT', priority: 'P1_HIGH', taskType: 'DEPLOYMENT', dueDate: daysAgo(-1),
    estimatedMinutes: 45, position: 0, createdAt: daysAgo(2), updatedAt: daysAgo(1),
  },
];

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------
const activity: ActivityEntry[] = [
  {
    id: id('a'), userId: uid, projectId: p2, projectVersionId: v2a, kind: 'task_updated',
    message: 'Task "A/B retention test: Gemini vs Kimi" is now due', createdAt: daysAgo(2),
  },
  {
    id: id('a'), userId: uid, projectId: p2, projectVersionId: v2b, kind: 'deployment_updated',
    message: 'Weeknight Planner (Kimi) health check returned 503', createdAt: minutesAgo(8),
  },
  {
    id: id('a'), userId: uid, projectId: p1, projectVersionId: v1a, kind: 'repository_scanned',
    message: 'chef-video-guide-codex scanned: 4 commits ahead, 2 local changes', createdAt: minutesAgo(42),
  },
  {
    id: id('a'), userId: uid, projectId: p3, projectVersionId: v3a, kind: 'alert_triggered',
    message: 'Rule 4 fired: production deployment failed (workflow failure)', createdAt: hoursAgo(5),
  },
  {
    id: id('a'), userId: uid, projectId: p1, projectVersionId: v1a, kind: 'evaluation_created',
    message: 'Evaluation added for Codex Build (overall 6.6/10)', createdAt: daysAgo(3),
  },
  {
    id: id('a'), userId: uid, projectId: p6, projectVersionId: v6a, kind: 'deployment_created',
    message: 'New staging deployment for Takeout Voice 2', createdAt: hoursAgo(9),
  },
  {
    id: id('a'), userId: uid, projectId: p4, projectVersionId: v4a, kind: 'version_updated',
    message: 'Restaurant 86-to-0 Board progress updated to 63%', createdAt: daysAgo(3),
  },
];

export interface SeedBundle {
  profile: UserProfile;
  projects: Project[];
  versions: ProjectVersion[];
  repositories: Repository[];
  deployments: Deployment[];
  tasks: Task[];
  evaluations: ModelEvaluation[];
  activity: ActivityEntry[];
}

export const buildSeed = (): SeedBundle => ({
  profile: {
    id: uid,
    name: 'Demo Cook',
    email: DEMO_USER_EMAIL,
    timezone: 'America/Los_Angeles',
    dailyReportEnabled: true,
    dailyReportTime: '08:00',
    weeklyReportEnabled: true,
    weeklyReportDay: 1,
    weeklyReportTime: '09:00',
    defaultStaleDays: 7,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(1),
  },
  projects: [p1obj, p2obj, p3obj, p4obj, p5obj, p6obj],
  versions: [version1a, version1b, version2a, version2b, version3a, version3b, version4a, version5a, version5b, version6a],
  repositories: [repo1, repo2, repo3, repo5],
  deployments: [deploy1a, deploy1b, deploy2a, deploy2b, deploy3a, deploy5a, deploy6a],
  tasks: [...tasks1, ...tasks2, ...tasks3, ...tasks4, ...tasks5, ...tasks6],
  evaluations: [eval1, eval2a, eval2b, eval5a],
  activity,
});

