// apps/desktop/e2e/v3/permissions.spec.ts
import { test, expect } from '@playwright/test';
import { openV3, act } from './support';

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
