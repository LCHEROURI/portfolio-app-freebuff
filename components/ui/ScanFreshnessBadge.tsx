import { FileDiff } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { timeAgo } from '@/lib/engine';

const SCAN_STALE_MS = 24 * 3_600_000;

/**
 * Freshness badge for scanner-reported facts. Reads lastScannedAt from the
 * scanner overlay so local uncommitted/unpushed flags are visibly marked as
 * fresh ('scanned just now') or stale ('stale scan · 3d ago') next to the live
 * GitHub feed — a stale badge means the local facts may be out of date.
 */
export const ScanFreshnessBadge = ({ scannedAt }: { scannedAt: string }) => {
  const age = Date.now() - new Date(scannedAt).getTime();
  const stale = age > SCAN_STALE_MS;
  return (
    <Badge tone={stale ? 'turmeric' : 'basil'} title={`Local scanner last captured this repo ${timeAgo(scannedAt)}`}>
      <FileDiff size={11} aria-hidden="true" />
      {stale ? `stale scan · ${timeAgo(scannedAt)}` : `scanned ${timeAgo(scannedAt)}`}
    </Badge>
  );
};
