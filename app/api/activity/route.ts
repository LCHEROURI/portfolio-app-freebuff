import { NextResponse, type NextRequest } from 'next/server';

import { getRequestUserId } from '@/lib/server/user';
import { fromActivityRow } from '@/lib/server/rows';
import { isSupabaseConfigured, supabaseSelect } from '@/lib/server/supabase';

// ============================================================================
// GET /api/activity — the live activity feed (report delivery history).
//
// The Activity page's store overlays this feed when Supabase is wired so the
// full email delivery history shows up: 'Save and email now' / retry from the
// browser, and every cron send (real + test). Auth matches every other live
// route via getRequestUserId (verified Firebase ID token, or x-app-user in
// demo mode); rows are scoped by owner_id in the query.
// ============================================================================

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, configured: false, activity: [] });
  }

  try {
    const rows = await supabaseSelect<Record<string, unknown>>('activity', userId, {
      order: 'created_at.desc',
    });
    return NextResponse.json({ ok: true, configured: true, activity: rows.map(fromActivityRow) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, configured: true, error: err instanceof Error ? err.message : 'Failed to load activity.' },
      { status: 500 },
    );
  }
}
