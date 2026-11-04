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

/** Nothing is lit: no gate is the one the run is stopped at, and the queue says so. */
async function expectQuietLamp(page: Page): Promise<void> {
  await expect(page.locator('[data-state="waiting"]')).toHaveCount(0);
}

/**
 * The parked gate is the only lit thing in a four-pending queue, and the only gate with a decision bar.
 *
 * `gates.list` answers all four stages pending (`crates/warshad/src/lib.rs`, `list_gates`), so the inbox
 * shows three names and one request. The counting is locale-free on purpose: `data-tone="lit"` is the chip,
 * `data-gate-action` is the decision bar `GateCard` fastens to each of its three moves, and `data-state` is
 * the lamp's own word — so the case pins the *rule*, not a string the catalog is free to re-vocalise.
 */
async function expectOneParkedGate(page: Page): Promise<void> {
  const inbox = page.locator('.gates-inbox');
  await expect(inbox.locator('[data-tone="lit"]')).toHaveCount(1);
  await expect(inbox.locator('[data-gate-action="approve"]')).toHaveCount(1);
  // The rail row and the card head of the one parked gate; the other three rows carry an idle dot.
  await expect(inbox.locator('[data-state="waiting"]')).toHaveCount(2);
  await expect(inbox.locator('[data-state="idle"]')).toHaveCount(3);
}

/**
 * A queue of gates the run has not reached: named, counted, and asking for nothing.
 *
 * The other half of the parked rule. In this scenario the bench is showing a run standing at
 * `review_qa_security` while the daemon reports two pending gates, so neither of them is the reason the run
 * is not moving and the inbox must not look like it is — no lit chip, no decision bar.
 *
 * Two rail rows, both idle: the count is scoped to the rail (`.warsha-rail-row`) rather than to the
 * whole inbox, because the detail column renders the selected unreached gate as its own idle plate
 * (`UnreachedGate`), which is a second idle lamp telling the same story — counting it would make this
 * assertion depend on which row happens to be selected, and would let one plate hide the other's claim.
 */
async function expectNoDecisionOffered(page: Page): Promise<void> {
  const inbox = page.locator('.gates-inbox');
  await expect(inbox.locator('[data-gate-action="approve"]')).toHaveCount(0);
  await expect(inbox.locator('[data-tone="lit"]')).toHaveCount(0);
  await expect(inbox.locator('.warsha-rail-row [data-state="idle"]')).toHaveCount(2);
}

/**
 * §11's words state: a spend with no ceiling is said in words, never as a formatted zero.
 *
 * The case cannot read the catalog per locale — the table is built at module scope, outside the locale loop
 * — so both shipped spellings of `bench.no_ceiling` are named here, in the two languages the matrix runs.
 */
const NO_CEILING_WORDS = /no ceiling reported|لم يُبلَّغ عن سقف/;

async function expectNoCeilingWords(page: Page): Promise<void> {
  await expect(page.getByText(NO_CEILING_WORDS).first()).toBeVisible();
}

/**
 * A decided card keeps its record and loses the "waiting on you" band.
 *
 * `GateCard` paints the signal band on the card's inline-start unconditionally; the caller that knows a
 * decision exists takes it back to the plate's edge (`QUIET_BAND`, in `GatePlate.tsx` and `GatesInbox.tsx`),
 * which is what the attribute says. The stamp, the acting device and the recorded words are asserted by the
 * quiet lamp above and by the screenshot itself.
 */
async function expectDecidedCardIsQuiet(page: Page): Promise<void> {
  await expectQuietLamp(page);
  const band = await page.locator('.warsha-gate-card').first().getAttribute('style');
  expect(band, 'the decided card still carries the signal band').toMatch(
    /border-inline-start:\s*3px solid var\(--warsha-bench-edge\)/
  );
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
    // Two gates pending on a run standing at `review_qa_security`: neither is why the run waits, so the
    // inbox names them and offers no decision. Round 3's G1 evidence was this capture lighting both of them
    // with a live decision bar (`gates-permission-1440x900-en-light`).
    expect: expectNoDecisionOffered,
  },
  {
    screen: 'gates',
    scenario: 'parked',
    // The state no baseline showed: four stages pending, one of them the stage the run stands on, and that
    // one the only lit plate with a decision bar on the bench.
    expect: expectOneParkedGate,
  },
  {
    screen: 'gates',
    scenario: 'success',
    // Decided is a record, not a request: no waiting lamp and no signal band, stamp and note intact
    // (round 3's G3, `gates-success-390x844-ar-light`).
    expect: expectDecidedCardIsQuiet,
  },
  {
    screen: 'budgets',
    scenario: 'no-ceiling',
    // Round 3's G4: `bench.no_ceiling` shipped on five surfaces and appeared in no baseline, because every
    // scenario answered a 1200-cent ceiling. The ledger row is the copy's own surface.
    expect: expectNoCeilingWords,
  },
  {
    screen: 'projects',
    scenario: 'no-ceiling',
    expect: expectNoCeilingWords,
  },
  {
    screen: 'simple',
    scenario: 'no-ceiling',
    // The instrument strip's budget item, which is the surface the words were written for and the one a
    // list screen never reaches (G6 keeps the disagreement itself open).
    expect: expectNoCeilingWords,
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
