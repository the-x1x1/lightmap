import type { NextConfig } from 'next';

/**
 * Security headers (plan §29). The Content-Security-Policy is set per request with a nonce in
 * middleware.ts; everything else is static.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.stripe.com")',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@lightmap/astronomy',
    '@lightmap/auth',
    '@lightmap/billing',
    '@lightmap/config',
    '@lightmap/database',
    '@lightmap/entitlements',
    '@lightmap/geospatial',
    '@lightmap/observability',
    '@lightmap/renderer',
    '@lightmap/scene',
    '@lightmap/ui',
    '@lightmap/weather',
  ],
  serverExternalPackages: ['geo-tz', 'postgres', 'stripe', 'nodemailer'],
  experimental: {
    optimizePackageImports: [
      '@radix-ui/react-dialog',
      '@radix-ui/react-popover',
      '@radix-ui/react-dropdown-menu',
    ],
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/cesium/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
