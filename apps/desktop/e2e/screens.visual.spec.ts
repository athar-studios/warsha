// @warsha/desktop — the visual check: every screen, in every state the owner can be in.
//
// 23 screens and first-run wizard states × the widths REDESIGN §10 gives each of them a different
// shape at × two locales × two themes, each of which:
//
//   1. proves the screen really reached its daemon — every screen names the RPCs it must have called,
//      so a screen that silently rendered nothing, or that never got past the stub, cannot produce a
//      passing baseline;
//   2. measures the page (`auditLayout`) and fails on an undefined `var(--warsha-…)`, a body or screen
//      root without a resolved colour/background, horizontal scrolling, an element wider than the
//      viewport, text with no box, or two allow-listed sibling blocks whose boxes intersect;
//   3. measures the paint (`auditClipping`) and fails on text cut by its own box with nothing
//      naming the full value — §11 lets a ledger truncate only when `title` says the whole thing;
//   4. measures the fonts (`auditUsedFonts`) and fails if chromium laid the page out with anything
//      other than IBM Plex Sans Arabic and IBM Plex Mono — §14's open caveat, closed here;
//   5. checks the document's own declarations (`lang`/`dir`) and that no catalog key leaked onto
//      the screen as text;
//   6. compares the screenshot with its stored baseline, `maxDiffPixelRatio: 0`.
//
// The assertions are `expect.soft` where they can be: one run of one screen then names everything
// wrong with it instead of stopping at the first, which is what makes a failing matrix readable.
//
// The baselines were generated with `pnpm visual:update` on Linux chromium in the same place these
// checks run. Regenerate them only for an intended visual change — a diff is the point of the check.
import { expect, test } from '@playwright/test';

import {
  auditClipping,
  auditIsClean,
  auditLayout,
  auditUsedFonts,
  clipsAreClean,
  describeAudit,
  describeClips,
  describeFonts,
  FONT_INSTALL_HINT,
  LOCALES,
  openScreen,
  requiredRpc,
  SCREENS,
  THEMES,
} from './harness';
import type { Locale, Theme } from './harness';

for (const screen of SCREENS) {
  for (const viewport of screen.viewports) {
    for (const locale of LOCALES as readonly Locale[]) {
      for (const theme of THEMES as readonly Theme[]) {
        const name = `${screen.id} ${viewport.name} ${locale} ${theme}`;

        test(name, async ({ page }) => {
          const stubs = await openScreen(page, { screen: screen.id, viewport, locale, theme });

          // 1. The stubs prove the screen had its data: a request without the client's own bearer token
          // would mean the app was not really driven, and a method with no stub means the case is
          // measuring a screen that never reached the daemon.
          expect(stubs.unimplemented, 'the app called an RPC the harness does not stub').toEqual([]);
          expect(stubs.unauthorized, 'an RPC went out without the client bearer token').toBe(0);
          expect(
            stubs.rpcMethods,
            `${screen.id} never called ${requiredRpc(screen).join(', ')}`
          ).toEqual(expect.arrayContaining([...requiredRpc(screen)]));

          // 2. The box geometry.
          const layout = await auditLayout(page, screen.root, theme);
          expect.soft(auditIsClean(layout), `layout problems:\n${describeAudit(layout)}`).toBe(true);

          // 3. Nothing cut off with no way to read it.
          const clips = await auditClipping(page, screen.root);
          expect.soft(clipsAreClean(clips), `clipped text:\n${describeClips(clips)}`).toBe(true);

          // 4. The pixels are the design's own metrics.
          const fonts = await auditUsedFonts(page, screen.root);
          expect.soft(fonts.problems, `not drawn with the design's fonts:\n${describeFonts(fonts)}\n${FONT_INSTALL_HINT}`).toEqual(
            []
          );

          // 5. The document's language declaration must match the case: a screen that renders English
          // copy inside `<html dir="rtl">` is broken in a way a screenshot alone cannot name.
          await expect.soft(page.locator('html')).toHaveAttribute('lang', locale);
          await expect.soft(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

          // The one way copy regresses without moving a pixel: a missing catalog entry renders its key
          // (`onboarding.key_title`) instead of the string. Namespaced so a machine identifier like
          // `src/App.tsx` is never mistaken for one.
          const screenText = await page.locator(screen.root).innerText();
          const leakedKey = screenText.match(
            /(?:^|[\s(»"'`])(?<key>(?:onboarding|settings|projects|providers|roles|budgets|devices|simple|advanced|bench|gate|gates|run|routine|routines|crash|store|backend|common|nav|errors|archive|app|remote)\.[a-z_]+)/
          );
          expect
            .soft(leakedKey?.groups?.key ?? null, `a catalog key reached the screen as text:\n${screenText.slice(0, 400)}`)
            .toBeNull();

          // 6. The screenshot.
          await expect(page).toHaveScreenshot(`${screen.id}-${viewport.name}-${locale}-${theme}.png`);
        });
      }
    }
  }
}
