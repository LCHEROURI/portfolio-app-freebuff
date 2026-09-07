'use client';

import { nearbyDealers, type Dealer } from '@/lib/dealers';

interface Props {
  /** 5-digit ZIP from Step 1; dealers are seeded deterministically from it. */
  zip?: string;
  /** Winning vehicle label, e.g. "Toyota Camry". */
  vehicleLabel?: string | null;
  /** Show the demo-data disclaimer (live feed not configured yet). */
  demo?: boolean;
}

function formatPhone(phone: string): string {
  // Stored as (555) 01X-XXXX; render as-is (fictional exchange).
  return phone;
}

function DealerCard({ dealer }: { dealer: Dealer }) {
  return (
    <li className="rounded-lg border border-ink-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-navy-900">{dealer.name}</p>
        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
          {dealer.distanceMi.toFixed(1)} mi
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-600">{dealer.address}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <a
          href={`tel:${dealer.phone.replace(/[^0-9]/g, '')}`}
          className="inline-flex items-center gap-1 font-medium text-ink-700 transition-colors hover:text-navy-900"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
          {formatPhone(dealer.phone)}
        </a>
        <a
          href={dealer.directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-blue-700 underline decoration-blue-200 underline-offset-2 transition-colors hover:text-blue-800"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Directions
        </a>
      </div>
    </li>
  );
}

export default function DealerContactSheet({ zip, vehicleLabel, demo = true }: Props) {
  const { dealers } = nearbyDealers(zip ?? '');
  if (dealers.length === 0) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <h4 className="font-semibold text-navy-900">Nearby dealers</h4>
        <p className="mt-2 text-sm text-ink-500">
          Enter a 5-digit ZIP on Step 1 to see nearby dealers for this vehicle.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <h4 className="font-semibold text-navy-900">Nearby dealers</h4>
      <p className="mt-1 text-sm text-ink-600">
        {vehicleLabel ? `Dealers likely to carry the ${vehicleLabel} — ` : ''}
        closest first, from your Step 1 ZIP.
      </p>
      <ul className="mt-3 space-y-2.5">
        {dealers.map((dealer) => (
          <DealerCard key={dealer.name} dealer={dealer} />
        ))}
      </ul>
      {demo && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo dealers — a live feed is not configured yet. Names, phones, and distances are
          placeholders generated from your ZIP; real dealership data replaces them automatically
          when one is wired up.
        </p>
      )}
    </div>
  );
}