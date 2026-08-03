// ============================================================================
// Client-side live-data facade.
//
// The store calls these functions when the matching live source is enabled:
//   NEXT_PUBLIC_LIVE_TASKS=1        → Tasks + Reminders via Supabase
//   NEXT_PUBLIC_LIVE_REPOS=1        → Repositories via GitHub API
//   NEXT_PUBLIC_LIVE_DEPLOYMENTS=1  → Deployments via Vercel API + health checks
//
// Every call goes through the app's own server routes (which hold the real
// secrets), passing the acting userId in the `x-app-user` header — the same
// isolation key used across the data layer.
// ============================================================================

import type { Task, Reminder, Repository, Deployment } from '@/types';

export interface LiveFlags {
  tasks: boolean;
  reminders: boolean;
  repositories: boolean;
  deployments: boolean;
}

export const readLiveFlags = (): LiveFlags => ({
  tasks: process.env.NEXT_PUBLIC_LIVE_TASKS === '1',
  reminders: process.env.NEXT_PUBLIC_LIVE_TASKS === '1',
  repositories: process.env.NEXT_PUBLIC_LIVE_REPOS === '1',
  deployments: process.env.NEXT_PUBLIC_LIVE_DEPLOYMENTS === '1',
});

const call = async <T>(path: string, userId: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-app-user': userId,
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) {
    throw new Error(body.error ?? `Request to ${path} failed (${res.status})`);
  }
  return body;
};

// ─── Tasks ──────────────────────────────────────────────────────────────────
export const fetchLiveTasks = (userId: string) =>
  call<{ tasks: Task[]; configured: boolean }>('/api/tasks', userId);

export const saveLiveTask = (userId: string, task: Task) => {
  const { id, ...rest } = task;
  return call<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, userId, {
    method: 'PATCH',
    body: JSON.stringify(rest),
  });
};

export const createLiveTask = (userId: string, task: Task) =>
  call<{ task: Task }>('/api/tasks', userId, { method: 'POST', body: JSON.stringify(task) });

export const deleteLiveTask = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/tasks/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });

// ─── Reminders ──────────────────────────────────────────────────────────────
export const fetchLiveReminders = (userId: string) =>
  call<{ reminders: Reminder[]; configured: boolean }>('/api/reminders', userId);

export const createLiveReminder = (userId: string, reminder: Reminder) =>
  call<{ reminder: Reminder }>('/api/reminders', userId, {
    method: 'POST',
    body: JSON.stringify(reminder),
  });

export const updateLiveReminder = (userId: string, reminder: Reminder) => {
  const { id, ...rest } = reminder;
  return call<{ reminder: Reminder }>(`/api/reminders/${encodeURIComponent(id)}`, userId, {
    method: 'PATCH',
    body: JSON.stringify(rest),
  });
};

export const deleteLiveReminder = (userId: string, id: string) =>
  call<{ ok: true }>(`/api/reminders/${encodeURIComponent(id)}`, userId, { method: 'DELETE' });

// ─── Repositories (live GitHub feed) ────────────────────────────────────────
export const fetchLiveRepos = (userId: string) =>
  call<{ repositories: Repository[]; configured: boolean }>('/api/repos', userId);

// ─── Deployments (live Vercel feed + health checks) ─────────────────────────
export const fetchLiveDeployments = (userId: string) =>
  call<{ deployments: Deployment[]; configured: boolean }>('/api/deployments', userId);
