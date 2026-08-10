import { z } from 'zod';

// ============================================================================
// ENUMS
// ============================================================================

export type PriorityLevel = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
export type ProjectStatus =
  | 'CONCEPT'
  | 'BUILDING'
  | 'TESTING'
  | 'PAUSED'
  | 'WINNER_SELECTED'
  | 'ARCHIVED';
export type TaskStatus =
  | 'BACKLOG'
  | 'NEXT'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'REVIEW'
  | 'COMPLETED'
  | 'CANCELED';
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN' | 'NOT_CHECKED';
export type TaskType = 'FEATURE' | 'BUG' | 'DEPLOYMENT' | 'EVALUATION' | 'REFACTOR' | 'OTHER';
export type RepoProvider = 'github' | 'bitbucket' | 'gitlab' | 'other';
export type DeploymentProvider =
  | 'vercel'
  | 'firebase'
  | 'cloud_run'
  | 'replit'
  | 'netlify'
  | 'railway'
  | 'render'
  | 'lovable'
  | 'ai_studio'
  | 'other';
export type Environment = 'production' | 'staging' | 'preview';
export type DeploymentStatus = 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';
export type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'AUTH_ERROR';

export const PRIORITY_LEVELS: PriorityLevel[] = ['P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW'];
export const PROJECT_STATUSES: ProjectStatus[] = [
  'CONCEPT', 'BUILDING', 'TESTING', 'PAUSED', 'WINNER_SELECTED', 'ARCHIVED',
];
export const TASK_STATUSES: TaskStatus[] = [
  'BACKLOG', 'NEXT', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED', 'CANCELED',
];
export const TASK_TYPES: TaskType[] = [
  'FEATURE', 'BUG', 'DEPLOYMENT', 'EVALUATION', 'REFACTOR', 'OTHER',
];
export const DEPLOYMENT_PROVIDERS: DeploymentProvider[] = [
  'vercel', 'firebase', 'cloud_run', 'replit', 'netlify', 'railway', 'render',
  'lovable', 'ai_studio', 'other',
];

// ============================================================================
// DOMAIN ENTITIES
// ============================================================================

