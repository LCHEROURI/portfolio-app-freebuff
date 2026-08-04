import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getRequestUserId } from '@/lib/server/user';
import { isOpenRouterConfigured, narrateTopThree } from '@/lib/openrouter';

// ============================================================================
// POST /api/ai/top-three — plain-language narration of today's top three actions.
//
// Owner-scoped like every live route (verified Firebase ID token when Firebase
// is configured, local id in demo mode). The client sends the deterministic
// top-three actions; the server calls OpenRouter and returns a single
// paragraph explaining why they matter today. When OPENROUTER_API_KEY is unset
// or the call fails, the response carries `narration: null` so the caller
// falls back to the rule-based list unchanged.
// ============================================================================

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ActionSchema = z.object({
  priority: z.number().int().min(0),
  title: z.string().min(1).max(200),
  description: z.string().max(400),
  // Project the action belongs to, when known — powers cite-back links.
  projectId: z.string().max(200).optional(),
  projectName: z.string().max(200).optional(),
});

const TopThreeSchema = z.object({
  actions: z.array(ActionSchema).min(1).max(3),
  // Per-user model override (Settings → AI summaries). Empty → env default.
  model: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = TopThreeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const narration = await narrateTopThree(parsed.data);

  return NextResponse.json({
    ok: true,
    configured: isOpenRouterConfigured(),
    narration: narration
      ? { paragraph: narration.paragraph, model: narration.model, projectIds: narration.projectIds }
      : null,
  });
}
