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
  resolve: {
    alias: {
      '@warsha/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@warsha/i18n': path.resolve(__dirname, '../../packages/i18n/src'),
      '@warsha/client': path.resolve(__dirname, '../../packages/client/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@testing-library/jest-dom/vitest'],
    // Component tests mount the whole app and await daemon wiring. `pnpm -r test` runs eight
    // workspaces in parallel and starves the 5 s default: AppWiring (routines) and
    // ModelsSettings (add form) timed out at exactly 5000 ms twice, while the same desktop suite
    // alone passed 468/468 and `--workspace-concurrency=2` passed the whole monorepo. This raises
    // the ceiling only; no assertion, mock or skip changes.
    testTimeout: 15000,
  },
});