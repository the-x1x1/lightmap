import { defineConfig } from 'vitest/config';

/**
 * One package's own tests, for `pnpm test` (turbo runs each package's `test` script in its own
 * directory). Without it Vitest found the root config from a package directory and resolved its
 * `projects` paths against the package, failing in every package; CI runs the root config once
 * (`pnpm test:unit`) and is unaffected.
 */
export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', '**/node_modules/**'],
    environment: 'node',
  },
});
