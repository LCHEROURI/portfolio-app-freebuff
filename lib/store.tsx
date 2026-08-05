'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { Sparkles } from 'lucide-react';

import { useAuth } from '@/lib/auth';
import { AuthGate } from '@/components/auth/AuthGate';
import {
  DEMO_STORAGE_KEY, DemoService, FirestoreService,
  migrateLocalDemoToFirestore, readLocalDemoData, type DataService,
} from '@/lib/firestore';
import {
  readLiveFlags, fetchLiveRepos,
  fetchLiveDeployments,
  type LiveFlags,
} from '@/lib/liveData';
import {
  type UserProfile, type Project, type ProjectVersion, type Repository,
  type Deployment, type Task, type Reminder, type ModelEvaluation,
  type ActivityEntry, type Report,
} from '@/types';
import { mergeScannerOverlay } from '@/lib/scannerOverlay';

export interface CommandCenterData {
  mode: 'firestore' | 'demo';
  profile: UserProfile;
  projects: Project[];
  versions: ProjectVersion[];
  repositories: Repository[];
  deployments: Deployment[];
  tasks: Task[];
  reminders: Reminder[];
  evaluations: ModelEvaluation[];
  activity: ActivityEntry[];
  reports: Report[];
  userId: string;
  /** Which collections are currently backed by a live integration. */
  live: LiveFlags;
  /** True when the activity feed came from Firestore (i.e. the app is running
   *  against the Firebase store, so activity is synced per-account). False when
   *  the app is showing local-only activity — the page surfaces a warning. */
  activityLive: boolean;
}

