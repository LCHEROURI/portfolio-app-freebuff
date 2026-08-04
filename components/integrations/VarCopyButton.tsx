'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { varEnvLine } from '@/lib/integrationVarLinks';
import { copyToClipboard } from '@/lib/clipboard';

// ============================================================================
// One-click "copy the .env.example line" button for a missing env var.
// Shared by the Integrations setup checklist and the sidebar connection-status
// widget, so the two surfaces emit the exact same line from the same map.
// ============================================================================

export const VarCopyButton = ({ name }: { name: string }) => {
  const [copied, setCopied] = useState(false);
  const line = varEnvLine(name);
  if (!line) return null;
  const handle = async () => {
    if (await copyToClipboard(line)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      aria-label={copied ? `Copied ${line}` : `Copy ${line}`}
      title={line}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-pepper-400 transition-colors hover:bg-butter-100 hover:text-tomato-600 dark:text-pepper-500 dark:hover:bg-pepper-700 dark:hover:text-tomato-300"
    >
      {copied ? <Check size={10} aria-hidden="true" /> : <Copy size={10} aria-hidden="true" />}
    </button>
  );
};
