import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getRequestUserId } from '@/lib/server/user';
import { isOpenRouterConfigured, summarizeReport, type SummarizeReportInput } from '@/lib/openrouter';

const SummarizeSchema = z.object({
  kind: z.enum(['daily', 'weekly']).default('daily'),
  title: z.string().max(200).default(''),
  body: z.string().min(1).max(50_000),
  attentionCount: z.number().int().min(0).default(0),
  // Per-user model override (Settings → AI summaries). Empty → env default.
  model: z.string().max(120).optional(),
});

// ============================================================================
// POST /api/ai/summarize — AI executive summary for a report.
//
// Owner-scoped like every live route (verified Firebase ID token when Firebase
// is configured, local id in demo mode). The client sends the deterministic
// report body; the server calls OpenRouter and returns a short executive
// summary. When OPENROUTER_API_KEY is unset or the call fails the response
// carries `summary: null` so the caller falls back to the deterministic text
// unchanged — AI never blocks a report.
// ============================================================================

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const badRequest = (message: string) =>
  NextResponse.json({ ok: false, error: message }, { status: 400 });

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Authentication required.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const parsed = SummarizeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const input: SummarizeReportInput = parsed.data;
  const result = await summarizeReport(input);

  return NextResponse.json({
    ok: true,
    configured: isOpenRouterConfigured(),
    summary: result?.summary ?? null,
    model: result?.model ?? null,
  });
}
