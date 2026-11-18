// apps/desktop/e2e/v3/factory.spec.ts
// E3: the Factory floor through the repo harness (openV3), one case per
// registered action id. The harness fixture runs are stub runs; the floor
// renders an empty state unless the harness reports active runs.
import { test, expect } from '@playwright/test';

import { openV3, act, expectRpc } from './support';

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

test('factory.agent.view opens the panel for a floor marker', async ({ page }) => {
  await openV3(page, '/factory', { lang: 'en' });
  const marker = page.getByTestId(/^factory-agent-/).first();
  const count = await marker.count();
  test.skip(count === 0, 'no active agents in the harness fixture');
  await marker.click();
  await expect(page.getByTestId('factory-agent-panel')).toBeVisible();
});
