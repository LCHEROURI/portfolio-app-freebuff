import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where,
  limit, orderBy, serverTimestamp, type Firestore, type DocumentData,
} from 'firebase/firestore';

import { getFirestoreDb, isFirebaseConfigured, getUserId } from '@/lib/firebase';
import { buildSeed, type SeedBundle } from '@/lib/seed';
import {
  type UserProfile, type Project, type ProjectVersion, type Repository,
  type Deployment, type Task, type ModelEvaluation, type ActivityEntry, type Report,
} from '@/types';

// ============================================================================
// COLLECTIONS
// ============================================================================

const COLLECTIONS = {
  profiles: 'profiles',
  projects: 'projects',
  versions: 'project_versions',
  repositories: 'repositories',
  deployments: 'deployments',
  tasks: 'tasks',
  evaluations: 'model_evaluations',
  activity: 'activity',
  reports: 'reports',
} as const;

type CollectionName = keyof typeof COLLECTIONS;
type DocShape =
  | UserProfile | Project | ProjectVersion | Repository | Deployment
  | Task | ModelEvaluation | ActivityEntry | Report;

const col = (db: Firestore, name: CollectionName) => collection(db, COLLECTIONS[name]);

// ============================================================================
// USER ISOLATION
// ============================================================================
// Every query is scoped by `userId` so one signed-in user can never read or
// write another user's rows. Server-side Firestore rules enforce the same
// invariant (see firestore.rules in the sibling repo).

const byUser = (db: Firestore, name: CollectionName, userId: string) =>
  query(col(db, name), where('userId', '==', userId));

const serialize = <T extends DocShape>(data: T): DocumentData => {
  const rest = { ...data } as Record<string, unknown>;
  delete rest.id;
  return rest;
};

const deserialize = <T extends DocShape>(id: string, data: DocumentData): T =>
  ({ id, ...data } as T);

// ============================================================================
// GENERIC CRUD
// ============================================================================

const listAll = async <T extends DocShape>(db: Firestore, name: CollectionName, userId: string): Promise<T[]> => {
  const snap = await getDocs(byUser(db, name, userId));
  return snap.docs.map((d) => deserialize<T>(d.id, d.data()));
};

const getById = async <T extends DocShape>(db: Firestore, name: CollectionName, docId: string): Promise<T | null> => {
  const snap = await getDoc(doc(db, COLLECTIONS[name], docId));
  return snap.exists() ? deserialize<T>(snap.id, snap.data()) : null;
};

// ─── Bounded feed reads (read-budget guard) ─────────────────────────────────
// Firestore bills per document READ, and the store/UI never keep more than
// their in-memory caps: logActivity keeps activity at 200 entries (the
// Activity page renders 100) and saveReport keeps reports at 60. Reading the
// full collections was unbounded — the owner's activity collection alone held
// ~1.1k docs, so every page load charged ~5x the rows the UI can ever show,
// and the verify suite's owner-session page loads multiplied that across
// gates. These two bounded reads cap the billed reads at exactly the limits
// the in-memory store already enforces (no display regression possible).
//
// Activity is ordered by document id DESC: ids are `a-<base36-ms><rand>`
// (timestamp-prefixed, see uid() in lib/store.tsx), so descending id order
// returns newest-first — and an equality filter + document-id ordering is
// served by the DEFAULT index, so NO composite index is needed (createdAt
// would need one, and these docs store it as a string, not a Timestamp).
// The SDK maps the '__name__' field string to the document id (the static
// FieldPath.documentId() helper is absent from this SDK's types). This also
// fixes a latent quirk: the old unbounded natural order returned the OLDEST
// entries first.
//
// Reports keep NO orderBy: ids mix `r-<ts>` (in-app) and `r-seed-<kind>-<date>`
// (seeder), so document-id order is not reliably newest-first; a plain limit
// preserves today's exact display order while capping the read cost.
const ACTIVITY_READ_LIMIT = 200;
const REPORTS_READ_LIMIT = 60;

const listActivity = async (db: Firestore, userId: string): Promise<ActivityEntry[]> => {
  const snap = await getDocs(query(
    col(db, 'activity'),
    where('userId', '==', userId),
    orderBy('__name__', 'desc'),
    limit(ACTIVITY_READ_LIMIT),
  ));
  return snap.docs.map((d) => deserialize<ActivityEntry>(d.id, d.data()));
};

