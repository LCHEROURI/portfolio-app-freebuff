'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Pencil, Trash2, GitFork, Rocket, GitBranch, Scale, ListTodo,
  History, StickyNote, Trophy, Plus, AlertTriangle, ExternalLink, CheckCircle2,
  Printer, Sparkles, FileCode,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge, PriorityBadge, Badge, HealthBadge, ModelBadge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProjectModal } from '@/components/projects/ProjectModal';
import { EvaluationModal } from '@/components/versions/EvaluationModal';
import { VersionModal } from '@/components/versions/VersionModal';
import { TaskModal } from '@/components/tasks/TaskModal';
import { useStore } from '@/lib/store';
import { timeAgo, formatDate } from '@/lib/engine';
import { PROVIDER_LABELS, modelLabel } from '@/lib/labels';
import { buildRecommendationPrintDoc, recommendationPrintMeta, type PrintRecommendation } from '@/lib/printDoc';
import { downloadPrintHtml, usePrint } from '@/lib/usePrint';
import { type Task as TaskEntity, type ProjectVersion } from '@/types';

const TABS = [
  { id: 'overview', label: 'Overview', icon: StickyNote },
  { id: 'versions', label: 'Versions', icon: GitFork },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'deployments', label: 'Deployments', icon: Rocket },
  { id: 'evaluations', label: 'Model Evaluation', icon: Scale },
  { id: 'activity', label: 'Activity', icon: History },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const store = useStore();
  const [tab, setTab] = useState<TabId>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [versionModal, setVersionModal] = useState<null | { editing?: ProjectVersion }>(null);
  const [taskModal, setTaskModal] = useState<null | { editing?: TaskEntity }>(null);
  const [evalModal, setEvalModal] = useState<null | { versionId: string }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Shared print lifecycle for the saved AI winner recommendation card. The
  // builder lives in lib/printDoc.ts — the SAME document the Model Comparison
  // page prints — so the two surfaces can never drift.
  const { printTarget, printReport } = usePrint<PrintRecommendation>(buildRecommendationPrintDoc);

  const project = store.projects.find((p) => p.id === id);
  if (!project) {
    return (
      <div>
        <PageHeader title="Project not found" />
        <Link href="/projects" className="btn-secondary">← Back to Projects</Link>
      </div>
    );
  }

  const versions = store.versions.filter((v) => v.projectId === project.id && !v.isArchived);
  const allVersions = store.versions.filter((v) => v.projectId === project.id);
  const repos = store.repositories.filter((r) => versions.some((v) => v.id === r.projectVersionId));
  const deployments = store.deployments.filter((d) => versions.some((v) => v.id === d.projectVersionId));
  const tasks = store.tasks.filter((t) => t.projectId === project.id);
  const evaluations = store.evaluations.filter((e) => e.projectId === project.id);
  const activity = store.activity.filter((a) => a.projectId === project.id).slice(0, 20);
  const current = versions.find((v) => v.id === project.currentVersionId) ?? versions[0];
  const winner = allVersions.find((v) => v.id === project.winningVersionId || v.isWinner);

  // The print payload mirrors the saved recommendation on screen: the winning
  // version and the AI note. Read-only here — editing lives on Model Comparison.
  const buildPrintRecommendation = (): PrintRecommendation => ({
    projectName: project.name,
    recommendedVersionName: winner?.versionName ?? '…',
    note: project.winnerRecommendation ?? '',
    model: project.winnerRecommendationModel ?? '',
  });

  const handleDelete = async () => {
    await store.deleteProject(project.id);
    router.push('/projects');
  };

  return (
    <div>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-sm text-pepper-500 hover:text-tomato-600">
        <ArrowLeft size={15} aria-hidden="true" /> All projects
      </Link>

      <PageHeader
        title={project.name}
        description={project.description || project.category}
        action={
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={15} aria-hidden="true" /> Edit
            </button>
            <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={project.overallStatus} />
          <PriorityBadge priority={project.priority} />
          {project.category && <Badge>{project.category}</Badge>}
          {winner && <Badge tone="basil"><Trophy size={12} aria-hidden="true" /> Winner: {winner.versionName}</Badge>}
          {project.blocker && <Badge tone="paprika"><AlertTriangle size={12} aria-hidden="true" /> {project.blocker}</Badge>}
        </div>
      </PageHeader>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl2 border border-butter-200 bg-butter-50 p-1 scrollbar-thin dark:border-pepper-700 dark:bg-pepper-800" role="tablist" aria-label="Project sections">
        {TABS.map(({ id: t, label, icon: Icon }) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-tomato-500 text-white shadow-warm'
                : 'text-pepper-600 hover:bg-butter-100 dark:text-pepper-300 dark:hover:bg-pepper-700'
            }`}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader title="Overview" />
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {[
                  ['Business goal', project.businessGoal || '—'],
                  ['Target customer', project.targetCustomer || '—'],
                  ['Monetization', project.monetizationModel || '—'],
                  ['Category', project.category || '—'],
                  ['Next action', project.nextAction || '—'],
                  ['Next action due', formatDate(project.nextActionDueDate)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-pepper-400">{k}</dt>
                    <dd className="mt-0.5 text-sm text-pepper-700 dark:text-flour-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            {project.notes && (
              <Card>
                <CardHeader title="Notes" />
                <p className="whitespace-pre-wrap text-sm text-pepper-600 dark:text-pepper-200">{project.notes}</p>
              </Card>
            )}

            {project.winnerRecommendation && (
              <Card>
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Sparkles size={15} className="text-eggplant-500" aria-hidden="true" />
                      AI winner recommendation
                    </span>
                  }
                  action={
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        aria-label={`Print winner recommendation for ${project.name}`}
                        title="Print this recommendation"
                        onClick={() => printReport(buildPrintRecommendation())}
                      >
                        <Printer size={13} aria-hidden="true" /> Print
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        aria-label={`Save winner recommendation for ${project.name} as HTML`}
                        title="Save the standalone preview document as a shareable HTML file"
                        onClick={() => downloadPrintHtml(buildRecommendationPrintDoc(buildPrintRecommendation()))}
                      >
                        <FileCode size={13} aria-hidden="true" /> Save as HTML
                      </button>
                    </div>
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <ModelBadge model={project.winnerRecommendationModel} />
                  {winner && (
                    <Badge tone="basil"><Trophy size={12} aria-hidden="true" /> Recommended: {winner.versionName}</Badge>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-pepper-600 dark:text-pepper-200">{project.winnerRecommendation}</p>
              </Card>
            )}

            <Card>
              <CardHeader title="Versions at a glance" action={
                <button type="button" className="btn-ghost text-sm" onClick={() => setVersionModal({})}>
                  <Plus size={14} aria-hidden="true" /> Add version
                </button>
              } />
              {versions.length === 0 ? (
                <EmptyState icon={<GitFork size={28} aria-hidden="true" />} title="No versions yet" description="Add your first AI build (e.g. Gemini, Codex, Lovable…)." />
              ) : (
                <ul className="space-y-3">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl2 border border-butter-200 p-3 dark:border-pepper-700">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-semibold">
                          {v.versionName}
                          {v.id === project.winningVersionId && <Trophy size={14} className="text-turmeric-500" aria-hidden="true" />}
                          {v.id === project.currentVersionId && <Badge>current</Badge>}
                        </p>
                        <p className="text-xs text-pepper-400">{v.builder} · {v.model}{v.modelVersion ? ` (${v.modelVersion})` : ''}</p>
                      </div>
                      <div className="flex w-40 items-center gap-2">
                        <span className="w-8 text-right text-xs font-semibold">{v.progress}%</span>
                        <Progress value={v.progress} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Overall progress" />
              <Progress value={project.overallProgress} />
              <p className="mt-2 text-sm text-pepper-500 dark:text-pepper-300">Updated {timeAgo(project.updatedAt)}</p>
            </Card>
            <Card>
              <CardHeader title="Next action" />
              <p className="text-sm font-medium text-pepper-800 dark:text-flour-100">{project.nextAction || 'No next action defined.'}</p>
              {project.nextActionDueDate && (
                <p className="mt-1 text-xs text-pepper-400">Due {formatDate(project.nextActionDueDate)}</p>
              )}
            </Card>
            <Card>
              <CardHeader title="Current build" />
              {current ? (
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{current.versionName}</p>
                  <p className="text-pepper-500 dark:text-pepper-300">{current.builder} / {current.model}</p>
                  <p className="text-pepper-400">branch {current.branch} · {current.progress}%</p>
                </div>
              ) : (
                <p className="text-sm text-pepper-400">No current build set.</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* VERSIONS */}
      {tab === 'versions' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setVersionModal({})}>
              <Plus size={15} aria-hidden="true" /> Add version
            </button>
          </div>
          {allVersions.length === 0 ? (
            <EmptyState icon={<GitFork size={32} aria-hidden="true" />} title="No versions" />
          ) : (
            <div className="card-base overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-butter-200 text-xs uppercase tracking-wide text-pepper-400 dark:border-pepper-700">
                    <th className="px-4 py-3">Version</th>
                    <th className="px-2 py-3">Builder / Model</th>
                    <th className="px-2 py-3">Status</th>
                    <th className="px-2 py-3">Progress</th>
                    <th className="px-2 py-3">Cost</th>
                    <th className="px-2 py-3">Hours</th>
                    <th className="px-2 py-3">Winner</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allVersions.map((v) => (
                    <tr key={v.id} className="border-b border-butter-200 last:border-0 hover:bg-butter-100/60 dark:border-pepper-700 dark:hover:bg-pepper-700/50">
                      <td className="py-3 pl-4">
                        <p className="font-semibold">{v.versionName}</p>
                        <p className="text-xs text-pepper-400">{v.developmentPlatform}</p>
                      </td>
                      <td className="py-3 text-xs">{v.builder} · {v.model}</td>
                      <td className="py-3"><StatusBadge status={v.status} /></td>
                      <td className="py-3"><div className="w-24"><Progress value={v.progress} /></div></td>
                      <td className="py-3 text-xs">${v.actualCost}/{v.estimatedCost}</td>
                      <td className="py-3 text-xs">{v.developmentHours}h</td>
                      <td className="py-3">
                        {v.isWinner || project.winningVersionId === v.id ? (
                          <Trophy size={16} className="text-turmeric-500" aria-hidden="true" />
                        ) : (
                          <button
                            type="button"
                            className="text-xs text-pepper-400 underline-offset-2 hover:text-tomato-600 hover:underline"
                            onClick={() => store.selectWinner(project.id, v.id)}
                          >
                            Select
                          </button>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <button type="button" className="btn-ghost rounded-md p-1.5" aria-label={`Edit ${v.versionName}`} onClick={() => setVersionModal({ editing: v })}>
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="btn-ghost rounded-md p-1.5 text-paprika-500" aria-label={`Delete ${v.versionName}`} onClick={() => store.deleteVersion(v.id)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TASKS */}
      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setTaskModal({})}>
              <Plus size={15} aria-hidden="true" /> Add task
            </button>
          </div>
          {tasks.length === 0 ? (
            <EmptyState icon={<ListTodo size={32} aria-hidden="true" />} title="No tasks yet" />
          ) : (
            <div className="card-base overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-butter-200 text-xs uppercase tracking-wide text-pepper-400 dark:border-pepper-700">
                    <th className="px-4 py-3">Task</th>
                    <th className="px-2 py-3">Status</th>
                    <th className="px-2 py-3">Priority</th>
                    <th className="px-2 py-3">Due</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="border-b border-butter-200 last:border-0 hover:bg-butter-100/60 dark:border-pepper-700 dark:hover:bg-pepper-700/50">
                      <td className="py-3 pl-4">
                        <p className="font-medium">{t.title}</p>
                        {t.description && <p className="text-xs text-pepper-400">{t.description}</p>}
                      </td>
                      <td className="py-3"><StatusBadge status={t.status} /></td>
                      <td className="py-3"><PriorityBadge priority={t.priority} /></td>
                      <td className="py-3 text-xs">{formatDate(t.dueDate)}</td>
                      <td className="py-3 pr-4 text-right">
                        {t.status !== 'COMPLETED' ? (
                          <button type="button" className="btn-ghost rounded-md p-1.5 text-basil-600 dark:text-basil-400" aria-label={`Complete ${t.title}`} onClick={() => store.completeTask(t.id)}>
                            <CheckCircle2 size={15} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button type="button" className="btn-ghost rounded-md p-1.5" aria-label={`Edit ${t.title}`} onClick={() => setTaskModal({ editing: t })}>
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button type="button" className="btn-ghost rounded-md p-1.5 text-paprika-500" aria-label={`Delete ${t.title}`} onClick={() => store.deleteTask(t.id)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* REPOSITORIES */}
      {tab === 'repositories' && (
        <div className="space-y-4">
          {repos.length === 0 ? (
            <EmptyState icon={<GitBranch size={32} aria-hidden="true" />} title="No repositories connected" description="Link a repo to a version to start tracking commits and pushes." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {repos.map((r) => (
                <Card key={r.id}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{r.owner}/{r.repositoryName}</p>
                      <p className="text-xs text-pepper-400">{PROVIDER_LABELS[r.provider]} · {r.currentBranch}</p>
                    </div>
                    <Badge tone={r.connectionStatus === 'CONNECTED' ? 'basil' : r.connectionStatus === 'AUTH_ERROR' ? 'paprika' : 'turmeric'}>
                      {r.connectionStatus.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                      <span className="text-pepper-400">Commits ahead</span>
                      <p className="font-semibold">{r.commitsAhead}</p>
                    </div>
                    <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                      <span className="text-pepper-400">PRs / Issues</span>
                      <p className="font-semibold">{r.openPullRequests} / {r.openIssues}</p>
                    </div>
                    <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                      <span className="text-pepper-400">Uncommitted</span>
                      <p className="font-semibold">{r.hasUncommittedChanges ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="rounded-lg bg-butter-100 p-2 dark:bg-pepper-700">
                      <span className="text-pepper-400">Unpushed</span>
                      <p className="font-semibold">{r.hasUnpushedCommits ? 'Yes' : 'No'}</p>
                    </div>
                  </div>
                  <a href={r.repositoryUrl} target="_blank" rel="noreferrer" className="btn-ghost mt-3 text-sm">
                    Open repo <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DEPLOYMENTS */}
      {tab === 'deployments' && (
        <div className="space-y-4">
          {deployments.length === 0 ? (
            <EmptyState icon={<Rocket size={32} aria-hidden="true" />} title="No deployments yet" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {deployments.map((d) => (
                <Card key={d.id}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{d.projectName}</p>
                      <p className="text-xs text-pepper-400">{PROVIDER_LABELS[d.provider]} · {d.environment}</p>
                    </div>
                    <HealthBadge health={d.healthStatus} />
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <Badge tone={d.status === 'READY' ? 'basil' : d.status === 'ERROR' ? 'paprika' : 'turmeric'}>{d.status}</Badge>
                    {d.responseCode && <span className="text-pepper-400">{d.responseCode} · {d.responseTimeMs}ms</span>}
                  </div>
                  {d.lastFailureMessage && (
                    <p className="mt-2 rounded-lg bg-paprika-50 px-2 py-1.5 text-xs text-paprika-700 dark:bg-paprika-950 dark:text-paprika-300">{d.lastFailureMessage}</p>
                  )}
                  <a href={d.deploymentUrl} target="_blank" rel="noreferrer" className="btn-ghost mt-3 text-sm">
                    Open deployment <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* EVALUATIONS */}
      {tab === 'evaluations' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary"
              disabled={versions.length === 0}
              onClick={() => setEvalModal({ versionId: versions[0]?.id ?? '' })}
            >
              <Plus size={15} aria-hidden="true" /> Add evaluation
            </button>
          </div>
          {evaluations.length === 0 ? (
            <EmptyState icon={<Scale size={32} aria-hidden="true" />} title="No evaluations yet" description="Score each version's UI, features, code quality, stability and more." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {evaluations.map((e) => (
                <Card key={e.id}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{e.model}</p>
                      <p className="text-xs text-pepper-400">{e.builder}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-basil-600 dark:text-basil-300">{e.overallScore}</p>
                      <p className="text-[10px] uppercase tracking-wide text-pepper-400">/10 overall</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {([
                      ['UI', e.uiScore], ['Features', e.featureScore], ['Code quality', e.codeQualityScore],
                      ['Stability', e.stabilityScore], ['Performance', e.performanceScore],
                      ['Maintainability', e.maintainabilityScore], ['Speed', e.developmentSpeedScore],
                      ['Cost', e.costScore], ['Mobile', e.mobileScore], ['A11y', e.accessibilityScore],
                    ] as const).map(([label, score]) => (
                      <div key={label} className="flex justify-between border-b border-butter-100 py-1 dark:border-pepper-700">
                        <span className="text-pepper-400">{label}</span>
                        <span className="font-medium">{score}</span>
                      </div>
                    ))}
                  </div>
                  {e.evaluatorNotes && <p className="mt-2 text-xs italic text-pepper-500 dark:text-pepper-300">{e.evaluatorNotes}</p>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ACTIVITY */}
      {tab === 'activity' && (
        <div className="space-y-2">
          {activity.length === 0 ? (
            <EmptyState icon={<History size={32} aria-hidden="true" />} title="No activity yet" />
          ) : (
            activity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-xl2 border border-butter-200 bg-butter-50 p-3 text-sm dark:border-pepper-700 dark:bg-pepper-800">
                <History size={15} className="mt-0.5 shrink-0 text-pepper-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-pepper-700 dark:text-flour-100">{a.message}</p>
                  <p className="text-xs text-pepper-400">{timeAgo(a.createdAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ProjectModal open={editOpen} onClose={() => setEditOpen(false)} editing={project} />
      <VersionModal open={versionModal !== null} onClose={() => setVersionModal(null)} editing={versionModal?.editing} projectId={project.id} />
      <TaskModal open={taskModal !== null} onClose={() => setTaskModal(null)} editing={taskModal?.editing} projectId={project.id} />
      <EvaluationModal open={evalModal !== null} onClose={() => setEvalModal(null)} projectId={project.id} versionId={evalModal?.versionId ?? ''} />

      {/* Print-only area — visible ONLY in the print dialog (@media print in
          globals.css hides everything else and anchors this to the top of the
          page). Rendered only while a recommendation is being printed, so it
          never lingers in the on-screen DOM. */}
      {printTarget && (
        <div className="print-report" data-testid="print-report" aria-hidden="true">
          <h2 className="print-report-title">{printTarget.projectName} — AI winner recommendation</h2>
          <p className="print-report-meta">
            {/* Same shared builder as the preview document — never inline a copy. */}
            {recommendationPrintMeta(printTarget.recommendedVersionName)}
          </p>
          {printTarget.note && (
            <div className="print-report-summary">
              <strong>AI winner recommendation</strong>
              {/* Friendly label, not the raw model id — matches the on-screen badge. */}
              <span> ({modelLabel(printTarget.model)})</span>
              <p>{printTarget.note}</p>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-pepper-900/60 p-4 backdrop-blur-xs" onClick={() => setConfirmDelete(false)}>
          <div className="w-full max-w-md rounded-xl2 bg-white p-6 shadow-plate dark:border dark:border-pepper-700 dark:bg-pepper-800" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Delete project?</h2>
            <p className="mt-2 text-sm text-pepper-500 dark:text-pepper-300">
              This removes <strong>{project.name}</strong> and all its versions, tasks, and evaluations. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button type="button" className="btn-danger" onClick={handleDelete}>Delete project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
