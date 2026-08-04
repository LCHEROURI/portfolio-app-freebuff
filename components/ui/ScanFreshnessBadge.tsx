import { FileDiff } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { timeAgo } from '@/lib/engine';

const SCAN_STALE_MS = 24 * 3_600_000;

/** Exact clock time of a scan, e.g. "2026-08-04 6:30:05 AM". */
const formatClock = (scannedAt: string) => {
  const d = new Date(scannedAt);
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} ${time}`;
};

/** Whole hours (and minutes under an hour) since the scan, e.g. "3h 12m". */
const hoursOld = (scannedAt: string) => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(scannedAt).getTime()) / 60_000));
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
};

/**
 * Freshness badge for scanner-reported facts. Reads lastScannedAt from the
 * scanner overlay so local uncommitted/unpushed flags are visibly marked as
 * fresh ('scanned just now') or stale ('stale scan · 3d ago') next to the live
 * GitHub feed — a stale badge means the local facts may be out of date.
 *
 * The tooltip carries the exact capture timestamp and how many hours old the
 * facts are, so hovering the Repositories grid shows precisely when the local
 * scan ran rather than just a coarse '3d ago'.
 */
export const ScanFreshnessBadge = ({ scannedAt }: { scannedAt: string }) => {
  const age = Date.now() - new Date(scannedAt).getTime();
  const stale = age > SCAN_STALE_MS;
  return (
    <Badge
      tone={stale ? 'turmeric' : 'basil'}
      title={`Scanned ${formatClock(scannedAt)} (${hoursOld(scannedAt)} old)${stale ? ' — local facts may be out of date.' : ''}`}
    >
      <FileDiff size={11} aria-hidden="true" />
      {stale ? `stale scan · ${timeAgo(scannedAt)}` : `scanned ${timeAgo(scannedAt)}`}
    </Badge>
  );
};
