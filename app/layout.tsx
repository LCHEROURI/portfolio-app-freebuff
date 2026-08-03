import type { Metadata, Viewport } from 'next';

import { StoreProvider } from '@/lib/store';
import { ThemeProvider } from '@/lib/theme';
import { AppLayout } from '@/components/layout/AppLayout';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'App Portfolio Command Center',
    template: '%s · Command Center',
  },
  description:
    'One dashboard for every AI-generated implementation of your app concept — projects, versions, deployments, tasks, model comparisons, and daily reports.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFDFA' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1312' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <StoreProvider>
            <AppLayout>{children}</AppLayout>
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
