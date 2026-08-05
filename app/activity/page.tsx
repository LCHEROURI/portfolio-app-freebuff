'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History, MailCheck, MailX, MailWarning } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store';
import { timeAgo } from '@/lib/engine';
import {
  groupReportDeliveries,
  type ReportDeliveryAttempt,
  type ReportDeliveryGroup,
} from '@/lib/reportDeliveries';

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

const ATTEMPT_TONES: Record<ReportDeliveryAttempt['status'], string> = {
  sent: 'bg-basil-100 text-basil-700 dark:bg-basil-900/60 dark:text-basil-200',
  skipped: 'bg-turmeric-100 text-turmeric-700 dark:bg-turmeric-900/60 dark:text-turmeric-200',
  failed: 'bg-paprika-100 text-paprika-700 dark:bg-paprika-900/60 dark:text-paprika-200',
};

const ATTEMPT_LABELS: Record<ReportDeliveryAttempt['status'], string> = {
  sent: 'Emailed ✓',
  skipped: 'Skipped',
  failed: 'Failed',
};

const attemptIcon = (status: ReportDeliveryAttempt['status']) =>
  status === 'sent' ? <MailCheck size={12} aria-hidden="true" /> :
  status === 'skipped' ? <MailWarning size={12} aria-hidden="true" /> :
  <MailX size={12} aria-hidden="true" />;

const DELIVERIES = 'DELIVERIES';

function AttemptRow({ attempt, isFirst }: { attempt: ReportDeliveryAttempt; isFirst: boolean }) {
  return (
    <li className="relative">
      <span
        className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 ${isFirst ? 'border-tomato-400 bg-tomato-100 dark:bg-tomato-500' : 'border-butter-300 bg-flour-50 dark:border-pepper-600 dark:bg-pepper-800'}`}
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${ATTEMPT_TONES[attempt.status]}`}>
          {attemptIcon(attempt.status)}
          {ATTEMPT_LABELS[attempt.status]}
        </span>
        {attempt.isRetry && (
          <span className="rounded-md bg-butter-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pepper-500 dark:bg-pepper-700 dark:text-pepper-300">
            retry
          </span>
        )}
        {attempt.test && (
          <span className="rounded-md bg-eggplant-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-eggplant-700 dark:bg-eggplant-900/60 dark:text-eggplant-200">
            test send
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-pepper-400">{timeAgo(attempt.createdAt)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        {attempt.emailId && (
          <code
            className="rounded bg-butter-100 px-1.5 py-0.5 font-mono text-[11px] text-pepper-600 dark:bg-pepper-700 dark:text-flour-200"
            title="Resend email id"
          >
            {attempt.emailId}
          </code>
        )}
        {attempt.reason && <span className="text-pepper-400">{attempt.reason}</span>}
      </div>
    </li>
  );
}

function DeliveryTimelineCard({ group }: { group: ReportDeliveryGroup }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="badge-diet">{group.kind}</span>
            <h3 className="font-display text-sm font-semibold text-pepper-800 dark:text-flour-100">
              {group.title}
            </h3>
          </div>
          <p className="mt-1 text-xs text-pepper-400">
            {group.attempts.length} {group.attempts.length === 1 ? 'attempt' : 'attempts'} ·{' '}
            {group.sentCount} delivered
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${ATTEMPT_TONES[group.latest.status]}`}>
          {attemptIcon(group.latest.status)}
          {ATTEMPT_LABELS[group.latest.status]}
        </span>
      </div>
      <ol className="relative space-y-3 border-l border-butter-300 pl-4 dark:border-pepper-600">
        {group.attempts.map((a, i) => (
          <AttemptRow key={a.id} attempt={a} isFirst={i === 0} />
        ))}
      </ol>
    </Card>
  );
}

export default function ActivityPage() {
  const store = useStore();
  const [filter, setFilter] = useState<'ALL' | typeof DELIVERIES | string>('ALL');

  // When /api/activity isn't wired (Supabase not configured or the schema
  // hasn't created the activity table), the feed is local-only. Surface that
  // instead of silently showing demo/partial delivery history.
  const liveActivityOff = !store.activityLive;

  const kinds = Array.from(new Set(store.activity.map((a) => KIND_LABELS[a.kind] ?? a.kind))).sort();
  const deliveries = groupReportDeliveries(store.activity);
  const showDeliveries = filter === DELIVERIES;
  const entries = showDeliveries
    ? []
    : store.activity
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
            Showing local-only events. Wire Supabase and run{' '}
            <code className="rounded bg-turmeric-100 px-1 py-0.5 font-mono text-[11px] dark:bg-turmeric-900">supabase db push</code>{' '}
            (or <code className="rounded bg-turmeric-100 px-1 py-0.5 font-mono text-[11px] dark:bg-turmeric-900">supabase/schema.sql</code>)
            to create the <code className="rounded bg-turmeric-100 px-1 py-0.5 font-mono text-[11px] dark:bg-turmeric-900">activity</code> table.{' '}
            <Link href="/integrations" className="font-medium underline underline-offset-2 hover:text-tomato-600">
              Integration setup
            </Link>
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        <button type="button" className={filter === 'ALL' ? 'chip chip-active' : 'chip'} onClick={() => setFilter('ALL')}>All</button>
        <button type="button" className={showDeliveries ? 'chip chip-active' : 'chip'} onClick={() => setFilter(DELIVERIES)}>Deliveries</button>
        {kinds.map((k) => (
          <button key={k} type="button" className={filter === k ? 'chip chip-active' : 'chip'} onClick={() => setFilter(k)}>{k}</button>
        ))}
      </div>

      {showDeliveries ? (
        deliveries.length === 0 ? (
          <EmptyState icon={<MailCheck size={32} aria-hidden="true" />} title="No deliveries yet" description="Emailed reports appear here as a per-report timeline." />
        ) : (
          <div className="space-y-3">
            {deliveries.map((g) => (
              <DeliveryTimelineCard key={`${g.kind}|${g.title}`} group={g} />
            ))}
          </div>
        )
      ) : entries.length === 0 ? (
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
