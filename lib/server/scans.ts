import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  FIRESTORE_COLLECTIONS, firestoreList, isFirestoreAdminConfigured,
} from './firestoreAdmin';
import type { Repository } from '@/types';

// ============================================================================
// Server-side reads of the local scanner feed.
//
// The scanner feed has two sources, resolved by readScannedRepositories:
//
//   1. Firestore (production). With FIREBASE_SERVICE_ACCOUNT configured, POST
//      /api/scanner persists validated scans into the `repositories`
//      collection (with lastScannedAt) under the configured owner
//      (REPORT_OWNER_ID). Reading from that collection is the production path:
//      the local machine POSTs and the serverless app serves rows.
//
//   2. data/scans.json (local dev). Without a service account, the demo-mode
//      scanner writes the same file the cron snapshot overlays. The file lives
//      at process.cwd()/data/scans.json, which only the machine that runs the
//      scanner (or the local dev server) actually has; on a read-only
//      serverless filesystem this degrades to the Firestore source above.
//
// Extracted so tests can mock one small module instead of a Node builtin.
// ============================================================================

export const SCANS_FILE = path.join(process.cwd(), 'data', 'scans.json');

/** Read data/scans.json as an array of raw scan rows; [] when absent/unreadable. */
export const readScansFile = async (): Promise<unknown[]> => {
  const raw = await readFile(SCANS_FILE, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * Read the scanner feed from the production source of truth when one exists.
 *
 * With FIREBASE_SERVICE_ACCOUNT configured, the feed is the Firestore
 * `repositories` collection — rows carrying `lastScannedAt`, written by
 * POST /api/scanner — scoped to the configured owner. Without a service
 * account (local dev), the local data/scans.json file is read instead.
 * Rows come back in the same Repository shape either way.
 */
export const readScannedRepositories = async (ownerId: string): Promise<unknown[]> => {
  if (isFirestoreAdminConfigured()) {
    try {
      const rows = await firestoreList<Repository>(FIRESTORE_COLLECTIONS.repositories, ownerId);
      return rows.filter((r) => typeof r.lastScannedAt === 'string');
    } catch (err) {
      console.warn(
        'readScannedRepositories: Firestore read failed, falling back to local file:',
        err instanceof Error ? err.message : err,
      );
    }
  }
  return readScansFile();
};
