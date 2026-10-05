import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// `globals: false`, so Testing Library cannot register its own cleanup: unmount after each test.
afterEach(() => {
  cleanup();
});
