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
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
});
