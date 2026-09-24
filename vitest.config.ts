import { defineConfig } from 'vitest/config';

/** Root Vitest config: package tests (node) + the web app's own config (jsdom). Integration tests run separately. */
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'packages', include: ['packages/*/tests/**/*.test.ts'], exclude: ['**/tests/integration/**'], environment: 'node' } },
      'apps/web/vitest.config.ts',
    ],
    coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['packages/*/src/**', 'apps/web/features/**', 'apps/web/lib/**'] },
  },
});
