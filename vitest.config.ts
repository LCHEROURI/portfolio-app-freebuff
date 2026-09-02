import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Match tsconfig paths so component tests can use `@/` imports.
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['**/*.test.{ts,tsx}'],
    // freebuff-car-app is a self-contained project with its own jest setup;
    // running its tests under the parent's vitest config fails on missing
    // jest globals and its own path alias.
    exclude: ['**/node_modules/**', 'freebuff-car-app/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
