import type { Metadata, Viewport } from 'next';

import '../styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Buy Smart with Larry — Car Purchase Advisor',
    template: '%s | Buy Smart with Larry',
  },
  description:
    'An independent, fee-aware car purchase advisor. Compare vehicles, test financing and lease math, audit dealer quotes, and walk into the dealership with a D.R.I.V.E. negotiation plan.',
  icons: {
    icon: '/images/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f0f4f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1929' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Build provenance baked at build time. Two sources: NEXT_PUBLIC_COMMIT_SHA
  // from .env.production (written by the deploy workflow before it uploads the
  // source, so the value survives App Hosting's CLOUD build where plain env
  // does not), or COMMIT_SHA from a local build. "dev" otherwise.
  const rawSha =
    process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.COMMIT_SHA || 'dev';
  const commitSha = rawSha.slice(0, 7);

  return (
    <html lang="en">
      <body>
        {children}
        <footer
          data-commit={commitSha}
          style={{
            position: 'fixed',
            bottom: 0,
            right: 0,
            zIndex: 50,
            padding: '2px 8px',
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          build {commitSha}
        </footer>
      </body>
    </html>
  );
}