export interface UserProfile {
  id: string;
  name: string;
  timezone: string;
  dailyReportEnabled: boolean;
  dailyReportTime: string; // HH:mm
  weeklyReportEnabled: boolean;
  weeklyReportDay: number; // 0-6 (0 = Sunday)
  weeklyReportTime: string;
  defaultStaleDays: number; // e.g. 7
  /** Preferred OpenRouter model id for AI summaries (e.g. deepseek/deepseek-chat).
   *  Empty means "use the OPENROUTER_MODEL env default". */
  aiModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  businessGoal: string;
  targetCustomer: string;
  monetizationModel: string;
  priority: PriorityLevel;
  overallStatus: ProjectStatus;
  overallProgress: number; // 0-100
  winningVersionId?: string;
  currentVersionId?: string;
  nextAction: string;
  nextActionDueDate?: string;
  blocker?: string;
  notes?: string;
  /** Optional AI-drafted "why this version wins" recommendation (OpenRouter). */
  winnerRecommendation?: string;
  /** Model id that produced winnerRecommendation. */
  winnerRecommendationModel?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  userId: string;
  versionName: string;
  builder: string; // Lovable, Replit, Google AI Studio, Anti-Gravity, etc.
  model: string; // Gemini 1.5 Pro, DeepSeek-R1, Kimi K3, Claude 3.5 Sonnet, etc.
  modelVersion?: string;
  developmentPlatform: string;
  status: ProjectStatus;
  progress: number; // 0-100
  localFolderPath?: string;
  repositoryId?: string;
  deploymentIds: string[];
  primaryDeploymentId?: string;
  branch: string;
  currentMilestoneId?: string;
  nextTaskId?: string;
  blocker?: string;
  lastCommitAt?: string;
  lastDeploymentAt?: string;
  lastActivityAt: string;
  estimatedCost: number;
  actualCost: number;
  developmentHours: number;
  isWinner: boolean;
  isArchived: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  id: string;
  userId: string;
  projectVersionId?: string;
  provider: RepoProvider;
  owner: string;
  repositoryName: string;
  repositoryUrl: string;
  defaultBranch: string;
  currentBranch: string;
  private: boolean;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  lastCommitAt?: string;
  openPullRequests: number;
  openIssues: number;
  workflowStatus?: 'success' | 'failure' | 'pending';
  commitsAhead: number;
  commitsBehind: number;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  lastScannedAt: string;
  connectionStatus: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  userId: string;
  projectVersionId?: string;
  provider: DeploymentProvider;
  projectName: string;
  environment: Environment;
  deploymentUrl: string;
  dashboardUrl?: string;
  status: DeploymentStatus;
  healthStatus: HealthStatus;
  lastDeploymentAt?: string;
  lastSuccessfulDeploymentAt?: string;
  lastFailureMessage?: string;
  framework?: string;
  branch?: string;
  commitSha?: string;
  responseCode?: number;
  responseTimeMs?: number;
  lastHealthCheckAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  userId: string;
  projectId: string;
  projectVersionId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: PriorityLevel;
  taskType: TaskType;
  dueDate?: string;
  reminderDate?: string;
  completedAt?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  blockedBy?: string;
  source?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModelEvaluation {
  id: string;
  userId: string;
  projectId: string;
  projectVersionId: string;
  builder: string;
  model: string;
  uiScore: number; // 1-10
  featureScore: number; // 1-10
  codeQualityScore: number; // 1-10
  stabilityScore: number; // 1-10
  performanceScore: number; // 1-10
  maintainabilityScore: number; // 1-10
  mobileScore: number; // 1-10
  accessibilityScore: number; // 1-10
  developmentSpeedScore: number; // 1-10
  costScore: number; // 1-10
  overallScore: number; // computed via weights
  evaluatorNotes?: string;
  evaluatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEntry {
  id: string;
  userId: string;
  projectId?: string;
  projectVersionId?: string;
  kind:
    | 'project_created'
    | 'project_updated'
    | 'version_created'
    | 'version_updated'
    | 'winner_selected'
    | 'deployment_created'
    | 'deployment_updated'
    | 'task_created'
    | 'task_completed'
    | 'task_updated'
    | 'repository_created'
    | 'repository_scanned'
    | 'evaluation_created'
    | 'evaluation_updated'
    | 'report_generated'
    | 'alert_triggered'
    | 'scan_ingested';
  message: string;
  createdAt: string;
}

export interface Report {
  id: string;
  userId: string;
  kind: 'daily' | 'weekly' | 'monthly';
  title: string;
  body: string; // markdown-ish plain text
  attentionCount: number;
  createdAt: string;
  /** Optional AI-written executive summary (OpenRouter). Absent when the AI
   *  integration is unconfigured or the call failed — deterministic fallback. */
  aiSummary?: string;
  /** Model id that produced aiSummary (e.g. deepseek/deepseek-chat). */
  aiModel?: string;
}

export interface Reminder {
  id: string;
  userId: string;
  projectId?: string;
  title: string;
  note?: string;
  remindAt: string; // ISO or YYYY-MM-DDTHH:mm
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const PrioritySchema = z.enum(PRIORITY_LEVELS as [PriorityLevel, ...PriorityLevel[]]);
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]);
export const TaskStatusSchema = z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]);
export const TaskTypeSchema = z.enum(TASK_TYPES as [TaskType, ...TaskType[]]);
export const HealthStatusSchema = z.enum(['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN', 'NOT_CHECKED']);
export const DeploymentStatusSchema = z.enum(['BUILDING', 'READY', 'ERROR', 'CANCELED']);
export const EnvironmentSchema = z.enum(['production', 'staging', 'preview']);
export const RepoProviderSchema = z.enum(['github', 'bitbucket', 'gitlab', 'other']);
export const DeploymentProviderSchema = z.enum(DEPLOYMENT_PROVIDERS as [DeploymentProvider, ...DeploymentProvider[]]);
export const ConnectionStatusSchema = z.enum(['CONNECTED', 'DISCONNECTED', 'AUTH_ERROR']);

