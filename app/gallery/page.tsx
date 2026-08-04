import type { Metadata } from 'next';
import { Images } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import galleryCells from '@/lib/gallery-cells.json';

export const metadata: Metadata = { title: 'Screenshot gallery' };

// Shared with the /screenshots route handler and the capture driver via
// lib/gallery-cells.json, so the page, the allowlist, and the captures can
// never drift apart.
const ROUTES = galleryCells as ReadonlyArray<{ route: string; label: string }>;

export default function GalleryPage() {
  return (
    <div>
      <PageHeader
        title="Screenshot gallery"
        description="Every module in light and dark, captured from the deployed demo build so these match the live link. Browse locally from docs/screenshots.html too."
        action={
          <span className="inline-flex items-center gap-2 rounded-lg border border-butter-200 bg-butter-50 px-3 py-1.5 text-sm text-pepper-600 dark:border-pepper-700 dark:bg-pepper-800 dark:text-pepper-300">
            <Images size={16} aria-hidden="true" /> 18 cells
          </span>
        }
      />

      <div className="space-y-6">
        {ROUTES.map(({ route, label }) => (
          <Card key={route} className="p-4">
            <h2 className="mb-3 font-display text-lg font-semibold text-pepper-900 dark:text-flour-50">{label}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/screenshots/${route}.png`}
                  alt={`${label} in light theme`}
                  loading="lazy"
                  className="w-full rounded-lg border border-butter-200 dark:border-pepper-700"
                />
                <figcaption className="mt-1 text-xs text-pepper-500 dark:text-pepper-300">Light</figcaption>
              </figure>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/screenshots/${route}-dark.png`}
                  alt={`${label} in dark theme`}
                  loading="lazy"
                  className="w-full rounded-lg border border-butter-200 dark:border-pepper-700"
                />
                <figcaption className="mt-1 text-xs text-pepper-500 dark:text-pepper-300">Dark</figcaption>
              </figure>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
