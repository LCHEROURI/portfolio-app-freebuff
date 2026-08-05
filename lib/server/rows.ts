import type { Task, Reminder, Project, ProjectVersion, ModelEvaluation, ActivityEntry } from '@/types';

// ============================================================================
// Shared DB row mappers (Task/Reminder ↔ Supabase snake_case rows).
// Single source of truth so route files can't drift.
// ============================================================================

export type Row = Record<string, unknown>;

// ─── Tasks ──────────────────────────────────────────────────────────────────

export const toTaskRow = (t: Task): Row => ({
  id: t.id,
  owner_id: t.userId,
  project_id: t.projectId,
  project_version_id: t.projectVersionId ?? null,
  title: t.title,
  description: t.description ?? null,
  status: t.status,
  priority: t.priority,
  task_type: t.taskType,
  due_date: t.dueDate ?? null,
  reminder_date: t.reminderDate ?? null,
  completed_at: t.completedAt ?? null,
  estimated_minutes: t.estimatedMinutes ?? null,
  actual_minutes: t.actualMinutes ?? null,
  blocked_by: t.blockedBy ?? null,
  source: t.source ?? null,
  position: t.position,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
});

export const fromTaskRow = (r: Row): Task => ({
  id: String(r.id),
  userId: String(r.owner_id),
  projectId: String(r.project_id ?? ''),
  projectVersionId: r.project_version_id != null ? String(r.project_version_id) : undefined,
  title: String(r.title),
  description: r.description != null ? String(r.description) : undefined,
  status: r.status as Task['status'],
  priority: r.priority as Task['priority'],
  taskType: r.task_type as Task['taskType'],
  dueDate: r.due_date != null ? String(r.due_date) : undefined,
  reminderDate: r.reminder_date != null ? String(r.reminder_date) : undefined,
  completedAt: r.completed_at != null ? String(r.completed_at) : undefined,
  estimatedMinutes: r.estimated_minutes != null ? Number(r.estimated_minutes) : undefined,
  actualMinutes: r.actual_minutes != null ? Number(r.actual_minutes) : undefined,
  blockedBy: r.blocked_by != null ? String(r.blocked_by) : undefined,
  source: r.source != null ? String(r.source) : undefined,
  position: Number(r.position ?? 0),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

// ─── Reminders ──────────────────────────────────────────────────────────────

export const toReminderRow = (r: Reminder): Row => ({
  id: r.id,
  owner_id: r.userId,
  project_id: r.projectId ?? null,
  title: r.title,
  note: r.note ?? null,
  remind_at: r.remindAt,
  done: r.done,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
});

export const fromReminderRow = (r: Row): Reminder => ({
  id: String(r.id),
  userId: String(r.owner_id),
  projectId: r.project_id != null ? String(r.project_id) : undefined,
  title: String(r.title),
  note: r.note != null ? String(r.note) : undefined,
  remindAt: String(r.remind_at),
  done: Boolean(r.done),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

// ─── Projects ───────────────────────────────────────────────────────────────

export const toProjectRow = (p: Project): Row => ({
  id: p.id,
  owner_id: p.userId,
  name: p.name,
  slug: p.slug,
  description: p.description ?? '',
  category: p.category ?? '',
  business_goal: p.businessGoal ?? '',
  target_customer: p.targetCustomer ?? '',
  monetization_model: p.monetizationModel ?? '',
  priority: p.priority,
  overall_status: p.overallStatus,
  overall_progress: p.overallProgress,
  winning_version_id: p.winningVersionId ?? null,
  current_version_id: p.currentVersionId ?? null,
  next_action: p.nextAction ?? '',
  next_action_due_date: p.nextActionDueDate ?? null,
  blocker: p.blocker ?? null,
  notes: p.notes ?? null,
  winner_recommendation: p.winnerRecommendation ?? null,
  winner_recommendation_model: p.winnerRecommendationModel ?? null,
  archived: p.archived,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
  last_activity_at: p.lastActivityAt,
});

export const fromProjectRow = (r: Row): Project => ({
  id: String(r.id),
  userId: String(r.owner_id),
  name: String(r.name),
  slug: String(r.slug),
  description: String(r.description ?? ''),
  category: String(r.category ?? ''),
  businessGoal: String(r.business_goal ?? ''),
  targetCustomer: String(r.target_customer ?? ''),
  monetizationModel: String(r.monetization_model ?? ''),
  priority: r.priority as Project['priority'],
  overallStatus: r.overall_status as Project['overallStatus'],
  overallProgress: Number(r.overall_progress ?? 0),
  winningVersionId: r.winning_version_id != null ? String(r.winning_version_id) : undefined,
  currentVersionId: r.current_version_id != null ? String(r.current_version_id) : undefined,
  nextAction: String(r.next_action ?? ''),
  nextActionDueDate: r.next_action_due_date != null ? String(r.next_action_due_date) : undefined,
  blocker: r.blocker != null ? String(r.blocker) : undefined,
  notes: r.notes != null ? String(r.notes) : undefined,
  winnerRecommendation: r.winner_recommendation != null ? String(r.winner_recommendation) : undefined,
  winnerRecommendationModel: r.winner_recommendation_model != null ? String(r.winner_recommendation_model) : undefined,
  archived: Boolean(r.archived),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  lastActivityAt: String(r.last_activity_at),
});

// ─── Versions ───────────────────────────────────────────────────────────────

export const toVersionRow = (v: ProjectVersion): Row => ({
  id: v.id,
  project_id: v.projectId,
  owner_id: v.userId,
  version_name: v.versionName,
  builder: v.builder,
  model: v.model,
  model_version: v.modelVersion ?? null,
  development_platform: v.developmentPlatform ?? '',
  status: v.status,
  progress: v.progress,
  local_folder_path: v.localFolderPath ?? null,
  repository_id: v.repositoryId ?? null,
  deployment_ids: v.deploymentIds,
  primary_deployment_id: v.primaryDeploymentId ?? null,
  branch: v.branch ?? 'main',
  current_milestone_id: v.currentMilestoneId ?? null,
  next_task_id: v.nextTaskId ?? null,
  blocker: v.blocker ?? null,
  last_commit_at: v.lastCommitAt ?? null,
  last_deployment_at: v.lastDeploymentAt ?? null,
  last_activity_at: v.lastActivityAt,
  estimated_cost: v.estimatedCost,
  actual_cost: v.actualCost,
  development_hours: v.developmentHours,
  is_winner: v.isWinner,
  is_archived: v.isArchived,
  notes: v.notes ?? null,
  created_at: v.createdAt,
  updated_at: v.updatedAt,
});

export const fromVersionRow = (r: Row): ProjectVersion => ({
  id: String(r.id),
  projectId: String(r.project_id),
  userId: String(r.owner_id),
  versionName: String(r.version_name),
  builder: String(r.builder),
  model: String(r.model),
  modelVersion: r.model_version != null ? String(r.model_version) : undefined,
  developmentPlatform: String(r.development_platform ?? ''),
  status: r.status as ProjectVersion['status'],
  progress: Number(r.progress ?? 0),
  localFolderPath: r.local_folder_path != null ? String(r.local_folder_path) : undefined,
  repositoryId: r.repository_id != null ? String(r.repository_id) : undefined,
  deploymentIds: Array.isArray(r.deployment_ids) ? r.deployment_ids.map(String) : [],
  primaryDeploymentId: r.primary_deployment_id != null ? String(r.primary_deployment_id) : undefined,
  branch: String(r.branch ?? 'main'),
  currentMilestoneId: r.current_milestone_id != null ? String(r.current_milestone_id) : undefined,
  nextTaskId: r.next_task_id != null ? String(r.next_task_id) : undefined,
  blocker: r.blocker != null ? String(r.blocker) : undefined,
  lastCommitAt: r.last_commit_at != null ? String(r.last_commit_at) : undefined,
  lastDeploymentAt: r.last_deployment_at != null ? String(r.last_deployment_at) : undefined,
  lastActivityAt: String(r.last_activity_at),
  estimatedCost: Number(r.estimated_cost ?? 0),
  actualCost: Number(r.actual_cost ?? 0),
  developmentHours: Number(r.development_hours ?? 0),
  isWinner: Boolean(r.is_winner),
  isArchived: Boolean(r.is_archived),
  notes: r.notes != null ? String(r.notes) : undefined,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

// ─── Activity (report delivery history + event feed) ────────────────────────
// Shared row shape for the Supabase activity table. The cron writes one row per
// report email attempt and the client store overlays them when Supabase is
// wired, so the Activity page shows the full delivery history.

export const toActivityRow = (a: ActivityEntry): Row => ({
  id: a.id,
  owner_id: a.userId,
  project_id: a.projectId ?? null,
  project_version_id: a.projectVersionId ?? null,
  kind: a.kind,
  message: a.message,
  created_at: a.createdAt,
});

export const fromActivityRow = (r: Row): ActivityEntry => ({
  id: String(r.id),
  userId: String(r.owner_id),
  projectId: r.project_id != null ? String(r.project_id) : undefined,
  projectVersionId: r.project_version_id != null ? String(r.project_version_id) : undefined,
  kind: r.kind as ActivityEntry['kind'],
  message: String(r.message),
  createdAt: String(r.created_at),
});

export const toEvaluationRow = (e: ModelEvaluation): Row => ({
  id: e.id,
  owner_id: e.userId,
  project_id: e.projectId,
  project_version_id: e.projectVersionId,
  builder: e.builder,
  model: e.model,
  ui_score: e.uiScore,
  feature_score: e.featureScore,
  code_quality_score: e.codeQualityScore,
  stability_score: e.stabilityScore,
  performance_score: e.performanceScore,
  maintainability_score: e.maintainabilityScore,
  mobile_score: e.mobileScore,
  accessibility_score: e.accessibilityScore,
  development_speed_score: e.developmentSpeedScore,
  cost_score: e.costScore,
  overall_score: e.overallScore,
  evaluator_notes: e.evaluatorNotes ?? null,
  evaluated_at: e.evaluatedAt,
  created_at: e.createdAt,
  updated_at: e.updatedAt,
});

export const fromEvaluationRow = (r: Row): ModelEvaluation => ({
  id: String(r.id),
  userId: String(r.owner_id),
  projectId: String(r.project_id),
  projectVersionId: String(r.project_version_id),
  builder: String(r.builder ?? ''),
  model: String(r.model ?? ''),
  uiScore: Number(r.ui_score ?? 0),
  featureScore: Number(r.feature_score ?? 0),
  codeQualityScore: Number(r.code_quality_score ?? 0),
  stabilityScore: Number(r.stability_score ?? 0),
  performanceScore: Number(r.performance_score ?? 0),
  maintainabilityScore: Number(r.maintainability_score ?? 0),
  mobileScore: Number(r.mobile_score ?? 0),
  accessibilityScore: Number(r.accessibility_score ?? 0),
  developmentSpeedScore: Number(r.development_speed_score ?? 0),
  costScore: Number(r.cost_score ?? 0),
  overallScore: Number(r.overall_score ?? 0),
  evaluatorNotes: r.evaluator_notes != null ? String(r.evaluator_notes) : undefined,
  evaluatedAt: String(r.evaluated_at),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});
