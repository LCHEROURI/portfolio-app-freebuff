import { NextResponse, type NextRequest } from 'next/server';

import { buildPreviewHtml, printPdfFileName, PrintDocSchema } from '@/lib/printDoc';
import { ChromePdfUnavailableError, renderHtmlToPdf } from '@/lib/server/chromePdf';
import { getRequestUserId } from '@/lib/server/user';

// ============================================================================
// POST /api/print/pdf — render a print document to a downloadable PDF.
//
// Owner-scoped like every live route (verified Firebase ID token when Firebase
// is configured, local id in demo mode). The client sends the SAME PrintDoc
// the preview window renders; the server builds the document via the shared
// buildPreviewHtml (lib/printDoc.ts) and prints it through headless Chrome's
// engine, so the downloaded PDF can never drift from the on-screen preview.
//
// Chrome must be reachable on the server (CHROME_PATH env, local macOS
// default). Where it is not — e.g. some serverless runtimes — the response is
// a 503 with a targeted message, and the client surfaces it inline.
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

  const parsed = PrintDocSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const pdf = await renderHtmlToPdf(buildPreviewHtml(parsed.data));
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // Shared filename helper — the client's <a download> uses the same
        // name, so the saved file always matches the Content-Disposition.
        'Content-Disposition': `attachment; filename="${printPdfFileName(parsed.data)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof ChromePdfUnavailableError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
    }
    console.error('PDF render failed:', err);
    return NextResponse.json({ ok: false, error: 'PDF render failed.' }, { status: 500 });
  }
}