const listReports = async (db: Firestore, userId: string): Promise<Report[]> => {
  const snap = await getDocs(query(
    col(db, 'reports'),
    where('userId', '==', userId),
    limit(REPORTS_READ_LIMIT),
  ));
  return snap.docs.map((d) => deserialize<Report>(d.id, d.data()));
};

const upsert = async <T extends DocShape>(db: Firestore, name: CollectionName, data: T): Promise<T> => {
  const ref = doc(db, COLLECTIONS[name], data.id);
  await setDoc(ref, { ...serialize(data), updatedAt: serverTimestamp() }, { merge: true });
  return data;
};

const remove = async (db: Firestore, name: CollectionName, id: string): Promise<void> => {
  await deleteDoc(doc(db, COLLECTIONS[name], id));
};

// ============================================================================
// PUBLIC API
// ============================================================================

export interface DataService {
  mode: 'firestore' | 'demo';
  loadAll: (userId: string) => Promise<SeedBundle & { reports: Report[] }>;
  saveProject: (p: Project) => Promise<void>;
  saveVersion: (v: ProjectVersion) => Promise<void>;
  saveRepository: (r: Repository) => Promise<void>;
  saveDeployment: (d: Deployment) => Promise<void>;
  saveTask: (t: Task) => Promise<void>;
  saveEvaluation: (e: ModelEvaluation) => Promise<void>;
  saveProfile: (p: UserProfile) => Promise<void>;
  saveActivity: (a: ActivityEntry) => Promise<void>;
  saveReport: (r: Report) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  deleteEvaluation: (id: string) => Promise<void>;
}

// ── Firestore-backed implementation ──────────────────────────────────────────

class FirestoreService implements DataService {
  readonly mode = 'firestore' as const;

  private async db(): Promise<Firestore> {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore is not configured.');
    return db;
  }

  async loadAll(userId: string) {
    const db = await this.db();
    const [profile, projects, versions, repositories, deployments, tasks, evaluations, activity, reports] =
      await Promise.all([
        this.getProfile(db, userId),
        listAll<Project>(db, 'projects', userId),
        listAll<ProjectVersion>(db, 'versions', userId),
        listAll<Repository>(db, 'repositories', userId),
        listAll<Deployment>(db, 'deployments', userId),
        listAll<Task>(db, 'tasks', userId),
        listAll<ModelEvaluation>(db, 'evaluations', userId),
        listActivity(db, userId),
        listReports(db, userId),
      ]);
    return {
      profile: profile ?? this.defaultProfile(userId),
      projects, versions, repositories, deployments, tasks, evaluations, activity, reports,
    };
  }

  private async getProfile(db: Firestore, userId: string): Promise<UserProfile | null> {
    return getById<UserProfile>(db, 'profiles', userId);
  }

  private defaultProfile(userId: string): UserProfile {
    const now = new Date().toISOString();
    return {
      id: userId, name: 'Command Center User', timezone: 'America/Los_Angeles',
      dailyReportEnabled: true, dailyReportTime: '08:00',
      weeklyReportEnabled: true, weeklyReportDay: 1, weeklyReportTime: '09:00',
      defaultStaleDays: 7, createdAt: now, updatedAt: now,
    };
  }

  async saveProfile(p: UserProfile) { await upsert(await this.db(), 'profiles', p); }
  async saveProject(p: Project) { await upsert(await this.db(), 'projects', p); }
  async saveVersion(v: ProjectVersion) { await upsert(await this.db(), 'versions', v); }
  async saveRepository(r: Repository) { await upsert(await this.db(), 'repositories', r); }
  async saveDeployment(d: Deployment) { await upsert(await this.db(), 'deployments', d); }
  async saveTask(t: Task) { await upsert(await this.db(), 'tasks', t); }
  async saveEvaluation(e: ModelEvaluation) { await upsert(await this.db(), 'evaluations', e); }
  async saveActivity(a: ActivityEntry) { await upsert(await this.db(), 'activity', a); }
  async saveReport(r: Report) { await upsert(await this.db(), 'reports', r); }
  async deleteProject(id: string) { await remove(await this.db(), 'projects', id); }
  async deleteVersion(id: string) { await remove(await this.db(), 'versions', id); }
  async deleteTask(id: string) { await remove(await this.db(), 'tasks', id); }
  async deleteEvaluation(id: string) { await remove(await this.db(), 'evaluations', id); }
}

