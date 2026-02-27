// src/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Housing Workforce · Qrew',
  description: 'Elder Systems — Qrew workforce platform for Housing Opportunities Inc.',
  manifest: '/manifest.json',
  appleWebApp: {
    statusBarStyle: 'default',
    title: 'Housing Workforce',
  },
};

export const viewport: Viewport = {
  themeColor: '#2323F1',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
