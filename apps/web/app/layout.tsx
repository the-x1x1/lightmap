import type { Metadata, Viewport } from 'next';
import { brand } from '@lightmap/config';
import '@/styles/globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: brand.name },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: brand.colors.chrome,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">
        {/* Skip link (plan §28): the map is a large focusable element before the controls. */}
        <a
          href="#planning-panel"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-[var(--lm-sun)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[#1a1200]"
        >
          Skip to planning controls
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
