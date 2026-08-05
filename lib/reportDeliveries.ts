import type { ActivityEntry } from '@/types';

// ============================================================================
// Report delivery timeline — derives structured delivery attempts from the
// report_generated activity feed. All three producers (client save-and-email,
// client retry, cron send/test) write one activity row per attempt using a
// shared message grammar, so the Activity page can group them into a per-report
// timeline (saved → emailed → retried) without any schema change.
//
// Message grammar (produced by app/reports/page.tsx and
// app/api/cron/reports/route.ts):
//   [retried: ]<kind> report "<title>" emailed (<emailId>)[ [test]]
//   [retried: ]<kind> report "<title>" email skipped: <reason>
//   <kind> report "<title>" email <reason>          (cron failure path)
// ============================================================================

export type DeliveryStatus = 'sent' | 'skipped' | 'failed';

export interface ReportDeliveryAttempt {
  id: string;
  kind: 'daily' | 'weekly';
  title: string;
  status: DeliveryStatus;
  emailId?: string;
  reason?: string;
  isRetry: boolean;
  test?: boolean;
  createdAt: string;
}

export interface ReportDeliveryGroup {
  kind: 'daily' | 'weekly';
  title: string;
  /** All attempts for this report, oldest first. */
  attempts: ReportDeliveryAttempt[];
  /** Most recent attempt (drives the summary chip + group ordering). */
  latest: ReportDeliveryAttempt;
  sentCount: number;
}

const RETRY_PREFIX = /^retried:\s*/;
const REPORT_BASE = /^(daily|weekly) report "([^"]+)"\s+(.+)$/;
const EMAILED = /^emailed \(([^)]+)\)( \[test\])?$/;
const SKIPPED = /^email skipped:\s*(.+)$/;
const FAILED = /^email\s+(.+)$/;

/** Parse a report_generated activity message into a structured attempt, or
 *  null when the message isn't a delivery record (or isn't parseable). */
export const parseReportDelivery = (
  message: string,
): Omit<ReportDeliveryAttempt, 'id' | 'createdAt'> | null => {
  const isRetry = RETRY_PREFIX.test(message);
  const body = isRetry ? message.replace(RETRY_PREFIX, '') : message;
  const base = REPORT_BASE.exec(body);
  if (!base) return null;
  const kind = base[1] as ReportDeliveryAttempt['kind'];
  const title = base[2];
  const tail = base[3];

  const emailed = EMAILED.exec(tail);
  if (emailed) {
    return {
      kind, title, status: 'sent',
      emailId: emailed[1], test: Boolean(emailed[2]), isRetry,
    };
  }
  const skipped = SKIPPED.exec(tail);
  if (skipped) {
    return { kind, title, status: 'skipped', reason: skipped[1], isRetry };
  }
  const failed = FAILED.exec(tail);
  if (failed) {
    return { kind, title, status: 'failed', reason: failed[1], isRetry };
  }
  return null;
};

/** Group report_generated activity entries into per-report delivery timelines,
 *  newest report first. Non-delivery and unparseable entries are ignored. */
export const groupReportDeliveries = (
  entries: Pick<ActivityEntry, 'id' | 'kind' | 'message' | 'createdAt'>[],
): ReportDeliveryGroup[] => {
  const groups = new Map<string, ReportDeliveryGroup>();
  for (const entry of entries) {
    if (entry.kind !== 'report_generated') continue;
    const parsed = parseReportDelivery(entry.message);
    if (!parsed) continue;
    const attempt: ReportDeliveryAttempt = { ...parsed, id: entry.id, createdAt: entry.createdAt };
    const key = `${parsed.kind}|${parsed.title}`;
    const existing = groups.get(key);
    if (existing) {
      existing.attempts.push(attempt);
      existing.attempts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      existing.latest = existing.attempts[existing.attempts.length - 1];
      existing.sentCount = existing.attempts.filter((a) => a.status === 'sent').length;
    } else {
      groups.set(key, {
        kind: parsed.kind,
        title: parsed.title,
        attempts: [attempt],
        latest: attempt,
        sentCount: attempt.status === 'sent' ? 1 : 0,
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
};
