import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'features/**/*.test.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['tests/setup.ts'],
    globals: false,
  },
  // fileURLToPath, not URL.pathname: on Windows the latter is "/C:/…" with %20 for spaces.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
});
