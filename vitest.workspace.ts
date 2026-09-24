import { defineWorkspace } from 'vitest/config';

/** Root Vitest workspace: every package's tests plus the web app's unit tests. */
export default defineWorkspace(['packages/*/vitest.config.ts', 'apps/web/vitest.config.ts', { test: { name: 'packages', include: ['packages/*/tests/**/*.test.ts'], exclude: ['**/tests/integration/**'], environment: 'node' } }]);
