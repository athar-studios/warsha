import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: ['..', path.resolve(__dirname, '../../../../..')],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@testing-library/jest-dom'],
    // Same measured cause as apps/desktop: `pnpm -r test` runs eight workspaces in parallel and
    // starves the 5 s default. `src/App.test.tsx > moves between screens by their own routes`
    // timed out at exactly 5000 ms under full-monorepo parallelism. The ceiling moves; nothing
    // else does.
    testTimeout: 15000,
  },
});
