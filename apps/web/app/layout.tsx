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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
