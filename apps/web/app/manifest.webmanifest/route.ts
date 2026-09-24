import { brand } from '@lightmap/config';

export const dynamic = 'force-static';

/**
 * PWA manifest (plan §13 "responsive web app/PWA first"; Phase 9 waits for PWA demand). Installable
 * in Chrome/Edge/Android (192 + 512 PNG, maskable variant) and on iOS via the apple-touch-icon in the
 * layout metadata. No service worker yet: the app needs the network for terrain and weather, and an
 * offline project cache is a Phase 9 deliverable. Icons are rasterised from `public/icon.svg`.
 */
export function GET() {
  const manifest = {
    id: '/',
    name: brand.name,
    short_name: brand.name,
    description: brand.description,
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: brand.colors.chrome,
    theme_color: brand.colors.chrome,
    orientation: 'any',
    categories: ['photo', 'utilities', 'weather'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'public, max-age=86400',
    },
  });
}
