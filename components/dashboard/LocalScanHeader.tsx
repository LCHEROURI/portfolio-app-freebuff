import type { ReactNode } from 'react';
import { FileDiff } from 'lucide-react';

import { LOCAL_SCAN_SUBTITLE, LOCAL_SCAN_TITLE } from '@/lib/scan';

/**
 * Shared 'Local scan' heading block. Used by the LastScanStrip on both the
 * Command Center and Reports pages, with an optional action slot for a
 * per-surface link (e.g. the launchd schedule). The label/subtitle text comes
 * from lib/scan — the same constants the emailed report bodies derive their
 * 'Local scan freshness' heading from, so all three surfaces stay in sync.
 */
export const LocalScanHeader = ({ action }: { action?: ReactNode }) => (
  <div className="flex items-center gap-2">
    <FileDiff size={16} className="shrink-0 text-tomato-500" aria-hidden="true" />
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-pepper-500 dark:text-pepper-300">{LOCAL_SCAN_TITLE}</p>
      <p className="text-xs text-pepper-400">{LOCAL_SCAN_SUBTITLE}</p>
    </div>
    {action && <div className="ml-auto shrink-0">{action}</div>}
  </div>
);
