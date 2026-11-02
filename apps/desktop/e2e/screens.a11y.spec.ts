// @warsha/desktop — the accessibility gate: axe WCAG 2.1 AA and the keyboard, on every screen.
//
// Two things a screenshot cannot tell you, checked in a real browser on the phone width and the
// reference desktop width (the two shapes §10 puts every screen in) for both locales and both themes:
//
//   * **axe-core**, run over the whole document with the WCAG 2.0/2.1 A + AA rule tags. Zero
//     violations is the gate. `best-practice` findings and rules axe could not decide are attached to
//     the case as annotations, so they land in the evidence file instead of being switched off — an
//     audit that hides its own uncertain results is not an audit.
//   * **the keyboard**, walked with real Tab presses from a blurred document. Every stop must draw a
//     focus ring, must be inside the viewport, and must be the thing at its own hit-test point — which
//     is how a sticky composer or a decision bar covering a control is caught rather than admired.
//
// The runs are the same deterministic pages the visual suite photographs: same stubs, same frozen
// clock, same reduced motion. A violation found here is a violation an owner meets.
import { expect, test } from '@playwright/test';

import {
  auditFocusWalk,
  auditUsedFonts,
  describeAxe,
  describeAxeReport,
  describeFocus,
  describeFonts,
  focusIsClean,
  LOCALES,
  openScreen,
  runAxe,
  SCREENS,
  THEMES,
  viewportsNamed,
} from './harness';
import type { Locale, Theme } from './harness';

/** The two shapes every screen is measured in: the phone, and the reference desktop. */
const A11Y_VIEWPORTS = viewportsNamed(['390x844', '1440x900']);

for (const screen of SCREENS) {
  for (const viewport of A11Y_VIEWPORTS) {
    for (const locale of LOCALES as readonly Locale[]) {
      for (const theme of THEMES as readonly Theme[]) {
        const name = `${screen.id} ${viewport.name} ${locale} ${theme}`;

        test(`axe AA is clean and the keyboard reaches everything: ${name}`, async ({ page }) => {
          await openScreen(page, { screen: screen.id, viewport, locale, theme });

          const axe = await runAxe(page);
          expect.soft(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

          const focus = await auditFocusWalk(page);
          expect.soft(focusIsClean(focus), `focus problems:\n${describeFocus(focus)}`).toBe(true);
          expect.soft(focus.stops.length, 'the walk found nothing to tab through').toBeGreaterThan(0);

          // Reported, never gating — see the header.
          test.info().annotations.push(
            {
              type: 'axe',
              description: `${name}: ${axe.violations.length} AA violation(s), ${axe.passed} checks passed, ${axe.inapplicable} not applicable`,
            },
            { type: 'axe-report', description: `${name}: ${describeAxeReport(axe)}` },
            {
              type: 'keyboard',
              description: `${name}: ${focus.stops.length} tab stops, first is ${focus.first ?? '(none)'}`,
            },
            {
              type: 'fonts',
              description: `${name}: ${describeFonts(await auditUsedFonts(page, screen.root)) || 'all drawn with the design faces'}`,
            }
          );
        });
      }
    }
  }
}

/**
 * The §4 regions, as the accessibility tree really exposes them.
 *
 * B3-remote left one question for a real browser: a `Panel` is a `<section>` with a header rule inside
 * it, and a `<header>` is a `banner` landmark *only* when it is not inside sectioning content. So this
 * counts the banners on a bench full of panels: exactly one — the top bar — and every plate a named
 * region. A gate card that announced itself as a banner, or a panel header that stole the landmark,
 * fails here rather than in a screen reader six months from now.
 *
 * The wizard is in the same check because B4 found its whole tree outside every landmark
 * (`landmark-one-main`, `region`) and fixed it in `App.tsx`: an owner arriving for the first time is
 * the one time they need somewhere to jump to.
 */
for (const theme of THEMES as readonly Theme[]) {
  test(`the bench's landmarks are the §4 regions (${theme})`, async ({ page }) => {
    await openScreen(page, {
      screen: 'simple',
      viewport: A11Y_VIEWPORTS[1],
      locale: 'ar',
      theme,
    });

    await expect.soft(page.getByRole('banner'), 'the top bar is the one banner').toHaveCount(1);
    await expect.soft(page.getByRole('main'), 'the screen lives in one main region').toHaveCount(1);

    const regions = page.getByRole('region');
    const count = await regions.count();
    expect.soft(count, 'a bench of plates exposes no named region to a screen reader').toBeGreaterThan(0);
    const unnamed = await regions.evaluateAll((elements) =>
      elements.filter((element) => (element.getAttribute('aria-label') ?? '').trim() === '').length
    );
    expect.soft(unnamed, 'a `Panel` is only a region when it is named').toBe(0);
  });

  test(`the first-run wizard is inside the bench's landmark (${theme})`, async ({ page }) => {
    await openScreen(page, {
      screen: 'onboarding-language',
      viewport: A11Y_VIEWPORTS[1],
      locale: 'ar',
      theme,
    });

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('main')).toContainText(/./);
  });
}
