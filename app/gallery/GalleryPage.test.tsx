import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import GalleryPage from './page';
import { GET } from '../screenshots/[file]/route';
import { GALLERY_FILE_NAMES } from '@/lib/galleryFiles';

// The page renders next/image <img> tags pointing at /screenshots/... and the
// route handler streams the PNGs from the repo. Mock the fs boundary (via
// vi.hoisted so the factory never closes over test-scope variables) but
// exercise the REAL route logic: allowlist enforcement + response shape.
const { PNG_1x1 } = vi.hoisted(() => ({
  PNG_1x1:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async () => Buffer.from(PNG_1x1, 'base64')),
  };
});

// next/image renders a /_next/image?url=...&w=...&q=... src; extract the
// underlying file URL so assertions match the /screenshots contract.
const srcOf = (img: HTMLElement) => {
  const src = img.getAttribute('src') ?? '';
  const url = src.match(/[?&]url=([^&]+)/)?.[1];
  return url ? decodeURIComponent(url) : src;
};

const captions = [
  { route: 'command-center', label: 'Command Center' },
  { route: 'projects', label: 'Projects' },
  { route: 'versions', label: 'Versions' },
  { route: 'deployments', label: 'Deployments' },
  { route: 'repositories', label: 'Repositories' },
  { route: 'model-comparison', label: 'Model Comparison' },
  { route: 'reports', label: 'Reports' },
  { route: 'integrations', label: 'Integrations' },
  { route: 'settings', label: 'Settings' },
] as const;

describe('GET /gallery — full page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 9 sections with 18 light/dark img pairs', () => {
    render(<GalleryPage />);
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(18);

    const srcs = imgs.map(srcOf);
    expect(new Set(srcs).size).toBe(18); // no duplicated cell

    // Every light cell has its dark twin (the pair side-by-side contract).
    for (const f of GALLERY_FILE_NAMES) {
      expect(srcs).toContain(`/screenshots/${f}`);
    }
    expect(srcs.filter((s) => s.includes('-dark.png'))).toHaveLength(9);
  });

  it('links each pair to its live route via an "Open /route" caption', () => {
    render(<GalleryPage />);
    for (const { route, label } of captions) {
      const card = screen.getByRole('heading', { name: label }).closest('div')?.parentElement;
      expect(card, `card for ${label}`).toBeTruthy();
      const link = within(card as HTMLElement).getByRole('link', { name: `Open /${route}` });
      expect(link.getAttribute('href')).toBe(`/${route}`);
    }
  });

  it('serves every rendered src through the /screenshots handler (no broken images)', async () => {
    render(<GalleryPage />);
    const srcs = screen.getAllByRole('img').map(srcOf);

    for (const src of srcs) {
      const file = src.replace('/screenshots/', '');
      const res = await GET(new Request(`http://localhost${src}`), { params: { file } });
      expect(res.status, `expected 200 for ${src}`).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length, `expected non-empty body for ${src}`).toBeGreaterThan(0);
    }
  });

  it('returns 404 for files outside the allowlist (no path traversal)', async () => {
    for (const bad of ['secret.png', '..%2f..%2fpackage.json', 'command-center.svg', '']) {
      const res = await GET(new Request('http://localhost/screenshots/x'), { params: { file: bad } });
      expect(res.status, `expected 404 for ${bad}`).toBe(404);
    }
  });

  it('exports exactly 18 allowlisted file names (9 routes × light/dark)', () => {
    expect(GALLERY_FILE_NAMES).toHaveLength(18);
    expect(new Set(GALLERY_FILE_NAMES).size).toBe(18);
    const routes = new Set(GALLERY_FILE_NAMES.map((f) => f.replace(/\.png$/, '').replace(/-dark$/, '')));
    expect(routes.size).toBe(9);
  });
});