const idString = z.string().min(1);
const timestamp = z.string().datetime({ offset: true }).or(z.string().min(10));

export const UserProfileSchema = z.object({
  id: idString,
  name: z.string().min(1),
  timezone: z.string().default('America/Los_Angeles'),
  dailyReportEnabled: z.boolean(),
  dailyReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weeklyReportEnabled: z.boolean(),
  weeklyReportDay: z.number().int().min(0).max(6),
  weeklyReportTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  defaultStaleDays: z.number().int().min(1).max(90),
  aiModel: z.string().max(120).optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const ProjectSchema = z.object({
  id: idString,
  userId: idString,
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().default(''),
  category: z.string().default(''),
  businessGoal: z.string().default(''),
  targetCustomer: z.string().default(''),
  monetizationModel: z.string().default(''),
  priority: PrioritySchema,
  overallStatus: ProjectStatusSchema,
  overallProgress: z.number().int().min(0).max(100),
  winningVersionId: z.string().optional(),
  currentVersionId: z.string().optional(),
  nextAction: z.string().default(''),
  nextActionDueDate: z.string().optional(),
  blocker: z.string().optional(),
  notes: z.string().optional(),
  winnerRecommendation: z.string().optional(),
  winnerRecommendationModel: z.string().optional(),
  archived: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastActivityAt: timestamp,
});

export const ProjectVersionSchema = z.object({
  id: idString,
  projectId: idString,
  userId: idString,
  versionName: z.string().min(1),
  builder: z.string().min(1),
  model: z.string().min(1),
  modelVersion: z.string().optional(),
  developmentPlatform: z.string().default(''),
  status: ProjectStatusSchema,
  progress: z.number().int().min(0).max(100),
  localFolderPath: z.string().optional(),
  repositoryId: z.string().optional(),
  deploymentIds: z.array(z.string()).default([]),
  primaryDeploymentId: z.string().optional(),
  branch: z.string().default('main'),
  currentMilestoneId: z.string().optional(),
  nextTaskId: z.string().optional(),
  blocker: z.string().optional(),
  lastCommitAt: z.string().optional(),
  lastDeploymentAt: z.string().optional(),
  lastActivityAt: timestamp,
  estimatedCost: z.number().min(0),
  actualCost: z.number().min(0),
  developmentHours: z.number().min(0),
  isWinner: z.boolean(),
  isArchived: z.boolean(),
  notes: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const RepositorySchema = z.object({
  id: idString,
  userId: idString,
  projectVersionId: z.string().optional(),
  provider: RepoProviderSchema,
  owner: z.string().min(1),
  repositoryName: z.string().min(1),
  repositoryUrl: z.string().url(),
  defaultBranch: z.string().default('main'),
  currentBranch: z.string().default('main'),
  private: z.boolean(),
  lastCommitSha: z.string().optional(),
  lastCommitMessage: z.string().optional(),
  lastCommitAt: z.string().optional(),
  openPullRequests: z.number().int().min(0),
  openIssues: z.number().int().min(0),
  workflowStatus: z.enum(['success', 'failure', 'pending']).optional(),
  commitsAhead: z.number().int().min(0),
  commitsBehind: z.number().int().min(0),
  hasUncommittedChanges: z.boolean(),
  hasUnpushedCommits: z.boolean(),
  lastScannedAt: timestamp,
  connectionStatus: ConnectionStatusSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const DeploymentSchema = z.object({
  id: idString,
  userId: idString,
  projectVersionId: z.string().optional(),
  provider: DeploymentProviderSchema,
  projectName: z.string().min(1),
  environment: EnvironmentSchema,
  deploymentUrl: z.string().url(),
  dashboardUrl: z.string().url().optional(),
  status: DeploymentStatusSchema,
  healthStatus: HealthStatusSchema,
  lastDeploymentAt: z.string().optional(),
  lastSuccessfulDeploymentAt: z.string().optional(),
  lastFailureMessage: z.string().optional(),
  framework: z.string().optional(),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
  responseCode: z.number().int().optional(),
  responseTimeMs: z.number().int().optional(),
  lastHealthCheckAt: z.string().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const TaskSchema = z.object({
  id: idString,
  userId: idString,
  projectId: idString,
  projectVersionId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: TaskStatusSchema,
  priority: PrioritySchema,
  taskType: TaskTypeSchema,
  dueDate: z.string().optional(),
  reminderDate: z.string().optional(),
  completedAt: z.string().optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  actualMinutes: z.number().int().min(0).optional(),
  blockedBy: z.string().optional(),
  source: z.string().optional(),
  position: z.number().int().min(0),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const ModelEvaluationSchema = z.object({
  id: idString,
  userId: idString,
  projectId: idString,
  projectVersionId: idString,
  builder: z.string(),
  model: z.string(),
  uiScore: z.number().int().min(1).max(10),
  featureScore: z.number().int().min(1).max(10),
  codeQualityScore: z.number().int().min(1).max(10),
  stabilityScore: z.number().int().min(1).max(10),
  performanceScore: z.number().int().min(1).max(10),
  maintainabilityScore: z.number().int().min(1).max(10),
  mobileScore: z.number().int().min(1).max(10),
  accessibilityScore: z.number().int().min(1).max(10),
  developmentSpeedScore: z.number().int().min(1).max(10),
  costScore: z.number().int().min(1).max(10),
  overallScore: z.number().min(1).max(10),
  evaluatorNotes: z.string().optional(),
  evaluatedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const ActivityEntrySchema = z.object({
  id: idString,
  userId: idString,
  projectId: z.string().optional(),
  projectVersionId: z.string().optional(),
  kind: z.enum([
    'project_created', 'project_updated', 'version_created', 'version_updated',
    'winner_selected', 'deployment_created', 'deployment_updated',
    'task_created', 'task_completed', 'task_updated',
    'repository_created', 'repository_scanned', 'evaluation_created',
    'evaluation_updated', 'report_generated', 'alert_triggered', 'scan_ingested',
  ]),
  message: z.string().min(1),
  createdAt: timestamp,
});

export const ReportSchema = z.object({
  id: idString,
  userId: idString,
  kind: z.enum(['daily', 'weekly', 'monthly']),
  title: z.string(),
  body: z.string(),
  attentionCount: z.number().int().min(0),
  createdAt: timestamp,
  aiSummary: z.string().optional(),
  aiModel: z.string().optional(),
});

export const ReminderSchema = z.object({
  id: idString,
  userId: idString,
  projectId: z.string().optional(),
  title: z.string().min(1),
  note: z.string().optional(),
  remindAt: z.string().min(4),
  done: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

// ============================================================================
// MODEL EVALUATION SCORING FORMULA  (1–10 scale)
// ============================================================================
// Overall = 0.15*UI + 0.20*Feature + 0.15*CodeQuality + 0.15*Stability
//         + 0.10*Performance + 0.10*Maintainability + 0.05*Speed + 0.05*Cost
//         + 0.03*Mobile + 0.02*Accessibility

export const SCORING_WEIGHTS = {
  uiScore: 0.15,
  featureScore: 0.2,
  codeQualityScore: 0.15,
  stabilityScore: 0.15,
  performanceScore: 0.1,
  maintainabilityScore: 0.1,
  developmentSpeedScore: 0.05,
  costScore: 0.05,
  mobileScore: 0.03,
  accessibilityScore: 0.02,
} as const;

export type ScoreKeys = keyof typeof SCORING_WEIGHTS;

export const computeOverallScore = (
  scores: Record<ScoreKeys, number>,
): number => {
  const total = (Object.keys(SCORING_WEIGHTS) as ScoreKeys[]).reduce(
    (sum, key) => sum + scores[key] * SCORING_WEIGHTS[key],
    0,
  );
  return Math.round(total * 10) / 10;
};

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
