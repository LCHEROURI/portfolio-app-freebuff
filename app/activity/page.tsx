'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History, MailWarning } from 'lucide-react';

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
  const [filter, setFilter] = useState('ALL');

  // When the Firestore activity feed isn't live (service account missing or
  // the user is in local demo mode), the feed is local-only. Surface that
  // instead of silently showing demo/partial activity.
  const liveActivityOff = !store.activityLive;

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

      {liveActivityOff && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-turmeric-300 bg-turmeric-50 px-3 py-2 text-xs text-turmeric-800 dark:border-turmeric-800 dark:bg-turmeric-900/40 dark:text-turmeric-200" role="status">
          <span className="inline-flex items-center gap-1.5">
            <MailWarning size={14} aria-hidden="true" />
            <strong>Live activity feed is not connected</strong>
          </span>
          <span className="text-turmeric-700 dark:text-turmeric-300">
            Showing local-only events. Sign in to sync activity to your Firestore
            account — the app&apos;s single data store, no separate database to
            provision.{' '}
            <Link href="/integrations" className="font-medium underline underline-offset-2 hover:text-tomato-600">
              Integration setup
            </Link>
          </span>
        </div>
      )}

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
