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
  type UserProfile, type Project, type ProjectVersion, type Repository,
  type Deployment, type Task, type ModelEvaluation, type ActivityEntry, type Report,
} from '@/types';

export interface CommandCenterData {
  mode: 'firestore' | 'demo';
  profile: UserProfile;
  projects: Project[];
  versions: ProjectVersion[];
  repositories: Repository[];
  deployments: Deployment[];
  tasks: Task[];
  evaluations: ModelEvaluation[];
  activity: ActivityEntry[];
  reports: Report[];
  userId: string;
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
        setData({ mode: service.mode, userId, ...all });
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

    return {
      ...data,
      loading,
      error,
      signOut: async () => {
        await authSignOut();
        setData(null);
      },
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
        setData({ mode: 'firestore', userId: user.uid, ...all });
        return count;
      },
      resetDemo: async () => {
        if (service.mode === 'demo') {
          const d = service as unknown as { resetDemo(): CommandCenterData };
          const seeded = d.resetDemo();
          setData({ ...data, ...seeded });
        }
      },
      saveProject: async (p: Project) => {
        const next = touch(p);
        await service.saveProject(next);
        await mutate((prev) => ({ ...prev, projects: prev.projects.some((x) => x.id === next.id) ? prev.projects.map((x) => (x.id === next.id ? next : x)) : [...prev.projects, next] }));
        await logActivity({ kind: 'project_updated', projectId: next.id, message: `Project "${next.name}" updated` });
      },
      deleteProject: async (id: string) => {
        await service.deleteProject(id);
        await mutate((prev) => ({
          ...prev,
          projects: prev.projects.filter((x) => x.id !== id),
          versions: prev.versions.filter((x) => x.projectId !== id),
          tasks: prev.tasks.filter((x) => x.projectId !== id),
          evaluations: prev.evaluations.filter((x) => x.projectId !== id),
        }));
      },
      saveVersion: async (v: ProjectVersion) => {
        const next = touch(v);
        await service.saveVersion(next);
        await mutate((prev) => ({ ...prev, versions: prev.versions.some((x) => x.id === next.id) ? prev.versions.map((x) => (x.id === next.id ? next : x)) : [...prev.versions, next] }));
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
        await service.saveProject(updatedProject);
        for (const v of data.versions.filter((v) => v.projectId === projectId)) {
          await service.saveVersion({ ...v, isWinner: v.id === versionId, updatedAt: now });
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
        await mutate((prev) => ({ ...prev, repositories: prev.repositories.some((x) => x.id === next.id) ? prev.repositories.map((x) => (x.id === next.id ? next : x)) : [...prev.repositories, next] }));
      },
      saveDeployment: async (d: Deployment) => {
        const next = touch(d);
        await service.saveDeployment(next);
        await mutate((prev) => ({ ...prev, deployments: prev.deployments.some((x) => x.id === next.id) ? prev.deployments.map((x) => (x.id === next.id ? next : x)) : [...prev.deployments, next] }));
      },
      saveTask: async (t: Task) => {
        const next = touch(t);
        await service.saveTask(next);
        await mutate((prev) => ({ ...prev, tasks: prev.tasks.some((x) => x.id === next.id) ? prev.tasks.map((x) => (x.id === next.id ? next : x)) : [...prev.tasks, next] }));
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
      saveEvaluation: async (e: ModelEvaluation) => {
        const next = touch(e);
        await service.saveEvaluation(next);
        await mutate((prev) => ({ ...prev, evaluations: prev.evaluations.some((x) => x.id === next.id) ? prev.evaluations.map((x) => (x.id === next.id ? next : x)) : [...prev.evaluations, next] }));
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
        await mutate((prev) => ({ ...prev, reports: [r, ...prev.reports].slice(0, 60) }));
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

export const useStore = (): StoreApi => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};
