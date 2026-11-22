// apps/desktop/e2e/v3/developers.spec.ts
// E4: the Developers screen through the repo harness (openV3), one case per
// registered action id. The stub sessions.list answers one parent session and
// one swarm child for `run-code` (apps/desktop/e2e/harness.ts), so every figure
// here is a fixture value.
import { test, expect } from '@playwright/test';

import { openV3, act, expectRpc, auditViewportFit, describeViewportFit, viewportFitIsClean } from './support';

test('Developers screen lists the fixture sessions with real figures', async ({ page }) => {
  await openV3(page, '/developers', { lang: 'en' });

  await expect(page.getByTestId('developers-page')).toBeVisible();
  await expect(page.getByTestId('developers-row')).toHaveCount(2);
  // The parent row and its swarm child are grouped.
  await expect(page.getByTestId('developers-swarm-children')).toBeVisible();
  // Column cells carry the fixture values.
  await expect(page.getByTestId('developers-cell-role').first()).toHaveText('coder');
});

test('developers.list.refresh re-reads sessions', async ({ page }) => {
  await openV3(page, '/developers', { lang: 'en' });
  await act(page, 'developers.list.refresh');
  await expectRpc(page, 'sessions.list');
});

test('developers.detail.nav opens the session detail', async ({ page }) => {
  await openV3(page, '/developers', { lang: 'en' });
  await page.getByTestId('developers-row').first().click();
  await expect(page.getByTestId('developers-detail')).toBeVisible();
  await expect(page.getByTestId('developers-detail-stats')).toBeVisible();
});

test('developers.session.stop asks the daemon to stop the right session', async ({ page }) => {
  await openV3(page, '/developers', { lang: 'en' });
  await page.getByTestId('developers-row').first().click();
  await act(page, 'developers.session.stop');
  await expectRpc(page, 'sessions.stop');
});

test('developers.session.view links to the code viewer', async ({ page }) => {
  await openV3(page, '/developers', { lang: 'en' });
  await page.getByTestId('developers-row').first().click();
  await expect(page.locator('[data-action="developers.session.view"]').first()).toBeVisible();
  await page.locator('[data-action="developers.session.view"]').first().click();
  await expect(page).toHaveURL(/code/);
});

test('developers.receipt.export builds the receipt document', async ({ page }) => {
  await openV3(page, '/developers', { lang: 'en' });
  await expect(page.locator('[data-action="developers.receipt.export"]')).toBeVisible();
  await page.locator('[data-action="developers.receipt.export"]').click();
  // The blob download path exercised the export build (errors would surface in the banner).
  await expect(page.getByTestId('developers-error')).toHaveCount(0);
});

test.describe('Developers visual baselines (@visual)', () => {
  const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const LOCALES = ['ar', 'en'];
  const THEMES = ['light', 'dark'] as const;

  for (const vp of VIEWPORTS) {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        test(`@visual developers-ready-${vp.name}-${locale}-${theme}`, async ({ page }) => {
          await openV3(page, '/developers', { viewport: { width: vp.width, height: vp.height }, lang: locale, theme });
          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(`developers-ready-${vp.name}-${locale}-${theme}.png`);
        });

        test(`@visual developers-detail-${vp.name}-${locale}-${theme}`, async ({ page }) => {
          await openV3(page, '/developers', { viewport: { width: vp.width, height: vp.height }, lang: locale, theme });
          await page.getByTestId('developers-row').first().click();
          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(`developers-detail-${vp.name}-${locale}-${theme}.png`);
        });
      }
    }
  }
});
