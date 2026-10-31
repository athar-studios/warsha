import { defineConfig } from '@playwright/test';

/**
 * Visual + layout checks for the two browser apps.
 *
 * Two projects, one command:
 *
 *   * `desktop` — `apps/desktop/e2e/`: seven screens × two viewports × two locales × two themes,
 *     each with a stored baseline.
 *   * `remote`  — `apps/remote/e2e/`: the PWA's smoke check.
 *
 * Both dev servers are started here (`reuseExistingServer: false`), so `pnpm visual` is
 * self-contained in WSL and in CI — nothing has to be running first, and a stale server on the port
 * fails loudly instead of quietly serving an old bundle.
 *
 * Determinism is the whole point of this file's `use` block: a pinned locale, timezone and device
 * scale factor, reduced motion, no animations, and `maxDiffPixelRatio: 0` — one changed pixel on a
 * baseline is a failing check, not a warning.
 */
export default defineConfig({
  testDir: 'apps',
  testMatch: /.*\.spec\.ts$/,
  // The dev servers are shared by every case; serial execution keeps the screenshots comparable and
  // the failure output readable (one dev server each, no interleaved HMR).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // A layout check that tolerates drift is not a layout check.
      maxDiffPixelRatio: 0,
      threshold: 0,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    locale: 'en-US',
    timezoneId: 'UTC',
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop',
      testDir: 'apps/desktop/e2e',
      use: { baseURL: 'http://127.0.0.1:5173' },
    },
    {
      name: 'remote',
      testDir: 'apps/remote/e2e',
      use: { baseURL: 'http://127.0.0.1:5174' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter warsha-desktop dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter warsha-remote dev',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