// ── Demo (localStorage) implementation ───────────────────────────────────────

export const DEMO_STORAGE_KEY = 'apcc-demo-store-v1';

/**
 * Read the demo (localStorage) store directly. Used by the Phase 3 migration
 * path to import existing local data into a real Firestore account.
 */
export const readLocalDemoData = (): (SeedBundle & { reports: Report[] }) | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeedBundle & { reports?: Report[] };
    return { ...parsed, reports: parsed.reports ?? [] };
  } catch {
    return null;
  }
};

/**
 * Migration path (Phase 3): copy the current localStorage demo data into a
 * real Firestore account, re-keyed to the signed-in user. Returns the number
 * of documents written, or 0 when there is no local data to migrate.
 */
export const migrateLocalDemoToFirestore = async (userId: string): Promise<number> => {
  const local = readLocalDemoData();
  if (!local) return 0;
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore is not configured.');
  const service = new FirestoreService();

  const now = new Date().toISOString();
  // Namespace every migrated document id with a short uid so the same browser's
  // demo data can be imported into multiple accounts without colliding, and so
  // Firestore rules (userId == auth.uid) can never block a second import.
  const shortUid = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'u';
  const idMap = new Map<string, string>();
  const register = (prefix: string, oldId?: string) => {
    if (!oldId || idMap.has(oldId)) return;
    idMap.set(oldId, `${prefix}-${shortUid}-${oldId}`);
  };
  for (const p of local.projects) register('p', p.id);
  for (const v of local.versions) register('v', v.id);
  for (const r of local.repositories) register('r', r.id);
  for (const d of local.deployments) register('d', d.id);
  for (const t of local.tasks) register('t', t.id);
  for (const e of local.evaluations) register('e', e.id);
  for (const a of local.activity) register('a', a.id);
  for (const r of local.reports) register('rp', r.id);
  // Resolve a foreign key to its namespaced id (falls back to the original).
  const ref = (oldId?: string): string | undefined => (oldId && idMap.get(oldId)) || oldId;
  const refReq = (oldId: string): string => ref(oldId) ?? oldId;

  let count = 0;
  const profile = { ...local.profile, id: userId, userId, updatedAt: now };
  await service.saveProfile(profile);
  count += 1;

  for (const p of local.projects) {
    await service.saveProject({
      ...p, id: idMap.get(p.id)!, userId,
      currentVersionId: ref(p.currentVersionId),
      winningVersionId: ref(p.winningVersionId),
    });
    count += 1;
  }
  for (const v of local.versions) {
    await service.saveVersion({
      ...v, id: idMap.get(v.id)!, userId,
      projectId: refReq(v.projectId),
      repositoryId: ref(v.repositoryId),
      deploymentIds: (v.deploymentIds ?? []).map((d) => refReq(d)),
      primaryDeploymentId: ref(v.primaryDeploymentId),
    });
    count += 1;
  }
  for (const r of local.repositories) {
    await service.saveRepository({
      ...r, id: idMap.get(r.id)!, userId,
      projectVersionId: ref(r.projectVersionId),
    });
    count += 1;
  }
  for (const d of local.deployments) {
    await service.saveDeployment({
      ...d, id: idMap.get(d.id)!, userId,
      projectVersionId: ref(d.projectVersionId),
    });
    count += 1;
  }
  for (const t of local.tasks) {
    await service.saveTask({
      ...t, id: idMap.get(t.id)!, userId,
      projectId: refReq(t.projectId),
      projectVersionId: ref(t.projectVersionId),
    });
    count += 1;
  }
  for (const e of local.evaluations) {
    await service.saveEvaluation({
      ...e, id: idMap.get(e.id)!, userId,
      projectId: refReq(e.projectId),
      projectVersionId: refReq(e.projectVersionId),
    });
    count += 1;
  }
  for (const a of local.activity) {
    await service.saveActivity({
      ...a, id: idMap.get(a.id)!, userId,
      projectId: ref(a.projectId),
      projectVersionId: ref(a.projectVersionId),
    });
    count += 1;
  }
  for (const r of local.reports) {
    await service.saveReport({ ...r, id: idMap.get(r.id)!, userId });
    count += 1;
  }
  return count;
};

