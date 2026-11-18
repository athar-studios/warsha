// apps/desktop/e2e/v3/permissions.spec.ts
import { test, expect } from '@playwright/test';
import { openV3, act, expectRpc } from './support';

test.describe('Permissions v3', () => {
  test('settings: default permissions show', async ({ page }) => {
    await openV3(page, '/settings/permissions', { lang: 'en' });
    
    await expect(page.getByTestId('settings-permissions-default-confinement')).toBeVisible();
    await expect(page.getByTestId('settings-permissions-default-approval')).toBeVisible();
    
    await expect(page.getByTestId('settings-permissions-honest-copy')).toBeVisible();
  });

  test('project override: open project permissions', async ({ page }) => {
    // Navigate to a project, open sheet
    await openV3(page, '/projects/1', { lang: 'en' });
    await expect(page.locator('[data-action="project.permissions.open"]')).toBeVisible();
    await page.locator('[data-action="project.permissions.open"]').click();
    await expect(page.getByTestId('project-permissions-sheet')).toBeVisible();
  });
});

test.describe('Swarm settings v3 (D5)', () => {
  test('swarm: per-project toggle fires swarm.project.set', async ({ page }) => {
    await openV3(page, '/settings/swarm', { lang: 'en' });

    // The honest copy (A16.6) is visible beside the control.
    await expect(page.getByTestId('settings-swarm-honest-copy')).toBeVisible();

    const toggle = page.getByTestId('project-swarm-toggle-1');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    await page.locator('[data-action="settings.swarm.save"]').click();
    await expectRpc(page, 'swarm.project.set');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
