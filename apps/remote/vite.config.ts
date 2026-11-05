import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@warsha/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@warsha/i18n': path.resolve(__dirname, '../../packages/i18n/src'),
      '@warsha/client': path.resolve(__dirname, '../../packages/client/src'),
    },
  },
  // The dev server answers the pairing flow's phone: a phone cannot reach `localhost` on the PC,
  // so `pnpm --filter warsha-remote dev:lan` (vite's `--host`) is the documented opt-in that binds
  // every interface. The default here stays loopback on purpose — DECISIONS.md (2026-11-04) rules
  // out a silent `0.0.0.0`, and `pnpm visual` / Playwright only ever talk to `localhost:5174`.
  server: {
    port: 5174,
    strictPort: true,
  },
  // `preview` serves the *built* `dist/` — the exact artifact `check:pwa` validated (manifest, icons,
  // `sw.js`) — and `preview:lan` is its opt-in phone-facing form. Same port as dev so the pairing
  // instructions name one address `http://<pc-address>:5174/` whichever server is running; the two
  // are never up at the same time (`strictPort` refuses the second).
  preview: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});