class DemoService implements DataService {
  readonly mode = 'demo' as const;

  private read(): SeedBundle & { reports: Report[] } {
    if (typeof window === 'undefined') {
      return { ...buildSeed(), reports: [] };
    }
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SeedBundle & { reports?: Report[] };
        return { ...parsed, reports: parsed.reports ?? [] };
      }
    } catch {
      // Corrupt store → reseed.
    }
    const seeded = { ...buildSeed(), reports: [] as Report[] };
    this.write(seeded);
    return seeded;
  }

  private write(data: SeedBundle & { reports: Report[] }) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Quota exceeded in private mode → keep in-memory only.
    }
  }

  async loadAll(userId: string) {
    const data = this.read();
    const now = new Date().toISOString();
    const profile: UserProfile = data.profile.id === userId
      ? data.profile
      : { ...data.profile, id: userId, updatedAt: now };
    return { ...data, profile };
  }

  async saveProfile(p: UserProfile) { const d = this.read(); this.write({ ...d, profile: p }); }
  async saveProject(p: Project) { const d = this.read(); this.write({ ...d, projects: d.projects.map((x) => (x.id === p.id ? p : x)).concat(d.projects.some((x) => x.id === p.id) ? [] : [p]) }); }
  async saveVersion(v: ProjectVersion) { const d = this.read(); this.write({ ...d, versions: this.merge(d.versions, v) }); }
  async saveRepository(r: Repository) { const d = this.read(); this.write({ ...d, repositories: this.merge(d.repositories, r) }); }
  async saveDeployment(dep: Deployment) { const d = this.read(); this.write({ ...d, deployments: this.merge(d.deployments, dep) }); }
  async saveTask(t: Task) { const d = this.read(); this.write({ ...d, tasks: this.merge(d.tasks, t) }); }
  async saveEvaluation(e: ModelEvaluation) { const d = this.read(); this.write({ ...d, evaluations: this.merge(d.evaluations, e) }); }
  async saveActivity(a: ActivityEntry) { const d = this.read(); this.write({ ...d, activity: [a, ...d.activity].slice(0, 200) }); }
  async saveReport(r: Report) {
    const d = this.read();
    const exists = d.reports.some((x) => x.id === r.id);
    this.write({
      ...d,
      reports: exists
        ? d.reports.map((x) => (x.id === r.id ? r : x))
        : [r, ...d.reports].slice(0, 60),
    });
  }
  async deleteProject(id: string) {
    const d = this.read();
    this.write({
      ...d,
      projects: d.projects.filter((x) => x.id !== id),
      versions: d.versions.filter((x) => x.projectId !== id),
      tasks: d.tasks.filter((x) => x.projectId !== id),
      evaluations: d.evaluations.filter((x) => x.projectId !== id),
    });
  }
  async deleteVersion(id: string) {
    const d = this.read();
    this.write({
      ...d,
      versions: d.versions.filter((x) => x.id !== id),
      tasks: d.tasks.filter((x) => x.projectVersionId !== id),
      evaluations: d.evaluations.filter((x) => x.projectVersionId !== id),
    });
  }
  async deleteTask(id: string) { const d = this.read(); this.write({ ...d, tasks: d.tasks.filter((x) => x.id !== id) }); }
  async deleteEvaluation(id: string) { const d = this.read(); this.write({ ...d, evaluations: d.evaluations.filter((x) => x.id !== id) }); }

  private merge<T extends { id: string }>(list: T[], item: T): T[] {
    const exists = list.some((x) => x.id === item.id);
    return exists ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
  }

  resetDemo() {
    const seeded = { ...buildSeed(), reports: [] as Report[] };
    this.write(seeded);
    return seeded;
  }
}

// ============================================================================

export const createDataService = async (): Promise<DataService> => {
  const configured = isFirebaseConfigured();
  if (configured) {
    try {
      await getUserId(); // ensure auth is bootstrapped before reads
      return new FirestoreService();
    } catch {
      // Fall through to demo on any auth/bootstrap failure.
    }
  }
  return new DemoService();
};

export { FirestoreService, DemoService };
