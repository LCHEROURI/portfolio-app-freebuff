'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, List, Plus, FolderKanban, Search } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select, Input } from '@/components/ui/Field';
import { ProjectCard, ProjectTableRow } from '@/components/projects/ProjectCard';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { useStore } from '@/lib/store';
import {
  PRIORITY_LEVELS, PROJECT_STATUSES,
  type PriorityLevel, type ProjectStatus,
} from '@/types';

type ViewMode = 'grid' | 'table';

export default function ProjectsPage() {
  const store = useStore();
  const [view, setView] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | ProjectStatus>('ALL');
  const [priority, setPriority] = useState<'ALL' | PriorityLevel>('ALL');
  const [builder, setBuilder] = useState<'ALL' | string>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const builders = useMemo(
    () => Array.from(new Set(store.versions.map((v) => v.builder))).sort(),
    [store.versions],
  );

  const filtered = useMemo(() => {
    return store.projects
      .filter((p) => {
        if (query && !`${p.name} ${p.description} ${p.category} ${p.businessGoal}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (status !== 'ALL' && p.overallStatus !== status) return false;
        if (priority !== 'ALL' && p.priority !== priority) return false;
        if (builder !== 'ALL') {
          const hasBuilder = store.versions.some((v) => v.projectId === p.id && v.builder === builder);
          if (!hasBuilder) return false;
        }
        return true;
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [store.projects, store.versions, query, status, priority, builder]);

  const editing = editingId ? store.projects.find((p) => p.id === editingId) ?? null : null;

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Every app concept you're building across AI models and platforms."
        action={
          <button type="button" className="btn-primary" onClick={() => { setEditingId(null); setModalOpen(true); }}>
            <Plus size={16} aria-hidden="true" /> New Project
          </button>
        }
      />

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-pepper-400" aria-hidden="true" />
          <Input className="pl-9" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as 'ALL' | ProjectStatus)} aria-label="Filter by status">
          <option value="ALL">All statuses</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select className="w-auto" value={priority} onChange={(e) => setPriority(e.target.value as 'ALL' | PriorityLevel)} aria-label="Filter by priority">
          <option value="ALL">All priorities</option>
          {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
        </Select>
        <Select className="w-auto" value={builder} onChange={(e) => setBuilder(e.target.value)} aria-label="Filter by builder">
          <option value="ALL">All builders</option>
          {builders.map((b) => <option key={b} value={b}>{b}</option>)}
        </Select>
        <div className="ml-auto flex rounded-lg border border-butter-200 bg-butter-50 p-1 dark:border-pepper-700 dark:bg-pepper-800">
          <button
            type="button"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${view === 'grid' ? 'bg-tomato-500 text-white' : 'text-pepper-500 hover:bg-butter-100 dark:hover:bg-pepper-700'}`}
          >
            <LayoutGrid size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Table view"
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${view === 'table' ? 'bg-tomato-500 text-white' : 'text-pepper-500 hover:bg-butter-100 dark:hover:bg-pepper-700'}`}
          >
            <List size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={32} aria-hidden="true" />}
          title="No projects match"
          description="Adjust your filters, or create your first project to start tracking AI-built versions."
          action={<button type="button" className="btn-primary" onClick={() => { setEditingId(null); setModalOpen(true); }}><Plus size={16} aria-hidden="true" /> New Project</button>}
        />
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              versions={store.versions}
              deployments={store.deployments}
              onEdit={() => { setEditingId(p.id); setModalOpen(true); }}
            />
          ))}
        </div>
      ) : (
        <div className="card-base overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-butter-200 text-xs uppercase tracking-wide text-pepper-400 dark:border-pepper-700">
                <th className="px-4 py-3">Project</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-2 py-3">Priority</th>
                <th className="px-2 py-3">Progress</th>
                <th className="px-2 py-3">Builds</th>
                <th className="px-4 py-3 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <ProjectTableRow
                  key={p.id}
                  project={p}
                  versions={store.versions}
                  deployments={store.deployments}
                  onEdit={() => { setEditingId(p.id); setModalOpen(true); }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProjectModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  );
}
