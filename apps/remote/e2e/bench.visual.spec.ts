// @warsha/remote — the phone's bench, photographed and measured in every state.
//
// Three things per case, in one pass:
//
//   1. the daemon was really reached (`rpc`), with the app's own bearer token, and nothing the stub
//      does not model slipped through;
//   2. the geometry, the paint and the accessibility are clean — the same shared audits the desktop
//      matrix runs (`auditLayout`, `auditClipping`, `runAxe`, `auditUsedFonts`), on the widths §10
//      gives this app a different shape at;
//   3. the screenshot matches its baseline, `maxDiffPixelRatio: 0`.
//
// The unpaired case is in here too, because it is the screen a real owner sees first: a device with no
// session, showing the pairing plate rather than an invented bench.
//
// The token that pairs the phone is a test secret and it is asserted *off* the screen and *out* of the
// address in every case — a screenshot with a bearer token in its URL bar is a leak with a nice layout.
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
  runAxe,
  THEMES,
  type Locale,
  type ScenarioId,
  type Theme,
} from '../../desktop/e2e/harness';
import { openRemote, REMOTE_SCREENS, REMOTE_SECRETS } from './harness';

/** The §7 states the phone is built to answer, and the screen that owns each one. */
type RemoteState = ScenarioId | 'unpaired';

const STATE_CASES: readonly { screen: 'needs-you' | 'gates'; scenario: RemoteState }[] = [
  { screen: 'needs-you', scenario: 'unpaired' },
  { screen: 'needs-you', scenario: 'empty' },
  { screen: 'needs-you', scenario: 'error' },
  { screen: 'needs-you', scenario: 'offline' },
  { screen: 'needs-you', scenario: 'permission' },
  { screen: 'needs-you', scenario: 'dense' },
  { screen: 'gates', scenario: 'empty' },
  { screen: 'gates', scenario: 'dense' },
];

for (const screen of REMOTE_SCREENS) {
  for (const viewport of screen.viewports) {
    for (const locale of LOCALES as readonly Locale[]) {
      for (const theme of THEMES as readonly Theme[]) {
        const name = `${screen.id} ${viewport.name} ${locale} ${theme}`;

        test(name, async ({ page }) => {
          const stubs = await openRemote(page, { screen: screen.id, viewport, locale, theme });

          expect(stubs.unimplemented, 'the app called an RPC the harness does not stub').toEqual([]);
          expect(stubs.unauthorized, 'an RPC went out without the client bearer token').toBe(0);
          expect(
            stubs.rpcMethods,
            `${name}: the screen never called ${screen.rpc.join(', ')}`
          ).toEqual(expect.arrayContaining([...screen.rpc]));

          const layout = await auditLayout(page, screen.root, theme);
          expect.soft(auditIsClean(layout), `layout problems:\n${describeAudit(layout)}`).toBe(true);

          const clips = await auditClipping(page, screen.root);
          expect.soft(clipsAreClean(clips), `clipped text:\n${describeClips(clips)}`).toBe(true);

          const fonts = await auditUsedFonts(page, screen.root);
          expect
            .soft(fonts.problems, `not drawn with the design's fonts:\n${describeFonts(fonts)}\n${FONT_INSTALL_HINT}`)
            .toEqual([]);

          const axe = await runAxe(page);
          expect
            .soft(axe.violations.map((finding) => `${finding.id}: ${finding.nodes[0] ?? ''}`), 'axe WCAG AA violations')
            .toEqual([]);

          // The document declares what it renders, or an Arabic screen is lying to a screen reader.
          await expect.soft(page.locator('html')).toHaveAttribute('lang', locale);
          await expect.soft(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

          // A session token never reaches the page or the address bar.
          const body = await page.locator('body').innerText();
          const address = page.url();
          for (const secret of REMOTE_SECRETS) {
            expect(body, 'a pairing secret reached the screen').not.toContain(secret);
            expect(address, 'a pairing secret stayed in the address').not.toContain(secret);
          }

          test.info().annotations.push({
            type: 'axe',
            description: `${name}: ${axe.violations.length} AA violation(s), ${axe.passed} checks passed, ${axe.inapplicable} not applicable`,
          });

          await expect(page).toHaveScreenshot(`${screen.id}-${viewport.name}-${locale}-${theme}.png`);
        });
      }
    }
  }
}

for (const stateCase of STATE_CASES) {
  const screen = REMOTE_SCREENS.find((candidate) => candidate.id === stateCase.screen);
  if (screen === undefined) throw new Error(`no remote screen is named "${stateCase.screen}"`);
  const unpaired = stateCase.scenario === 'unpaired';
  const scenario = unpaired ? 'default' : stateCase.scenario;

  {
    const viewport = screen.viewports[0];
    for (const locale of LOCALES as readonly Locale[]) {
      for (const theme of THEMES as readonly Theme[]) {
        const name = `${screen.id} ${stateCase.scenario} ${viewport.name} ${locale} ${theme}`;

        test(name, async ({ page }) => {
          const stubs = await openRemote(page, {
            screen: screen.id,
            viewport,
            locale,
            theme,
            scenario,
            unpaired,
          });

          expect(stubs.unauthorized).toBe(0);
          if (unpaired) {
            // A device with nothing to authenticate has nothing to ask — and it must not pretend.
            expect(stubs.rpcMethods, 'an unpaired phone still talked to a daemon').toEqual([]);
            await expect(page.locator('[data-testid="remote-pair-submit"]')).toBeVisible();
          } else {
            expect(stubs.rpcMethods.length, `${name}: the screen never reached the daemon`).toBeGreaterThan(0);
          }

          const layout = await auditLayout(page, screen.root, theme);
          expect.soft(auditIsClean(layout), `layout problems:\n${describeAudit(layout)}`).toBe(true);

          const clips = await auditClipping(page, screen.root);
          expect.soft(clipsAreClean(clips), `clipped text:\n${describeClips(clips)}`).toBe(true);

          const fonts = await auditUsedFonts(page, screen.root);
          expect.soft(fonts.problems, `not drawn with the design's fonts:\n${describeFonts(fonts)}`).toEqual([]);

          const axe = await runAxe(page);
          expect
            .soft(axe.violations.map((finding) => `${finding.id}: ${finding.nodes[0] ?? ''}`), 'axe WCAG AA violations')
            .toEqual([]);

          await expect(page).toHaveScreenshot(
            `${screen.id}-${stateCase.scenario}-${viewport.name}-${locale}-${theme}.png`
          );
        });
      }
    }
  }
}
