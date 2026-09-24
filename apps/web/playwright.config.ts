import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (plan §32). Runs against `next dev` with fixture providers so no network is needed:
 * WEATHER_PROVIDER=fixture, GEOCODER_PROVIDER=fixture, AUTH_DEV_LOGIN=true. Requires DATABASE_URL.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  // `next dev` answers slowly on a cold CI runner; 5 s per assertion was too tight.
  expect: { timeout: 15_000 },
  // Compile every route before the first test (see warmup.ts). Skipped against a deployed app.
  ...(process.env['E2E_BASE_URL'] ? {} : { globalSetup: './tests/e2e/warmup.ts' }),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  // With E2E_BASE_URL set, tests run against an already deployed app and no server is started.
  ...(process.env['E2E_BASE_URL']
    ? {}
    : {
        webServer: {
          command: 'pnpm exec next dev -p 3100',
          url: 'http://localhost:3100',
          reuseExistingServer: !process.env['CI'],
          timeout: 180_000,
          env: {
            WEATHER_PROVIDER: 'fixture',
            GEOCODER_PROVIDER: 'fixture',
            AUTH_DEV_LOGIN: 'true',
            LIGHTMAP_SHOW_DEV_BANNER: 'true',
            NEXT_PUBLIC_APP_URL: 'http://localhost:3100',
            AUTH_URL: 'http://localhost:3100',
            AUTH_SECRET: process.env['AUTH_SECRET'] ?? 'e2e-secret-e2e-secret-e2e-secret-e2e',
            DATABASE_URL:
              process.env['DATABASE_URL'] ??
              'postgres://lightmap:lightmap@localhost:5432/lightmap_e2e',
          },
        },
      }),
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
