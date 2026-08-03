import type { Task, Reminder } from '@/types';

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
