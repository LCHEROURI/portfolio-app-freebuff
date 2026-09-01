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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
