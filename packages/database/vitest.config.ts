import { defineConfig } from 'vitest/config';

/**
 * Database package tests. Its own config so running Vitest from this folder (the integration
 * script, CI's Postgres job) does not pick up the root config, whose project paths are relative to
 * the repo root.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Real PostgreSQL round-trips and migrations: allow more than the 5 s default.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
