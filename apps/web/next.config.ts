import type { NextConfig } from 'next';

/**
 * Security headers and CSP (plan §29). Cesium needs `blob:` workers and `wasm-unsafe-eval`
 * (Draco/KTX decoders); it does NOT need `unsafe-eval` because we import @cesium/engine, not the
 * `cesium` meta-package (ADR-0002). Imagery/terrain hosts are allowed by `connect-src`/`img-src`.
 */
const dataHosts = [
  'https://terrain.reearth.land',
  'https://api.open-meteo.com',
  'https://customer-api.open-meteo.com',
  'https://api.cesium.com',
  'https://assets.ion.cesium.com',
  'https://*.virtualearth.net',
  'https://dev.virtualearth.net',
  ...(process.env['IMAGERY_XYZ_URL'] ? [new URL(process.env['IMAGERY_XYZ_URL'].replace(/\{[^}]+\}/g, 'x')).origin.replace(/^https?:\/\/[^.]+\./, 'https://*.')] : []),
];

const csp = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' blob:${process.env.NODE_ENV === 'development' ? " 'unsafe-eval' 'unsafe-inline'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${dataHosts.join(' ')}`,
  `connect-src 'self' blob: data: ${dataHosts.join(' ')} https://api.stripe.com`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'self' data:",
  "frame-src https://js.stripe.com https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.stripe.com")' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@lightmap/astronomy', '@lightmap/auth', '@lightmap/billing', '@lightmap/config', '@lightmap/database', '@lightmap/entitlements', '@lightmap/geospatial', '@lightmap/observability', '@lightmap/renderer', '@lightmap/scene', '@lightmap/ui', '@lightmap/weather'],
  serverExternalPackages: ['geo-tz', 'postgres', 'stripe', 'nodemailer'],
  experimental: { optimizePackageImports: ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-dropdown-menu'] },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }, { source: '/cesium/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }];
  },
  webpack: (config) => {
    // Cesium resolves its assets at runtime from CESIUM_BASE_URL; nothing to alias. Keep source maps off for the big chunk.
    config.module.rules.push({ test: /\.glsl$/, type: 'asset/source' });
    return config;
  },
};

export default nextConfig;
