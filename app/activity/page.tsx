'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { timeAgo } from '@/lib/engine';

const KIND_LABELS: Record<string, string> = {
  project_created: 'Project', project_updated: 'Project', version_created: 'Version',
  version_updated: 'Version', winner_selected: 'Winner', deployment_created: 'Deployment',
  deployment_updated: 'Deployment', task_created: 'Task', task_completed: 'Task',
  task_updated: 'Task', repository_created: 'Repository', repository_scanned: 'Scanner',
  evaluation_created: 'Evaluation', evaluation_updated: 'Evaluation', report_generated: 'Report',
  alert_triggered: 'Alert', scan_ingested: 'Scanner',
};

const KIND_TONES: Record<string, string> = {
  alert_triggered: 'bg-paprika-100 text-paprika-700 dark:bg-paprika-900/60 dark:text-paprika-200',
  winner_selected: 'bg-basil-100 text-basil-700 dark:bg-basil-900/60 dark:text-basil-200',
  repository_scanned: 'bg-eggplant-100 text-eggplant-700 dark:bg-eggplant-900/60 dark:text-eggplant-200',
  scan_ingested: 'bg-eggplant-100 text-eggplant-700 dark:bg-eggplant-900/60 dark:text-eggplant-200',
  report_generated: 'bg-turmeric-100 text-turmeric-700 dark:bg-turmeric-900/60 dark:text-turmeric-200',
  task_completed: 'bg-basil-100 text-basil-700 dark:bg-basil-900/60 dark:text-basil-200',
  deployment_updated: 'bg-tomato-100 text-tomato-700 dark:bg-tomato-900/60 dark:text-tomato-200',
  deployment_created: 'bg-tomato-100 text-tomato-700 dark:bg-tomato-900/60 dark:text-tomato-200',
};

export default function ActivityPage() {
  const store = useStore();
  const [filter, setFilter] = useState<'ALL' | string>('ALL');

  const kinds = Array.from(new Set(store.activity.map((a) => KIND_LABELS[a.kind] ?? a.kind))).sort();
  const entries = store.activity
    .filter((a) => filter === 'ALL' || (KIND_LABELS[a.kind] ?? a.kind) === filter)
    .slice(0, 100);

  return (
    <div>
      <PageHeader
        title="Activity"
        description="Every meaningful event across projects, versions, deployments, and scans."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button type="button" className={filter === 'ALL' ? 'chip chip-active' : 'chip'} onClick={() => setFilter('ALL')}>All</button>
        {kinds.map((k) => (
          <button key={k} type="button" className={filter === k ? 'chip chip-active' : 'chip'} onClick={() => setFilter(k)}>{k}</button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={<History size={32} aria-hidden="true" />} title="No activity yet" />
      ) : (
        <div className="space-y-2">
          {entries.map((a) => {
            const label = KIND_LABELS[a.kind] ?? a.kind;
            return (
              <Card key={a.id} className="flex items-start gap-3 p-4">
                <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_TONES[a.kind] ?? 'bg-butter-100 text-pepper-500 dark:bg-pepper-700 dark:text-pepper-300'}`}>
                  {label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-pepper-700 dark:text-flour-100">{a.message}</p>
                  {a.projectId && (
                    <Link href={`/projects/${a.projectId}`} className="text-xs text-pepper-400 hover:text-tomato-600">
                      View project →
                    </Link>
                  )}
                </div>
                <span className="shrink-0 text-xs text-pepper-400">{timeAgo(a.createdAt)}</span>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
