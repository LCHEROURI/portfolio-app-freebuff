import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { GALLERY_FILE_NAMES } from '@/lib/galleryFiles';

// Only the canonical gallery files may be served — never a path traversal.
const ALLOWED = new Set(GALLERY_FILE_NAMES);

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { file: string } }) {
  const file = params.file;
  if (!ALLOWED.has(file)) {
    return new NextResponse('Not found', { status: 404 });
  }
  try {
    const buf = await readFile(path.join(process.cwd(), 'screenshots', file));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
