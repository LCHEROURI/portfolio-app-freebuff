import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getRequestUserId } from '@/lib/server/user';
import { isOpenRouterConfigured, recommendWinner } from '@/lib/openrouter';

// ============================================================================
// POST /api/ai/recommend-winner — AI winner recommendation for a project.
//
// Owner-scoped like every live route (verified Firebase ID token when Firebase
// is configured, local id in demo mode). The client sends the project name and
// the evaluated versions with their weighted scores; the server calls OpenRouter
// and returns the recommended version id plus a short "why this version wins"
// note. When OPENROUTER_API_KEY is unset, the call fails, or the reply can't be
// mapped to a known version, the response carries `recommendation: null` so the
// caller falls back to the deterministic top score.
// ============================================================================

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CandidateSchema = z.object({
  versionId: z.string().min(1),
  versionName: z.string().min(1).max(120),
  builder: z.string().max(80),
  model: z.string().max(120),
  overallScore: z.number().min(0).max(10),
  scores: z.record(z.number().min(0).max(10)).default({}),
});

const RecommendSchema = z.object({
  projectName: z.string().min(1).max(160),
  candidates: z.array(CandidateSchema).min(1).max(30),
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

  const parsed = RecommendSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const recommendation = await recommendWinner(parsed.data);

  return NextResponse.json({
    ok: true,
    configured: isOpenRouterConfigured(),
    recommendation: recommendation
      ? { recommendedVersionId: recommendation.recommendedVersionId, note: recommendation.note, model: recommendation.model }
      : null,
  });
}
