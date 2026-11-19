// apps/desktop/e2e/v3/permissions.spec.ts
import { test, expect } from '@playwright/test';

import { openV3, act, expectRpc, rpcCalls } from './support';

test.describe('Permissions v3', () => {
  test('settings: default permissions show', async ({ page }) => {
    await openV3(page, '/settings/permissions', { lang: 'en' });
    
    await expect(page.getByTestId('settings-permissions-default-confinement')).toBeVisible();
    await expect(page.getByTestId('settings-permissions-default-approval')).toBeVisible();
    
    await expect(page.getByTestId('settings-permissions-honest-copy')).toBeVisible();
  });

  test('project override: open project permissions', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await expect(page.locator('[data-action="project.permissions.open"]')).toBeVisible();
    await page.locator('[data-action="project.permissions.open"]').click();
    await expect(page.getByTestId('project-permissions-sheet')).toBeVisible();
  });
});

test.describe('Permissions v3 actions (A6)', () => {
  test('actions: settings.permissions.defaults.save', async ({ page }) => {
    await openV3(page, '/settings/permissions', { lang: 'en' });
    await page.locator('[data-action="settings.permissions.defaults.save"] select').first().selectOption('full-access');
    await expectRpc(page, 'permissions.defaults.set');
  });

  test('actions: project.permissions.save', async ({ page }) => {
    await openV3(page, '/settings/permissions', { lang: 'en' });
    await page.locator('[data-action="settings.permissions.project.save"] select').first().selectOption('full-access');
    await expectRpc(page, 'permissions.project.set');
  });

  test('actions: project.permissions.reset', async ({ page }) => {
    await openV3(page, '/settings/permissions', { lang: 'en' });
    // Trigger override
    await page.locator('[data-testid="project-permission-confinement-proj-ui"] select').selectOption('workspace-write');
    await expectRpc(page, 'permissions.project.set', { confinement: 'workspace-write' });
    const setCalls = async () => (await rpcCalls(page)).filter((c) => c.method === 'permissions.project.set');
    const before = (await setCalls()).length;
    await page.locator('[data-action="settings.permissions.project.reset"]').click();
    // The reset button itself must fire a new permissions.project.set that clears both overrides.
    await expect.poll(async () => (await setCalls()).length).toBe(before + 1);
    const last = (await setCalls()).at(-1)!.params as Record<string, unknown>;
    expect(last.project_id).toBe('proj-ui');
    expect(last.confinement ?? null).toBeNull();
    expect(last.approval_mode ?? null).toBeNull();
  });
});

test.describe('Swarm settings v3 (D5)', () => {
  test('actions: settings.swarm.save', async ({ page }) => {
    await openV3(page, '/settings/swarm', { lang: 'en' });
    await act(page, 'settings.swarm.save');
    await expectRpc(page, 'swarm.project.set');
  });

  test('swarm: per-project toggle fires swarm.project.set', async ({ page }) => {
    await openV3(page, '/settings/swarm', { lang: 'en' });
    await expect(page.getByTestId('settings-swarm-honest-copy')).toBeVisible();

    const toggle = page.getByTestId('project-swarm-toggle-proj-ui');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expectRpc(page, 'swarm.project.set');
  });
});
