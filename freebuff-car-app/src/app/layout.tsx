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
  // Build provenance baked at build time: GitHub Actions sets COMMIT_SHA so
  // the live site self-describes which commit is serving (checked against
  // local HEAD before push in the pre-push hook's deployed-hash gate).
  const commitSha = (process.env.COMMIT_SHA ?? 'dev').slice(0, 7);

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
