// @warsha/desktop — REDESIGN §7's states, produced by the daemon and checked in a browser.
//
// A state is not a CSS class this suite paints and photographs: each one is what the stubbed daemon
// does (answers nothing, answers late, refuses, is not there at all), and the screen's own code
// decides what that looks like. That is the difference between testing §7 and decorating it.
//
// Every case runs the same audits the main matrix does — box geometry, clipping, WCAG AA — because a
// state is exactly where a design usually breaks: the error banner nobody checked the contrast of, the
// skeleton that overflows at 320, the long Arabic name no catalog entry was measured against.
//
// The dense scenario is §11's stress: the longest strings the owner can type and the mixed-direction
// identifiers a bidi algorithm scrambles. A truncating ledger row is allowed only when something names
// the full value, so the clip pass is the assertion that matters most here.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  auditClipping,
  auditIsClean,
  auditLayout,
  auditUsedFonts,
  clipsAreClean,
  describeAudit,
  describeClips,
  describeFonts,
  LOCALES,
  openScreen,
  runAxe,
  scenarioById,
  screenCase,
  THEMES,
  viewportsNamed,
} from './harness';
import type { Locale, ScreenId, ScenarioId, Theme } from './harness';

/** One state, the screen that owns it, and what must be true when the screen shows it. */
interface StateCase {
  screen: ScreenId;
  scenario: ScenarioId;
  /**
   * The root to measure and photograph.
   *
   * Defaults to the screen's own anchor. It is overridden where the state moves the shell — offline,
   * the one state the start-up read decides rather than the deep link, leaves the bench on the board
   * the shell falls back to, so the whole bench is what has to be measured.
   */
  root?: string;
  /** The selector the case waits for; the root when absent. */
  ready?: string;
  /** What §7 promises about this state, said as a locator that has to exist. */
  expect: (page: Page) => Promise<void>;
}

/** The widths §10 gives a different shape: the phone and the reference desktop. */
const STATE_VIEWPORTS = viewportsNamed(['320x568', '390x844', '1440x900']);

/** §7's rule for the error state: the problem is named and a next action sits beside it. */
async function expectAlert(page: Page): Promise<void> {
  await expect(page.locator('[role="alert"]').first()).toBeVisible();
  await expect(page.getByRole('button').first()).toBeVisible();
}

/** §7's rule for offline: it is said quietly, as a status, and the queue is not implied lost. */
async function expectStatus(page: Page): Promise<void> {
  await expect(page.locator('[role="status"]').first()).toBeVisible();
}

/** §1's lamp semantics: a pending gate is the one thing on the bench that is lit. */
async function expectLitLamp(page: Page): Promise<void> {
  await expect(page.locator('[data-state="waiting"]').first()).toBeVisible();
}

/** The same, decided: nothing is lit, and the queue says so. */
async function expectQuietLamp(page: Page): Promise<void> {
  await expect(page.locator('[data-state="waiting"]')).toHaveCount(0);
}

/**
 * The cases, mapped to the screen that *owns* each state.
 *
 * B4's first cut put `gates error` on the gates inbox and it timed out — not because the screen is
 * broken, but because the scenario that refuses `runs.list` also takes the run selection away, and the
 * shell then renders the screen it falls back to. That is the start-up's job, not the inbox's. A
 * screen-level state belongs on a screen that reads its own list: roles, devices, crash reports, store
 * reviews, providers. The daemon-wide states (nothing answering, nothing in it) stay on the bench.
 */
