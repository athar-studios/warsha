import { defineConfig } from '@playwright/test';

/**
 * Visual, layout and accessibility checks for the two browser apps.
 *
 * Two projects, one command:
 *
 *   * `desktop` — `apps/desktop/e2e/`: every screen and wizard state × the widths §10 gives it a
 *     different shape at × two locales × two themes, each with a stored baseline, plus the axe/keyboard
 *     gate, the §7 states and the keyboard flows.
 *   * `remote`  — `apps/remote/e2e/`: the PWA's screens in the same matrix, on the phone widths.
 *
 * Both dev servers are started here (`reuseExistingServer: false`), so `pnpm visual` is
 * self-contained in WSL and in CI — nothing has to be running first, and a stale server on the port
 * fails loudly instead of quietly serving an old bundle.
 *
 * Determinism is the whole point of this file's `use` block: a pinned locale, timezone and device
 * scale factor, reduced motion, no animations, and `maxDiffPixelRatio: 0` — one changed pixel on a
 * baseline is a failing check, not a warning.
 *
 * The matrix is what B4 asked for (320/390/768/1024/1440 × AR/EN × light/dark × 23 screens, plus axe),
 * which is far more cases than one worker can run in a reasonable time. Every case builds its own page
 * and its own network stubs, and the two dev servers are stateless under concurrent requests, so the
 * cases are parallel; the determinism that matters is pinned above, not the order they run in. Serial
 * execution is still available with `pnpm visual --workers=1` when a failure needs reading in order.
 *
 * Both dev servers are addressed as `localhost`, not `127.0.0.1`: Vite binds the host name, and on
 * Windows that resolution can land on IPv6 only, where a `127.0.0.1` probe never answers and
 * `webServer` times out at 180s. The name is what both the server and the browser ask for.
 *
 * The capture host must have IBM Plex Sans Arabic and IBM Plex Mono installed, or `auditUsedFonts`
 * fails every screenshot rather than quietly storing fallback metrics — see
 * `apps/desktop/e2e/support/fonts.ts` and `bridge-io/audit/visual.md`.
 */
export default defineConfig({
  testDir: 'apps',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  reporter: process.env.CI
    ? [['list'], ['github'], ['json', { outputFile: 'bridge-io/audit/visual-playwright.json' }]]
    : [['list'], ['json', { outputFile: 'bridge-io/audit/visual-playwright.json' }]],
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
      use: { baseURL: 'http://localhost:5173' },
    },
    {
      name: 'remote',
      testDir: 'apps/remote/e2e',
      use: { baseURL: 'http://localhost:5174' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter warsha-desktop dev',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter warsha-remote dev',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
