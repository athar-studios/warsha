import fs from 'node:fs';
import path from 'node:path';

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
 *
 * The AA mode is pinned the same way as the faces. The stored baselines carry LCD-subpixel glyph
 * fringes (rgba=rgb, hintstyle=slight, lcdfilter=default); a bare Linux host defaults to grayscale
 * AA and then every light-theme case fails on text rasterization alone — a config gap, not a design
 * change (B4, `DECISIONS.md` 2026-11-03). On Linux chromium is therefore launched with
 * `FONTCONFIG_FILE` pointed at `scripts/ci/capture-fontconfig.conf`, which includes the host's own
 * fontconfig chain (so the pinned faces still resolve) and then assigns those five axes last, so no
 * stray user or distro drop-in can disagree with the baselines. The value handed to the browser is
 * validated at config load: `WARSHA_CAPTURE_FONTCONFIG_FILE` (rendering investigations only) is
 * trimmed, resolved against this directory when relative, and must name a readable `<fontconfig>`
 * file — the repo pin likewise must. An empty or unloadable value is refused here rather than
 * reaching chromium, where it prints `Fontconfig error: Cannot load default config file` on the
 * browser's stderr and silently falls back to the host's own config: a stray user fragment would
 * look aligned on the capture host and render grayscale on a fresh CI runner, which is exactly the
 * 10k–25k-pixel failure class the pin exists to prevent. macOS and Windows do not read fontconfig and
 * are left exactly as they were.
 *
 * The fontconfig pin covers the *font* half of the bit-exact contract. The browser half — screen
 * geometry, locale, timezone, device scale factor, reduced motion — is pinned in `use` below; there
 * is no rasterizer flag that also pins it. Chromium's software rasterizer is not bit-deterministic on
 * curved and shadowed edges: two captures of one tree and one case differ by 10–60 px at 1–2 levels
 * (measured both ways, `PROGRESS.md` 2026-11-04 #45). `--disable-lcd-text` /
 * `--font-render-hinting=none` / `--disable-font-subpixel-positioning` were tried and REVERTED: they
 * moved 28% of pixels (grayscale AA is not what the app ships with) and the residual variance got
 * larger, not zero. So the contract is: `maxDiffPixelRatio: 0` still fails a case on *any* pixel that
 * differs structurally, while `threshold: 0.05` (~13/255) tolerates antialiasing noise up to the
 * measured maximum (11 levels). A moved edge or a shifted line differs by far more than that and still
 * fails — the tolerance is on *how much*, not on *how many*.
 */

/** The repo-managed fontconfig that pins the baselines' AA mode; Linux only. */
const CAPTURE_FONTCONFIG = path.join(__dirname, 'scripts', 'ci', 'capture-fontconfig.conf');

/**
 * The fontconfig file chromium may be launched with, or nothing on a platform that ignores it.
 *
 * `assertReadableFontconfig` is what keeps the pin honest: FONTCONFIG_FILE is a browser-process env
 * variable, so a value that is empty, relative to the browser's own cwd, or simply missing does not
 * fail the run — it prints one line on stderr nobody reads and changes which pixels get rasterized.
 * Failing at config load names the file and the variable instead of leaving 300 pixel diffs to
 * explain, and matches what `scripts/ci/install-capture-fonts.sh` already does before a capture.
 */
function resolveCaptureFontconfig(): string | undefined {
  if (process.platform !== 'linux') return undefined;
  const requested = (process.env.WARSHA_CAPTURE_FONTCONFIG_FILE ?? '').trim();
  // path.resolve keeps an absolute `requested` and anchors a relative one to this directory — the
  // repo root — never to whatever cwd the browser process would later try to read it from.
  const candidate = path.resolve(__dirname, requested === '' ? CAPTURE_FONTCONFIG : requested);
  assertReadableFontconfig(
    candidate,
    requested === '' ? 'the repo pin' : 'WARSHA_CAPTURE_FONTCONFIG_FILE'
  );
  return candidate;
}

function assertReadableFontconfig(file: string, source: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `playwright.config: ${source} points FONTCONFIG_FILE at "${file}", which chromium cannot read. ` +
        'It would print "Fontconfig error: Cannot load default config file" on the browser stderr and ' +
        "render with the host's own AA mode — grayscale on a bare runner, and every baseline then " +
        'fails on text pixels alone. Fix: unset WARSHA_CAPTURE_FONTCONFIG_FILE, or point it at an ' +
        'existing fontconfig file (scripts/ci/capture-fontconfig.conf is the repo pin).'
    );
  }
  if (!text.includes('<fontconfig>')) {
    throw new Error(
      `playwright.config: ${source} points FONTCONFIG_FILE at "${file}", which contains no <fontconfig> element`
    );
  }
}

/** The environment the browser processes start with: the validated AA pin on Linux, the inherited env elsewhere. */
function browserEnv(): Record<string, string> {
  // process.env is typed with `undefined` values, and Playwright's `env` wants plain strings;
  // copying entry by entry drops the impossible ones instead of casting the whole object.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const pin = resolveCaptureFontconfig();
  if (pin !== undefined) env.FONTCONFIG_FILE = pin;
  return env;
}
export default defineConfig({
  globalSetup: './apps/desktop/e2e/support/global-setup.ts',
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
      // A layout check that tolerates drift is not a layout check. `maxDiffPixelRatio: 0` means a
      // single structurally different pixel fails the case; `threshold: 0.05` (~13/255 per pixel)
      // tolerates antialiasing noise up to the measured maximum (11 levels, 10-38 px, on curved and
      // shadowed edges, random per capture — PROGRESS.md 2026-11-04 #45). A moved edge or a shifted
      // line differs by far more than 13 levels and still fails.
      maxDiffPixelRatio: 0,
      threshold: 0.05,
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
    launchOptions: {
      env: browserEnv(),
    },
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
