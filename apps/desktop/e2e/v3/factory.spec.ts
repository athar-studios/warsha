// apps/desktop/e2e/v3/factory.spec.ts
import { test, expect } from '@playwright/test';

import { openV3, act, expectRpc, auditViewportFit, describeViewportFit, viewportFitIsClean } from './support';

test('Factory floor renders the schematic with its stations', async ({ page }) => {
  await openV3(page, '/factory', { lang: 'en' });
  await expect(page.getByTestId('factory-page')).toBeVisible();
  await expect(page.getByTestId('factory-owner-corner')).toBeVisible();
});

test('factory.stop_all cancels active runs through the daemon', async ({ page }) => {
  await openV3(page, '/factory', { lang: 'en' });
  await act(page, 'factory.stop.all');
  await expectRpc(page, 'runs.cancel');
});

test('factory.view.toggle switches to the list view', async ({ page }) => {
  await openV3(page, '/factory', { lang: 'en' });
  await page.locator('[data-action="factory.view.toggle"]').click();
  await expect(page.getByTestId('factory-list-view')).toBeVisible();
});

test('factory.agent.view opens the panel', async ({ page }) => {
  await openV3(page, '/factory', { lang: 'en' });
  await act(page, 'factory.agent.view');
  await expect(page.getByTestId('factory-agent-panel')).toBeVisible();
});

test('frame.mode.factory: navigates to factory', async ({ page }) => {
  await openV3(page, '/', { lang: 'en' });
  await act(page, 'frame.mode.factory');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'factory');
});

test.describe('Factory visual baselines (@visual)', () => {
  const VIEWPORTS = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
  ];
  const LOCALES = ['ar', 'en'];
  const THEMES = ['light', 'dark'] as const;

  for (const vp of VIEWPORTS) {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        test(`@visual factory-ready-${vp.name}-${locale}-${theme}`, async ({ page }) => {
          await openV3(page, '/factory', { viewport: { width: vp.width, height: vp.height }, lang: locale, theme });
          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(`factory-ready-${vp.name}-${locale}-${theme}.png`);
        });
      }
    }
  }
});
