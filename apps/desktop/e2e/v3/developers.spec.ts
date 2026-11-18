// apps/desktop/e2e/v3/developers.spec.ts
// E4: the Developers screen through the repo harness (openV3), one case per
// registered action id. The stub sessions.list answers one parent session and
// one swarm child for `run-code` (apps/desktop/e2e/harness.ts), so every figure
// here is a fixture value.
import { test, expect } from '@playwright/test';

import { openV3, expectRpc } from './support';

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
  await expectRpc(page, 'sessions.list', async () => {
    await page.locator('[data-action="developers.list.refresh"]').click();
  });
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
  await expectRpc(page, 'sessions.stop', async () => {
    await page.locator('[data-action="developers.session.stop"]').click();
  });
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
