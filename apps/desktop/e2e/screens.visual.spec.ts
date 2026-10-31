// @warsha/desktop — the visual check: every main screen, in every state the owner can be in.
//
// 14 screens and first-run wizard states × 2 viewports × 2 locales × 2 themes = 112 cases, each of
// which:
//
//   1. measures the page (`auditLayout`) and fails on an undefined `var(--warsha-…)`, a body or
//      screen root without a resolved colour/background, horizontal scrolling, an element wider than
//      the viewport, text with no box, or two allow-listed sibling blocks whose boxes intersect;
//   2. asserts the stubs were actually used — every screen names the RPCs it must have called, so a
//      screen that silently rendered nothing, or that never reached the daemon, cannot produce a
//      passing baseline;
//   3. compares the screenshot with its stored baseline, `maxDiffPixelRatio: 0`.
//
// The baselines were generated with `pnpm visual:update` on Linux chromium, in the same place these
// checks run. Regenerate them only for an intended visual change — a diff is the point of the check.
import { expect, test } from '@playwright/test';

import {
  auditIsClean,
  auditLayout,
  describeAudit,
  LOCALES,
  openScreen,
  SCREENS,
  THEMES,
  VIEWPORTS,
  type Locale,
  type Theme,
} from './harness';

/** Cases accumulate problems here, so one failure names everything wrong with that screen. */
for (const screen of SCREENS) {
  for (const viewport of VIEWPORTS) {
    for (const locale of LOCALES as readonly Locale[]) {
      for (const theme of THEMES as readonly Theme[]) {
        const name = `${screen.id} ${viewport.name} ${locale} ${theme}`;

        test(`layout is sound: ${name}`, async ({ page }) => {
          const stubs = await openScreen(page, { screen: screen.id, viewport, locale, theme });

          // The stubs prove the screen had its data: a request without the client's own bearer token
          // would mean the app was not really driven, and a method with no stub means the case is
          // measuring a screen that never reached the daemon.
          expect(stubs.unimplemented, 'the app called an RPC the harness does not stub').toEqual([]);
          expect(stubs.unauthorized, 'an RPC went out without the client bearer token').toBe(0);
          expect(
            stubs.rpcMethods,
            `${screen.id} never called ${screen.rpc.join(', ')}`
          ).toEqual(expect.arrayContaining([...screen.rpc]));

          const audit = await auditLayout(page, screen.root, theme);
          expect(auditIsClean(audit), `layout problems:\n${describeAudit(audit)}`).toBe(true);

          // The document's language declaration must match the case: a screen that renders English
          // copy inside `<html dir="rtl">` is broken in a way a screenshot alone cannot name.
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

          // The one way copy regresses without moving a pixel: a missing catalog entry renders its
          // key (`onboarding.key_title`) instead of the string. The first-run wizard is where that
          // would reach an owner, and `t` falls back to the key rather than failing.
          await expect(page.locator(screen.root)).not.toContainText(/onboarding\.[a-z_]+/);
        });

        test(`matches its baseline: ${name}`, async ({ page }) => {
          await openScreen(page, { screen: screen.id, viewport, locale, theme });

          await expect(page).toHaveScreenshot(`${screen.id}-${viewport.name}-${locale}-${theme}.png`);
        });
      }
    }
  }
}
