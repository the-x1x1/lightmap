import { brand } from '@lightmap/config';

export const dynamic = 'force-static';

/** PWA manifest (plan §13 "responsive web app/PWA first"). Icons are generated placeholders until brand assets exist. */
export function GET() {
  const manifest = {
    name: brand.name,
    short_name: brand.name,
    description: brand.description,
    start_url: '/',
    display: 'standalone',
    background_color: brand.colors.chrome,
    theme_color: brand.colors.chrome,
    orientation: 'any',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=86400' } });
}