interface StoreApi extends CommandCenterData {
  loading: boolean;
  error: string | null;
  // Auth
  signOut: () => Promise<void>;
  // Migration (localStorage demo → Firestore)
  hasLocalDemoData: boolean;
  migrationDismissed: boolean;
  dismissLocalDemoMigrate: () => void;
  migrateLocalDemo: () => Promise<number>;
  // Live data refresh
  refreshLive: () => Promise<void>;
  // Project actions
  saveProject: (p: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  // Version actions
  saveVersion: (v: ProjectVersion) => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;
  selectWinner: (projectId: string, versionId: string) => Promise<void>;
  // Repo actions
  saveRepository: (r: Repository) => Promise<void>;
  // Deployment actions
  saveDeployment: (d: Deployment) => Promise<void>;
  // Task actions
  saveTask: (t: Task) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  // Reminder actions
  saveReminder: (r: Reminder) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  toggleReminder: (id: string) => Promise<void>;
  // Evaluation actions
  saveEvaluation: (e: ModelEvaluation) => Promise<void>;
  deleteEvaluation: (id: string) => Promise<void>;
  // Profile / misc
  saveProfile: (p: UserProfile) => Promise<void>;
  saveReport: (r: Report) => Promise<void>;
  logActivity: (entry: Omit<ActivityEntry, 'id' | 'userId' | 'createdAt'>) => Promise<void>;
  resetDemo: () => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const NO_LIVE: LiveFlags = { repositories: false, deployments: false };

export const StoreProvider = ({ children }: { children: ReactNode }) => {
  const { mode: authMode, user, initializing: authInitializing, signOut: authSignOut } = useAuth();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationDismissed, setMigrationDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('apcc-demo-migrated') === '1'; } catch { return false; }
  });
  const serviceRef = useRef<DataService | null>(null);

  // Firebase mode waits for auth to resolve. Demo mode loads immediately.
  useEffect(() => {
    if (authMode === 'firebase' && authInitializing) return;
    if (authMode === 'firebase' && !user) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const service = authMode === 'demo' ? new DemoService() : new FirestoreService();
        serviceRef.current = service;
        const userId = authMode === 'demo' ? 'demo-user' : user!.uid;
        const all = await service.loadAll(userId);
        if (cancelled) return;

        // Overlay live data when the matching integration is enabled. Tasks,
        // projects, versions, evaluations and activity are NOT here: they live
        // in Firestore (or the demo store) — the app's single data layer — so
        // only the GitHub/Vercel feeds overlay on top.
        const flags = readLiveFlags();
        const live: LiveFlags = { ...NO_LIVE };
        let repositories = all.repositories;
        let deployments = all.deployments;

        if (flags.repositories) {
          try {
            const r = await fetchLiveRepos(userId);
            if (r?.configured && Array.isArray(r.repositories)) {
              repositories = mergeScannerOverlay(r.repositories, all.repositories);
              live.repositories = true;
            }
          } catch { /* live repos unavailable → keep local */ }
        }
        if (flags.deployments) {
          try {
            const d = await fetchLiveDeployments(userId);
            if (d?.configured && Array.isArray(d.deployments)) {
              deployments = d.deployments;
              live.deployments = true;
            }
          } catch { /* live deployments unavailable → keep local */ }
        }

        // Activity is live whenever the Firestore store is active (per-account
        // sync); demo mode is local-only and the Activity page warns about it.
        const activityLive = service.mode === 'firestore';

        if (cancelled) return;
        // reminders stays [] (no separate live reminder store — they derive
        // from tasks on the Today page), so the spread below is explicit.
        setData({ mode: service.mode, userId, ...all, reminders: [], repositories, deployments, live, activityLive });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authMode, user, authInitializing]);

  const api = useMemo<StoreApi | null>(() => {
    if (!data) return null;
    const service = serviceRef.current!;

    const touch = <T extends { updatedAt: string }>(obj: T): T =>
      ({ ...obj, updatedAt: new Date().toISOString() });

    const mutate = async (
      apply: (prev: CommandCenterData) => CommandCenterData,
    ): Promise<void> => {
      setData((prev) => (prev ? apply(prev) : prev));
    };

    const logActivity = async (entry: Omit<ActivityEntry, 'id' | 'userId' | 'createdAt'>) => {
      const full: ActivityEntry = {
        ...entry, id: uid('a'), userId: data.userId, createdAt: new Date().toISOString(),
      };
      await service.saveActivity(full);
      await mutate((prev) => ({ ...prev, activity: [full, ...prev.activity].slice(0, 200) }));
    };

    const upsertIn = <T extends { id: string }>(list: T[], item: T): T[] =>
      list.some((x) => x.id === item.id)
        ? list.map((x) => (x.id === item.id ? item : x))
        : [...list, item];

    // Live-first persistence helpers no longer branch on a live layer: projects
    // and versions persist through the active service (Firestore or demo).
    const persistProject = async (p: Project) => {
      await service.saveProject(p);
    };
    const persistVersion = async (v: ProjectVersion) => {
      await service.saveVersion(v);
    };

    const refreshLive = async () => {
      const flags = readLiveFlags();
      const userId = data.userId;
      const next: Partial<CommandCenterData> = {};
      const live: LiveFlags = { ...data.live };

      if (flags.repositories) {
        try {
          const r = await fetchLiveRepos(userId);
          if (r?.configured && Array.isArray(r.repositories)) {
            next.repositories = mergeScannerOverlay(r.repositories, data.repositories);
            live.repositories = true;
          }
        } catch { /* keep current */ }
      }
      if (flags.deployments) {
        try {
          const d = await fetchLiveDeployments(userId);
          if (d?.configured && Array.isArray(d.deployments)) { next.deployments = d.deployments; live.deployments = true; }
        } catch { /* keep current */ }
      }
      await mutate((prev) => ({ ...prev, ...next, live }));
    };

    return {
      ...data,
      loading,
      error,
      signOut: async () => {
        await authSignOut();
        setData(null);
      },
      refreshLive,
      hasLocalDemoData: !!readLocalDemoData(),
      migrationDismissed,
      dismissLocalDemoMigrate: () => {
        try { localStorage.setItem('apcc-demo-migrated', '1'); } catch { /* ignore */ }
        setMigrationDismissed(true);
      },
      migrateLocalDemo: async () => {
        if (authMode !== 'firebase' || !user) return 0;
        const count = await migrateLocalDemoToFirestore(user.uid);
        try { localStorage.removeItem(DEMO_STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.setItem('apcc-demo-migrated', '1'); } catch { /* ignore */ }
        setMigrationDismissed(true);
        const next = new FirestoreService();
        serviceRef.current = next;
        const all = await next.loadAll(user.uid);
        setData({ mode: 'firestore', userId: user.uid, ...all, reminders: [], live: { ...NO_LIVE }, activityLive: false });
        await refreshLive();
        return count;
      },
      resetDemo: async () => {
        if (service.mode === 'demo') {
          const d = service as unknown as { resetDemo(): CommandCenterData };
          const seeded = d.resetDemo();
          setData({ ...data, ...seeded, live: { ...NO_LIVE } });
        }
      },
      saveProject: async (p: Project) => {
        const next = touch(p);
        await persistProject(next);
        await mutate((prev) => ({ ...prev, projects: upsertIn(prev.projects, next) }));
        await logActivity({ kind: 'project_updated', projectId: next.id, message: `Project "${next.name}" updated` });
      },
      deleteProject: async (id: string) => {
        await service.deleteProject(id);
        await mutate((prev) => ({
          ...prev,
          projects: prev.projects.filter((x) => x.id !== id),
          versions: prev.versions.filter((x) => x.projectId !== id),
          tasks: prev.tasks.filter((x) => x.projectId !== id),
          reminders: prev.reminders.filter((x) => x.projectId !== id),
          evaluations: prev.evaluations.filter((x) => x.projectId !== id),
        }));
      },
      saveVersion: async (v: ProjectVersion) => {
        const next = touch(v);
        await persistVersion(next);
        await mutate((prev) => ({ ...prev, versions: upsertIn(prev.versions, next) }));
      },
      deleteVersion: async (id: string) => {
        await service.deleteVersion(id);
        await mutate((prev) => ({ ...prev, versions: prev.versions.filter((x) => x.id !== id) }));
      },
      selectWinner: async (projectId: string, versionId: string) => {
        const project = data.projects.find((p) => p.id === projectId);
        if (!project) return;
        const winner = data.versions.find((v) => v.id === versionId);
        const now = new Date().toISOString();
        const updatedProject: Project = {
          ...project, winningVersionId: versionId, overallStatus: 'WINNER_SELECTED',
          updatedAt: now, lastActivityAt: now,
        };
        await persistProject(updatedProject);
        for (const v of data.versions.filter((v) => v.projectId === projectId)) {
          await persistVersion({ ...v, isWinner: v.id === versionId, updatedAt: now });
        }
        // Merge per-id so concurrent version writes are never clobbered.
        await mutate((prev) => ({
          ...prev,
          projects: prev.projects.map((p) => (p.id === projectId ? updatedProject : p)),
          versions: prev.versions.map((v) =>
            v.projectId === projectId ? { ...v, isWinner: v.id === versionId, updatedAt: now } : v),
        }));
        await logActivity({
          kind: 'winner_selected', projectId, projectVersionId: versionId,
          message: `Winner selected: ${winner?.versionName ?? versionId} for ${project.name}`,
        });
      },
      saveRepository: async (r: Repository) => {
        const next = touch(r);
        await service.saveRepository(next);
        await mutate((prev) => ({ ...prev, repositories: upsertIn(prev.repositories, next) }));
      },
      saveDeployment: async (d: Deployment) => {
        const next = touch(d);
        await service.saveDeployment(next);
        await mutate((prev) => ({ ...prev, deployments: upsertIn(prev.deployments, next) }));
      },
      saveTask: async (t: Task) => {
        const next = touch(t);
        await service.saveTask(next);
        await mutate((prev) => ({ ...prev, tasks: upsertIn(prev.tasks, next) }));
      },
      deleteTask: async (id: string) => {
        await service.deleteTask(id);
        await mutate((prev) => ({ ...prev, tasks: prev.tasks.filter((x) => x.id !== id) }));
      },
      completeTask: async (id: string) => {
        const task = data.tasks.find((t) => t.id === id);
        if (!task) return;
        const next: Task = {
          ...task, status: 'COMPLETED', completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await service.saveTask(next);
        await mutate((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? next : t)) }));
        await logActivity({ kind: 'task_completed', projectId: task.projectId, projectVersionId: task.projectVersionId, message: `Completed task "${task.title}"` });
      },
      saveReminder: async (r: Reminder) => {
        const next = touch(r);
        await mutate((prev) => ({ ...prev, reminders: upsertIn(prev.reminders, next) }));
      },
      deleteReminder: async (id: string) => {
        await mutate((prev) => ({ ...prev, reminders: prev.reminders.filter((x) => x.id !== id) }));
      },
      toggleReminder: async (id: string) => {
        const reminder = data.reminders.find((r) => r.id === id);
        if (!reminder) return;
        const next = touch({ ...reminder, done: !reminder.done });
        await mutate((prev) => ({
          ...prev,
          reminders: prev.reminders.map((r) => (r.id === id ? next : r)),
        }));
      },
      saveEvaluation: async (e: ModelEvaluation) => {
        const next = touch(e);
        await service.saveEvaluation(next);
        await mutate((prev) => ({ ...prev, evaluations: upsertIn(prev.evaluations, next) }));
      },
      deleteEvaluation: async (id: string) => {
        await service.deleteEvaluation(id);
        await mutate((prev) => ({ ...prev, evaluations: prev.evaluations.filter((x) => x.id !== id) }));
      },
      saveProfile: async (p: UserProfile) => {
        const next = touch(p);
        await service.saveProfile(next);
        await mutate((prev) => ({ ...prev, profile: next }));
      },
      saveReport: async (r: Report) => {
        await service.saveReport(r);
        await mutate((prev) => {
          // Upsert by id so 'Save and email now' can update the same row with
          // its delivery status instead of prepending a duplicate.
          const exists = prev.reports.some((x) => x.id === r.id);
          return {
            ...prev,
            reports: exists
              ? prev.reports.map((x) => (x.id === r.id ? r : x))
              : [r, ...prev.reports].slice(0, 60),
          };
        });
      },
      logActivity,
    };
  }, [data, loading, error, authMode, user, authSignOut, migrationDismissed]);

  if (!api) {
    // Signed out in Firebase mode → show the sign-in gate instead of the app.
    if (authMode === 'firebase' && !authInitializing && !user) {
      return <AuthGate />;
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-flour-50 dark:bg-pepper-900">
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-xl2 bg-gradient-spice text-white shadow-warm">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <p className="text-sm text-pepper-500 dark:text-pepper-300">
            {loading ? 'Loading command center…' : error ?? 'Preparing your data…'}
          </p>
          {error && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          )}
        </div>
      </div>
    );
  }

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
};

// ============================================================================
// Merge helpers
// ============================================================================

/** Overlay local scanner facts (uncommitted/unpushed, branch) onto the live
 *  GitHub feed. Shared with the server cron loader via lib/scannerOverlay.ts. */

export const useStore = (): StoreApi => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};
