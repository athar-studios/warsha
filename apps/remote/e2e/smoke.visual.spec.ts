// @warsha/remote — the smoke check for the PWA.
//
// The remote app is the small surface: a dashboard of runs and gates for the phone. It shares
// `@warsha/ui` (components + tokens) and `@warsha/i18n` with the desktop app, so the point of these
// cases is that the shared design system really is applied here too — the same invariants as the
// desktop suite, on the app's one screen, in both locales and both themes.
//
// There is no daemon behind the remote app and no Tauri shell in front of it: it renders from its
// own state, which is why this file needs no stub at all.
import { expect, test } from '@playwright/test';

import {
  auditIsClean,
  auditLayout,
  describeAudit,
  LOCALES,
  THEMES,
  VIEWPORTS,
  type Locale,
  type Theme,
} from '../../desktop/e2e/support/layout';

/** The remote app's root element (`apps/remote/src/App.tsx`). */
const ROOT = '.app';

/** The phone viewport is the one this app exists for; the wide one proves it does not break. */
const VIEWPORT = VIEWPORTS[1];

/** Zero out motion, exactly as the desktop harness does, so a screenshot is comparable. */
const NO_MOTION_CSS = `
  *, *::before, *::after {
    animation: none !important;
    animation-duration: 0s !important;
    transition: none !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
`;

/**
 * Open the remote app with a pinned locale and theme.
 *
 * The app reads both preferences from `localStorage` before the first paint (`warsha.locale`,
 * `warsha.theme`), so writing them in an init script is enough to choose the case.
 */
async function openRemote(
  page: import('@playwright/test').Page,
  locale: Locale,
  theme: Theme
): Promise<void> {
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  // The remote app pulls the same remote font as the desktop app; the fallback stack must render.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  await page.addInitScript(
    ({ locale: chosenLocale, theme: chosenTheme }: { locale: string; theme: string }) => {
      window.localStorage.setItem('warsha.locale', chosenLocale);
      window.localStorage.setItem('warsha.theme', chosenTheme);
    },
    { locale, theme }
  );

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: NO_MOTION_CSS });
  await page.locator(ROOT).waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const locale of LOCALES as readonly Locale[]) {
  for (const theme of THEMES as readonly Theme[]) {
    const name = `${VIEWPORT.name} ${locale} ${theme}`;

    test(`tokens and layout are sound: ${name}`, async ({ page }) => {
      await openRemote(page, locale, theme);

      const audit = await auditLayout(page, ROOT, theme);
      expect(auditIsClean(audit), `layout problems:\n${describeAudit(audit)}`).toBe(true);

      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    });

    test(`matches its baseline: ${name}`, async ({ page }) => {
      await openRemote(page, locale, theme);
      await expect(page).toHaveScreenshot(`remote-${VIEWPORT.name}-${locale}-${theme}.png`);
    });
  }
}

test('the language switch actually switches the catalog', async ({ page }) => {
  await openRemote(page, 'ar', 'light');

  // Arabic first: the tagline is the catalog's Arabic copy.
  await expect(page.locator(ROOT)).toContainText('مصنع برمجيات');

  await page.getByTestId('remote-language-en').click();

  // English after the switch — the proof that the shared catalog reaches this app too.
  await expect(page.locator(ROOT)).toContainText('Arabic-first AI software factory');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