export const STATE_CASES: readonly StateCase[] = [
  {
    screen: 'projects',
    scenario: 'empty',
    // §7: an empty state is one useful next step as a real button, never a dead illustration.
    expect: async (page) => {
      await expect(page.getByRole('button').first()).toBeVisible();
    },
  },
  {
    screen: 'projects',
    scenario: 'loading',
    root: '.bench',
    ready: '.bench',
    expect: expectStatus,
  },
  {
    screen: 'simple',
    scenario: 'offline',
    root: '.bench',
    ready: '.bench-strip',
    expect: expectStatus,
  },
  {
    screen: 'providers',
    scenario: 'error',
    expect: expectAlert,
  },
  {
    screen: 'roles',
    scenario: 'error',
    expect: expectAlert,
  },
  {
    screen: 'devices',
    scenario: 'error',
    expect: expectAlert,
  },
  {
    screen: 'crash-reports',
    scenario: 'error',
    expect: expectAlert,
  },
  {
    screen: 'store-reviews',
    scenario: 'error',
    expect: expectAlert,
  },
  {
    screen: 'crash-reports',
    scenario: 'screen-loading',
    expect: expectStatus,
  },
  {
    screen: 'store-reviews',
    scenario: 'screen-loading',
    expect: expectStatus,
  },
  {
    screen: 'devices',
    scenario: 'screen-loading',
    expect: expectStatus,
  },
  {
    screen: 'gates',
    scenario: 'permission',
    expect: expectLitLamp,
  },
  {
    screen: 'gates',
    scenario: 'success',
    expect: expectQuietLamp,
  },
  {
    screen: 'projects',
    scenario: 'dense',
    expect: async (page) => {
      await expect(page.locator('.projects-board')).toBeVisible();
    },
  },
  {
    screen: 'simple',
    scenario: 'dense',
    expect: async (page) => {
      await expect(page.locator('.simple-mode')).toBeVisible();
    },
  },
  {
    screen: 'store-reviews',
    scenario: 'dense',
    expect: async (page) => {
      await expect(page.locator('[data-testid="store-reviews"]')).toBeVisible();
    },
  },
  {
    screen: 'crash-reports',
    scenario: 'dense',
    expect: async (page) => {
      await expect(page.locator('[data-testid="crash-reports"]')).toBeVisible();
    },
  },
];

for (const stateCase of STATE_CASES) {
  const scenario = scenarioById(stateCase.scenario);
  const measuredRoot = stateCase.root ?? screenCase(stateCase.screen).root;

  for (const viewport of STATE_VIEWPORTS) {
    for (const locale of LOCALES as readonly Locale[]) {
      for (const theme of THEMES as readonly Theme[]) {
        const name = `${stateCase.screen} ${scenario.id} ${viewport.name} ${locale} ${theme}`;

        test(name, async ({ page }) => {
          const stubs = await openScreen(page, {
            screen: stateCase.screen,
            viewport,
            locale,
            theme,
            scenario: scenario.id,
            ready: stateCase.ready,
          });

          // The state is the daemon's answer, so the case is only real if the call went out. A
          // transport failure counts as a call: `rpcMethods` records what the client tried.
          expect(stubs.unauthorized, 'an RPC went out without the client bearer token').toBe(0);
          if (scenario.settle === 'settled') {
            expect(stubs.rpcMethods.length, `${name}: the screen never reached the daemon`).toBeGreaterThan(
              0
            );
          }

          // §7's promise, said as something on the screen rather than as a colour in a picture.
          await stateCase.expect(page);

          const layout = await auditLayout(page, measuredRoot, theme);
          expect.soft(auditIsClean(layout), `layout problems:\n${describeAudit(layout)}`).toBe(true);

          const clips = await auditClipping(page, measuredRoot);
          expect.soft(clipsAreClean(clips), `clipped text:\n${describeClips(clips)}`).toBe(true);

          const fonts = await auditUsedFonts(page, measuredRoot);
          expect.soft(fonts.problems, `not drawn with the design's fonts:\n${describeFonts(fonts)}`).toEqual([]);

          const axe = await runAxe(page);
          expect.soft(
            axe.violations.map((finding) => `${finding.id}: ${finding.nodes[0] ?? ''}`),
            `axe found WCAG AA violations in the ${scenario.id} state`
          ).toEqual([]);

          test.info().annotations.push({
            type: 'state',
            description: `${name}: ${scenario.note} (axe ${axe.violations.length} violation(s), ${axe.passed} checks passed)`,
          });

          await expect(page).toHaveScreenshot(
            `${stateCase.screen}-${scenario.id}-${viewport.name}-${locale}-${theme}.png`
          );
        });
      }
    }
  }
}
