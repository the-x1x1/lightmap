import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * The repo's `.env` lives at the workspace root (README: `cp .env.example .env`), two levels
 * above this app, where Next does not look. Load it here for `next dev|build|start`, without
 * overriding anything already in the process environment; the `db:*` and other scripts read the
 * same file through `node --env-file`.
 */
function loadRootEnv(): void {
  let text: string;
  try {
    text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, key, rawValue] = m;
    if (!key || process.env[key] !== undefined) continue;
    let value = rawValue ?? '';
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2] ?? '';
    else value = value.replace(/\s+#.*$/, '');
    process.env[key] = value;
  }
}
loadRootEnv();

/**
 * `@spz-loader/core` (pulled in by @cesium/engine for Gaussian splats, which LightMap never
 * renders) inlines its WebAssembly as a binary string that the production minifier breaks —
 * see lib/stubs/spz-loader.ts. Both bundlers get the same stand-in.
 */
const spzStub = fileURLToPath(new URL('./lib/stubs/spz-loader.ts', import.meta.url));

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
      // camera=(self): the field view shows the phone's own camera behind the planned sun; the
      // frames never leave the device (PRIVACY.md §11).
      'camera=(self), microphone=(), geolocation=(self), payment=(self "https://checkout.stripe.com")',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/**
 * The Windows desktop app (apps/desktop) runs this server from Next's standalone output with its
 * own node.exe: `LIGHTMAP_DESKTOP=1 pnpm --filter @lightmap/web build`. Tracing starts at the
 * workspace root so the workspace's packages and hoisted dependencies are found. The ordinary
 * build is unchanged.
 */
const desktop = process.env.LIGHTMAP_DESKTOP === '1';

const nextConfig: NextConfig = {
  ...(desktop
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
      }
    : {}),
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
  webpack(config: { resolve: { alias?: Record<string, unknown> } }) {
    config.resolve.alias = { ...config.resolve.alias, '@spz-loader/core': spzStub };
    return config;
  },
  turbopack: { resolveAlias: { '@spz-loader/core': spzStub } },
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
        // The service worker must be revalidated on every load so a new version is picked up.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/cesium/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
