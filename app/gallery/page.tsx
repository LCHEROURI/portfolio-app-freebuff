import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Images } from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import galleryCells from '@/lib/gallery-cells.json';

export const metadata: Metadata = { title: 'Screenshot gallery' };

// Shared with the /screenshots route handler and the capture driver via
// lib/gallery-cells.json, so the page, the allowlist, and the captures can
// never drift apart.
const ROUTES = galleryCells as ReadonlyArray<{ route: string; label: string }>;

// Every cell is captured at this fixed viewport by scripts/capture-gallery.mjs.
const CELL_WIDTH = 1440;
const CELL_HEIGHT = 1000;

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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-pepper-900 dark:text-flour-50">{label}</h2>
              <Link
                href={`/${route}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-tomato-600 hover:underline dark:text-tomato-400"
              >
                Open /{route} <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure>
                <Image
                  src={`/screenshots/${route}.png`}
                  alt={`${label} in light theme`}
                  width={CELL_WIDTH}
                  height={CELL_HEIGHT}
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="h-auto w-full rounded-lg border border-butter-200 dark:border-pepper-700"
                />
                <figcaption className="mt-1 text-xs text-pepper-500 dark:text-pepper-300">Light</figcaption>
              </figure>
              <figure>
                <Image
                  src={`/screenshots/${route}-dark.png`}
                  alt={`${label} in dark theme`}
                  width={CELL_WIDTH}
                  height={CELL_HEIGHT}
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="h-auto w-full rounded-lg border border-butter-200 dark:border-pepper-700"
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
