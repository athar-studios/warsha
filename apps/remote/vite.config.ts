import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * The Android shell opens the bundle from `file://` (origin `null`), where Chromium refuses a
 * `<script type="module">` and any `crossorigin` subresource (R-UI-5 F1), so the built page names one
 * classic, deferred script instead. Dev (`vite`) is untouched: this runs in `transformIndexHtml` with
 * `order: 'post'` and only when building.
 *
 * Measured on this tree: with `format: 'iife'` Vite inlines the bundle's CSS into the script (a
 * non-ES output has no CSS asset), so the page carries no stylesheet link at all — the stylesheet
 * rewrite below is the guard for the day one appears again, not the current state. `check:pwa`'s
 * `index.html has no root-absolute asset URL` / `no crossorigin attribute` are the assertions that
 * matter, because a `.replace` that finds nothing fails silently.
 */
function classicShellHtml(): Plugin {
  return {
    name: 'warsha-classic-shell-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html
          .replace('<script type="module" crossorigin ', '<script defer ')
          .replace('<link rel="stylesheet" crossorigin ', '<link rel="stylesheet" '),
    },
  };
}

export default defineConfig({
  plugins: [react(), classicShellHtml()],
  base: './',
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
    // No `<link rel="modulepreload">` in the built page: it is a module-page hint, and the page this
    // build ships is classic. There is no `import()` (grep: none), so one IIFE chunk loses nothing.
    modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
