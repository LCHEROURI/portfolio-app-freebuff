import type { Metadata } from 'next';
import SavedReportsLibrary from '@/components/SavedReportsLibrary';

export const metadata: Metadata = {
  title: 'My saved reports',
  description:
    'Every Intelligence Report you saved — reopen, re-download, or delete any time from this device.',
};

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-600">
        Intelligence Reports you saved from Step 11 live here — reopen any one to jump straight back to
        its full briefing, or re-download it as Markdown or plain text.
      </p>
      <SavedReportsLibrary variant="page" />
    </div>
  );
}