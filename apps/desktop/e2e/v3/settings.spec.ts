import { expect, test } from '@playwright/test';

import {
  auditFocusWalk,
  axeIsClean,
  describeAxe,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../support/a11y';

import { act, expectRpc, openV3, rpcCalls } from './support';

const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '390x844', width: 390, height: 844 },
] as const;

const LOCALES = ['ar', 'en'] as const;
const THEMES = ['light', 'dark'] as const;
const SECTIONS = [
  'general',
  'models',
  'devices',
  'about',
  'workflows',
  'skills',
  'plugins',
  'integrations',
  'routines',
  'budgets',
  'postlaunch',
] as const;

const CUSTOM_MODELS_FIXTURE = {
  'models.list': {
    result: [
      {
        provider: 'warsha-router',
        model_id: 'custom-m1',
        display_name: 'Custom Model 1',
        context_window: 32000,
        enabled: true,
      },
    ],
  },
} as const;

const WORKFLOWS_FIXTURE = {
  'harness.list': {
    result: [
      {
        id: 'wf-custom-1',
        version: '1.0.0',
        name: 'Custom Pipeline',
        description: 'Custom workflow pipeline',
        stages: [
          {
            id: 'code',
            role: 'coder',
            name: 'Code',
            prompt_template: null,
            gate: null,
            auto_advance: false,
          },
        ],
        rules: {
          max_repair_iterations: 2,
          budget_cap_cents: null,
          allow_parallel_subagents: false,
          require_verification_receipt: true,
        },
        preset: true,
        active: false,
        created_at: '2026-10-05T07:00:00.000Z',
      },
    ],
  },
} as const;

const SKILLS_FIXTURE = {
  'skills.list': {
    result: [
      {
        id: 'skill-1',
        name: 'Audit Skill',
        description: 'Code audit instructions',
        source: 'local',
        license: 'MIT',
        content: '# Audit',
        enabled: true,
        tags: ['audit'],
      },
    ],
  },
} as const;

const PLUGINS_FIXTURE = {
  'plugins.list': {
    result: [
      {
        id: 'plugin-1',
        name: 'Git MCP',
        description: 'Local git helper',
        transport: 'stdio',
        command: 'mcp-git',
        args: [],
        env: { GIT_DIR: '/repo' },
        enabled: true,
        tools: [{ name: 'git_status', description: 'status', parameters_json: null }],
        source: 'installed',
      },
    ],
  },
} as const;

const INTEGRATIONS_FIXTURE = {
  'integrations.list': {
    result: [
      {
        id: 'github',
        name: 'GitHub',
        connected: true,
        configured_at: '2026-10-05T07:00:00.000Z',
        details: null,
      },
    ],
  },
} as const;

const ROUTINES_FIXTURE = {
  'routines.list': {
    result: [
      {
        id: 'routine-1',
        name: 'Nightly Audit',
        description: 'Daily verification',
        schedule: { cron: '0 2 * * *' },
        state: 'idle',
        last_run_unix: null,
      },
      {
        id: 'routine-2',
        name: 'Weekly Sync',
        description: 'Cleanup task',
        schedule: { interval_seconds: 3600 },
        state: 'paused',
        last_run_unix: null,
      },
    ],
  },
} as const;

const BUDGETS_FIXTURE = {
  'projects.list': {
    result: [
      {
        id: 'proj-1',
        name: 'Project One',
        createdAt: '2026-10-05T07:00:00.000Z',
        updatedAt: '2026-10-05T07:00:00.000Z',
      },
    ],
  },
  'budget.show': {
    result: {
      project_id: 'proj-1',
      budget_cents: 2000,
      spent_cents: 500,
      remaining_cents: 1500,
    },
  },
} as const;

test.describe('Settings v3 (Slice 1)', () => {
  // ---------------------------------------------------------------------------
  // Journeys
  // ---------------------------------------------------------------------------
  test('navigation journey: Simple mode disclosure and switching sections', async ({
    page,
  }) => {
    await openV3(page, '/settings/general', { lang: 'ar', mode: 'simple' });

    const nav = page.locator('nav.v3-settings-nav');
    await expect(nav.locator('a[data-action="settings.nav.open"]')).toHaveCount(4);

    // Toggle advanced disclosure
    await act(page, 'settings.advanced.toggle');
    await expect(nav.locator('a[data-action="settings.nav.open"]')).toHaveCount(12);

    // Navigate to Models & Providers
    await page.locator('a[href="#/settings/models"]').click();
    await expect(page.locator('[data-testid="settings-section-models"]')).toBeVisible();
    await expect(page.locator('a[href="#/settings/models"]')).toHaveAttribute(
      'aria-current',
      'page'
    );

    // Navigate to Devices
    await page.locator('a[href="#/settings/devices"]').click();
    await expect(page.locator('[data-testid="settings-section-devices"]')).toBeVisible();

    // Navigate to About
    await page.locator('a[href="#/settings/about"]').click();
    await expect(page.locator('[data-testid="settings-section-about"]')).toBeVisible();
  });

  test('general settings journey: language, theme, mode, and default budget', async ({
    page,
  }) => {
    await openV3(page, '/settings/general', { lang: 'ar', theme: 'light', mode: 'simple' });

    await page
      .locator('[data-action="settings.language.set"][data-value="en"]')
      .click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page
      .locator('[data-action="settings.theme.set"][data-value="dark"]')
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page
      .locator('[data-action="settings.mode-default.set"][data-value="advanced"]')
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'advanced');

    const input = page.locator('[data-testid="general-default-budget-input"] input');
    await input.fill('50');
    await act(page, 'settings.budget-default.save');
    await expectRpc(page, 'preferences.record');
    await expect(page.locator('.w-banner--success')).toBeVisible();
  });

  test('models & providers journey: add provider, test, fetch models, remove provider, add custom model, remove model, save role', async ({
    page,
  }) => {
    await openV3(page, '/settings/models', {
      lang: 'ar',
      fixtures: CUSTOM_MODELS_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-models"]')).toBeVisible();

    // 1. Add provider (password API key)
    await act(page, 'settings.provider.add.open');
    const dialog = page.locator('[data-testid="add-provider-dialog"]');
    await expect(dialog).toBeVisible();

    const keyInput = dialog.locator('input[type="password"]');
    await expect(keyInput).toBeVisible();

    await dialog.locator('[data-testid="provider-form-name"] input').fill('test-provider');
    await keyInput.fill('sk-test-fixture-value');
    await act(page, 'settings.provider.add.save');
    await expectRpc(page, 'providers.add');
    await expect(dialog).not.toBeVisible();

    // 2. Test provider connection
    await act(page, 'settings.provider.test');
    await expectRpc(page, 'providers.test');

    // 3. Fetch provider models
    await act(page, 'settings.provider.models.fetch');
    await expectRpc(page, 'providers.check_models');

    // 4. Remove provider with confirmation dialog
    await act(page, 'settings.provider.remove.open');
    const removeProvDialog = page.locator('[data-testid="remove-provider-dialog"]');
    await expect(removeProvDialog).toBeVisible();
    await act(page, 'settings.provider.remove.confirm');
    await expectRpc(page, 'providers.remove');
    await expect(removeProvDialog).not.toBeVisible();

    // 5. Add custom model
    await page.locator('[data-testid="custom-model-id-input"] input').fill('test-custom-model');
    await act(page, 'settings.model.add');
    await expectRpc(page, 'models.add');

    // 6. Remove custom model with dialog
    await act(page, 'settings.model.remove.open');
    const removeModelDialog = page.locator('[data-testid="remove-model-dialog"]');
    await expect(removeModelDialog).toBeVisible();
    await act(page, 'settings.model.remove.confirm');
    await expectRpc(page, 'models.remove');
    await expect(removeModelDialog).not.toBeVisible();

    // 7. Save role route (select first routed row with enabled save button)
    await page
      .locator('[data-action="settings.role.route.set"]:not([disabled])')
      .first()
      .click();
    await expectRpc(page, 'roles.set');
  });

  test('devices journey: start pairing with QR code and revoke device with confirmation', async ({
    page,
  }) => {
    await openV3(page, '/settings/devices', { lang: 'ar' });
    await expect(page.locator('[data-testid="settings-section-devices"]')).toBeVisible();

    await act(page, 'settings.device.pair.start');
    await expectRpc(page, 'devices.pair-start');
    const pairDialog = page.locator('[data-testid="device-pair-dialog"]');
    await expect(pairDialog).toBeVisible();
    await expect(pairDialog.locator('img')).toBeVisible();
    await act(page, 'settings.dialog.cancel');
    await expect(pairDialog).not.toBeVisible();

    await act(page, 'settings.device.revoke.open');
    const revokeDialog = page.locator('[data-testid="device-revoke-dialog"]');
    await expect(revokeDialog).toBeVisible();
    await act(page, 'settings.device.revoke.confirm');
    await expectRpc(page, 'devices.revoke');
    await expect(revokeDialog).not.toBeVisible();
  });

  test('about journey: inspect health, refresh status, and copy info', async ({ page }) => {
    await openV3(page, '/settings/about', { lang: 'ar' });
    await expect(page.locator('[data-testid="settings-section-about"]')).toBeVisible();

    await act(page, 'settings.about.health.refresh');
    await expectRpc(page, 'health');

    await act(page, 'settings.about.copy');
    await expect(page.locator('.w-banner--success')).toBeVisible();
  });

  test('workflows journey: import, set default, view details, and delete via dialog', async ({
    page,
  }) => {
    await openV3(page, '/settings/workflows', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: WORKFLOWS_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-workflows"]')).toBeVisible();

    await page
      .locator('[data-testid="workflow-import-textarea"] textarea')
      .fill('{"id":"wf-2","name":"WF2"}');
    await act(page, 'settings.harness.import');
    await expectRpc(page, 'harness.import');

    await act(page, 'settings.harness.select');
    await expectRpc(page, 'harness.select');

    await act(page, 'settings.harness.view');
    await expectRpc(page, 'harness.get');
    const viewDialog = page.locator('[data-testid="workflow-view-dialog"]');
    await expect(viewDialog).toBeVisible();
    await act(page, 'settings.dialog.cancel');
    await expect(viewDialog).not.toBeVisible();

    await act(page, 'settings.harness.delete.open');
    const deleteDialog = page.locator('[data-testid="workflow-delete-dialog"]');
    await expect(deleteDialog).toBeVisible();
    await act(page, 'settings.harness.delete.confirm');
    await expectRpc(page, 'harness.delete');
    await expect(deleteDialog).not.toBeVisible();
  });

  test('skills journey: import, toggle, and delete via dialog', async ({ page }) => {
    await openV3(page, '/settings/skills', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: SKILLS_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-skills"]')).toBeVisible();

    await page.locator('[data-testid="skill-import-name"] input').fill('skill-2');
    await page.locator('[data-testid="skill-import-content"] textarea').fill('# Instructions');
    await act(page, 'settings.skill.import');
    await expectRpc(page, 'skills.import');

    await act(page, 'settings.skill.toggle');
    await expectRpc(page, 'skills.toggle');

    await act(page, 'settings.skill.delete.open');
    const deleteDialog = page.locator('[data-testid="skill-delete-dialog"]');
    await expect(deleteDialog).toBeVisible();
    await act(page, 'settings.skill.delete.confirm');
    await expectRpc(page, 'skills.delete');
    await expect(deleteDialog).not.toBeVisible();
  });

  test('plugins journey: install, toggle, configure env, and remove via dialog', async ({
    page,
  }) => {
    await openV3(page, '/settings/plugins', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: PLUGINS_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-plugins"]')).toBeVisible();

    await page
      .locator('[data-testid="plugin-install-textarea"] textarea')
      .fill('{"id":"plugin-2","transport":"stdio"}');
    await act(page, 'settings.plugin.install');
    await expectRpc(page, 'plugins.install');

    await act(page, 'settings.plugin.toggle');
    await expectRpc(page, 'plugins.toggle');

    await act(page, 'settings.plugin.configure.open');
    const configDialog = page.locator('[data-testid="plugin-configure-dialog"]');
    await expect(configDialog).toBeVisible();
    await configDialog.locator('[data-testid="plugin-env-key-input"] input').fill('EXT_REF');
    await configDialog
      .locator('[data-testid="plugin-env-val-input"] input')
      .fill('secret-ref-placeholder');
    await act(page, 'settings.plugin.configure.save');
    await expectRpc(page, 'plugins.configure');
    await expect(configDialog).not.toBeVisible();

    await act(page, 'settings.plugin.remove.open');
    const removeDialog = page.locator('[data-testid="plugin-remove-dialog"]');
    await expect(removeDialog).toBeVisible();
    await act(page, 'settings.plugin.remove.confirm');
    await expectRpc(page, 'plugins.remove');
    await expect(removeDialog).not.toBeVisible();
  });

  test('integrations journey: connect, test, and disconnect via dialog', async ({ page }) => {
    await openV3(page, '/settings/integrations', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: INTEGRATIONS_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-integrations"]')).toBeVisible();

    await act(page, 'settings.integration.connect.open');
    const connectDialog = page.locator('[data-testid="integration-connect-dialog"]');
    await expect(connectDialog).toBeVisible();
    await connectDialog.locator('[data-testid="integration-id-input"] input').fill('github');
    await connectDialog
      .locator('[data-testid="integration-token-input"] input')
      .fill('ghp-test-token-1234');
    await act(page, 'settings.integration.connect');
    await expectRpc(page, 'integrations.connect');
    await expect(connectDialog).not.toBeVisible();

    await act(page, 'settings.integration.test');
    await expectRpc(page, 'integrations.test');

    await act(page, 'settings.integration.disconnect.open');
    const disconnectDialog = page.locator('[data-testid="integration-disconnect-dialog"]');
    await expect(disconnectDialog).toBeVisible();
    await act(page, 'settings.integration.disconnect');
    await expectRpc(page, 'integrations.disconnect');
    await expect(disconnectDialog).not.toBeVisible();
  });

  test('routines journey: run now, pause, resume, and view details', async ({ page }) => {
    await openV3(page, '/settings/routines', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: ROUTINES_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-routines"]')).toBeVisible();

    await act(page, 'settings.routine.run-now');
    await expectRpc(page, 'routines.run_now');

    await page
      .locator('[data-action="settings.routine.pause"]:not([disabled])')
      .first()
      .click();
    await expectRpc(page, 'routines.pause');

    await page
      .locator('[data-action="settings.routine.resume"]:not([disabled])')
      .first()
      .click();
    await expectRpc(page, 'routines.resume');

    await act(page, 'settings.routine.view');
    await expectRpc(page, 'routines.get');
    const viewDialog = page.locator('[data-testid="routine-view-dialog"]');
    await expect(viewDialog).toBeVisible();
    await act(page, 'settings.dialog.cancel');
    await expect(viewDialog).not.toBeVisible();
  });

  test('budgets journey: inspect project limits and update spending cap', async ({ page }) => {
    await openV3(page, '/settings/budgets', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: BUDGETS_FIXTURE,
    });
    await expect(page.locator('[data-testid="settings-section-budgets"]')).toBeVisible();

    await page
      .locator('[data-testid="project-budget-input-proj-1"] input')
      .fill('40');
    await act(page, 'settings.budget.save');
    await expectRpc(page, 'budget.set');
    await expect(page.locator('.w-banner--success')).toBeVisible();
  });

  test('postlaunch journey: filter crashes, copy crash details, and filter store reviews', async ({
    page,
  }) => {
    await openV3(page, '/settings/postlaunch', { lang: 'ar', mode: 'advanced' });
    await expect(page.locator('[data-testid="settings-section-postlaunch"]')).toBeVisible();

    await page.locator('[data-testid="postlaunch-run-filter-input"] input').fill('run-code');
    await act(page, 'settings.crashes.filter');
    await expectRpc(page, 'postlaunch.crashes');

    await act(page, 'settings.crash.copy');
    await expect(page.locator('.w-banner--success')).toBeVisible();

    await page.locator('[data-testid="postlaunch-store-select"] select').selectOption('play');
    await act(page, 'settings.reviews.filter');
    await expectRpc(page, 'postlaunch.reviews');
  });

  // ---------------------------------------------------------------------------
  // One test per action id (for all 23 registered action ids)
  // ---------------------------------------------------------------------------
  test('action: settings.nav.open', async ({ page }) => {
    await openV3(page, '/settings/general', { lang: 'ar' });
    await page.locator('a[data-action="settings.nav.open"][href="#/settings/models"]').click();
    await expect(page.locator('[data-testid="settings-section-models"]')).toBeVisible();
    await expect(page.locator('a[href="#/settings/models"]')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  test('action: settings.advanced.toggle', async ({ page }) => {
    await openV3(page, '/settings/general', { lang: 'ar', mode: 'simple' });
    await act(page, 'settings.advanced.toggle');
    await expect(page.locator('a[href="#/settings/workflows"]')).toBeVisible();
  });

  test('action: settings.language.set', async ({ page }) => {
    await openV3(page, '/settings/general', { lang: 'ar' });
    await page.locator('[data-action="settings.language.set"][data-value="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('action: settings.theme.set', async ({ page }) => {
    await openV3(page, '/settings/general', { lang: 'ar', theme: 'light' });
    await page.locator('[data-action="settings.theme.set"][data-value="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('action: settings.mode-default.set', async ({ page }) => {
    await openV3(page, '/settings/general', { lang: 'ar', mode: 'simple' });
    await page.locator('[data-action="settings.mode-default.set"][data-value="advanced"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'advanced');
  });

  test('action: settings.budget-default.save', async ({ page }) => {
    await openV3(page, '/settings/general', { lang: 'ar' });
    await page.locator('[data-testid="general-default-budget-input"] input').fill('30');
    await act(page, 'settings.budget-default.save');
    await expectRpc(page, 'preferences.record');
    await expect(page.locator('.w-banner--success')).toBeVisible();
  });

  test('action: settings.provider.add.open', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.add.open');
    await expect(page.locator('[data-testid="add-provider-dialog"]')).toBeVisible();
  });

  test('action: settings.provider.add.save', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.add.open');
    const dialog = page.locator('[data-testid="add-provider-dialog"]');
    await dialog.locator('[data-testid="provider-form-name"] input').fill('custom-prov');
    await dialog.locator('[data-testid="provider-form-key"] input').fill('sk-test-fixture-value');
    await act(page, 'settings.provider.add.save');
    await expectRpc(page, 'providers.add');
  });

  test('action: settings.provider.test', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.test');
    await expectRpc(page, 'providers.test');
  });

  test('action: settings.provider.models.fetch', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.models.fetch');
    await expectRpc(page, 'providers.check_models');
  });

  test('action: settings.provider.remove.open', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.remove.open');
    await expect(page.locator('[data-testid="remove-provider-dialog"]')).toBeVisible();
  });

  test('action: settings.provider.remove.confirm', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.remove.open');
    await act(page, 'settings.provider.remove.confirm');
    await expectRpc(page, 'providers.remove');
  });

  test('action: settings.model.add', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await page.locator('[data-testid="custom-model-id-input"] input').fill('my-model-1');
    await act(page, 'settings.model.add');
    await expectRpc(page, 'models.add');
  });

  test('action: settings.model.remove.open', async ({ page }) => {
    await openV3(page, '/settings/models', {
      lang: 'ar',
      fixtures: CUSTOM_MODELS_FIXTURE,
    });
    await act(page, 'settings.model.remove.open');
    await expect(page.locator('[data-testid="remove-model-dialog"]')).toBeVisible();
  });

  test('action: settings.model.remove.confirm', async ({ page }) => {
    await openV3(page, '/settings/models', {
      lang: 'ar',
      fixtures: CUSTOM_MODELS_FIXTURE,
    });
    await act(page, 'settings.model.remove.open');
    await act(page, 'settings.model.remove.confirm');
    await expectRpc(page, 'models.remove');
  });

  test('action: settings.role.route.set', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await page
      .locator('[data-action="settings.role.route.set"]:not([disabled])')
      .first()
      .click();
    await expectRpc(page, 'roles.set');
  });

  test('action: settings.device.pair.start', async ({ page }) => {
    await openV3(page, '/settings/devices', { lang: 'ar' });
    await act(page, 'settings.device.pair.start');
    await expectRpc(page, 'devices.pair-start');
    await expect(page.locator('[data-testid="device-pair-dialog"]')).toBeVisible();
  });

  test('action: settings.device.revoke.open', async ({ page }) => {
    await openV3(page, '/settings/devices', { lang: 'ar' });
    await act(page, 'settings.device.revoke.open');
    await expect(page.locator('[data-testid="device-revoke-dialog"]')).toBeVisible();
  });

  test('action: settings.device.revoke.confirm', async ({ page }) => {
    await openV3(page, '/settings/devices', { lang: 'ar' });
    await act(page, 'settings.device.revoke.open');
    await act(page, 'settings.device.revoke.confirm');
    await expectRpc(page, 'devices.revoke');
  });

  test('action: settings.about.health.refresh', async ({ page }) => {
    await openV3(page, '/settings/about', { lang: 'ar' });
    await act(page, 'settings.about.health.refresh');
    await expectRpc(page, 'health');
  });

  test('action: settings.about.copy', async ({ page }) => {
    await openV3(page, '/settings/about', { lang: 'ar' });
    await act(page, 'settings.about.copy');
    await expect(page.locator('.w-banner--success')).toBeVisible();
  });

  test('action: settings.harness.import', async ({ page }) => {
    await openV3(page, '/settings/workflows', { lang: 'ar', mode: 'advanced' });
    await page
      .locator('[data-testid="workflow-import-textarea"] textarea')
      .fill('{"id":"wf-2","name":"WF2"}');
    await act(page, 'settings.harness.import');
    await expectRpc(page, 'harness.import');
  });

  test('action: settings.harness.select', async ({ page }) => {
    await openV3(page, '/settings/workflows', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: WORKFLOWS_FIXTURE,
    });
    await act(page, 'settings.harness.select');
    await expectRpc(page, 'harness.select');
  });

  test('action: settings.harness.view', async ({ page }) => {
    await openV3(page, '/settings/workflows', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: WORKFLOWS_FIXTURE,
    });
    await act(page, 'settings.harness.view');
    await expectRpc(page, 'harness.get');
    await expect(page.locator('[data-testid="workflow-view-dialog"]')).toBeVisible();
  });

  test('action: settings.harness.delete.open', async ({ page }) => {
    await openV3(page, '/settings/workflows', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: WORKFLOWS_FIXTURE,
    });
    await act(page, 'settings.harness.delete.open');
    await expect(page.locator('[data-testid="workflow-delete-dialog"]')).toBeVisible();
  });

  test('action: settings.harness.delete.confirm', async ({ page }) => {
    await openV3(page, '/settings/workflows', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: WORKFLOWS_FIXTURE,
    });
    await act(page, 'settings.harness.delete.open');
    await act(page, 'settings.harness.delete.confirm');
    await expectRpc(page, 'harness.delete');
  });

  test('action: settings.skill.import', async ({ page }) => {
    await openV3(page, '/settings/skills', { lang: 'ar', mode: 'advanced' });
    await page.locator('[data-testid="skill-import-content"] textarea').fill('# Skill');
    await act(page, 'settings.skill.import');
    await expectRpc(page, 'skills.import');
  });

  test('action: settings.skill.toggle', async ({ page }) => {
    await openV3(page, '/settings/skills', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: SKILLS_FIXTURE,
    });
    await act(page, 'settings.skill.toggle');
    await expectRpc(page, 'skills.toggle');
  });

  test('action: settings.skill.delete.open', async ({ page }) => {
    await openV3(page, '/settings/skills', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: SKILLS_FIXTURE,
    });
    await act(page, 'settings.skill.delete.open');
    await expect(page.locator('[data-testid="skill-delete-dialog"]')).toBeVisible();
  });

  test('action: settings.skill.delete.confirm', async ({ page }) => {
    await openV3(page, '/settings/skills', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: SKILLS_FIXTURE,
    });
    await act(page, 'settings.skill.delete.open');
    await act(page, 'settings.skill.delete.confirm');
    await expectRpc(page, 'skills.delete');
  });

  test('action: settings.plugin.install', async ({ page }) => {
    await openV3(page, '/settings/plugins', { lang: 'ar', mode: 'advanced' });
    await page
      .locator('[data-testid="plugin-install-textarea"] textarea')
      .fill('{"id":"plugin-2"}');
    await act(page, 'settings.plugin.install');
    await expectRpc(page, 'plugins.install');
  });

  test('action: settings.plugin.toggle', async ({ page }) => {
    await openV3(page, '/settings/plugins', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: PLUGINS_FIXTURE,
    });
    await act(page, 'settings.plugin.toggle');
    await expectRpc(page, 'plugins.toggle');
  });

  test('action: settings.plugin.configure.open', async ({ page }) => {
    await openV3(page, '/settings/plugins', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: PLUGINS_FIXTURE,
    });
    await act(page, 'settings.plugin.configure.open');
    await expect(page.locator('[data-testid="plugin-configure-dialog"]')).toBeVisible();
  });

  test('action: settings.plugin.configure.save', async ({ page }) => {
    await openV3(page, '/settings/plugins', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: PLUGINS_FIXTURE,
    });
    await act(page, 'settings.plugin.configure.open');
    await act(page, 'settings.plugin.configure.save');
    await expectRpc(page, 'plugins.configure');
  });

  test('action: settings.plugin.remove.open', async ({ page }) => {
    await openV3(page, '/settings/plugins', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: PLUGINS_FIXTURE,
    });
    await act(page, 'settings.plugin.remove.open');
    await expect(page.locator('[data-testid="plugin-remove-dialog"]')).toBeVisible();
  });

  test('action: settings.plugin.remove.confirm', async ({ page }) => {
    await openV3(page, '/settings/plugins', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: PLUGINS_FIXTURE,
    });
    await act(page, 'settings.plugin.remove.open');
    await act(page, 'settings.plugin.remove.confirm');
    await expectRpc(page, 'plugins.remove');
  });

  test('action: settings.integration.connect.open', async ({ page }) => {
    await openV3(page, '/settings/integrations', { lang: 'ar', mode: 'advanced' });
    await act(page, 'settings.integration.connect.open');
    await expect(page.locator('[data-testid="integration-connect-dialog"]')).toBeVisible();
  });

  test('action: settings.integration.connect', async ({ page }) => {
    await openV3(page, '/settings/integrations', { lang: 'ar', mode: 'advanced' });
    await act(page, 'settings.integration.connect.open');
    const dialog = page.locator('[data-testid="integration-connect-dialog"]');
    await dialog.locator('[data-testid="integration-id-input"] input').fill('slack');
    await act(page, 'settings.integration.connect');
    await expectRpc(page, 'integrations.connect');
  });

  test('action: settings.integration.test', async ({ page }) => {
    await openV3(page, '/settings/integrations', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: INTEGRATIONS_FIXTURE,
    });
    await act(page, 'settings.integration.test');
    await expectRpc(page, 'integrations.test');
  });

  test('action: settings.integration.disconnect.open', async ({ page }) => {
    await openV3(page, '/settings/integrations', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: INTEGRATIONS_FIXTURE,
    });
    await act(page, 'settings.integration.disconnect.open');
    await expect(page.locator('[data-testid="integration-disconnect-dialog"]')).toBeVisible();
  });

  test('action: settings.integration.disconnect', async ({ page }) => {
    await openV3(page, '/settings/integrations', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: INTEGRATIONS_FIXTURE,
    });
    await act(page, 'settings.integration.disconnect.open');
    await act(page, 'settings.integration.disconnect');
    await expectRpc(page, 'integrations.disconnect');
  });

  test('action: settings.routine.run-now', async ({ page }) => {
    await openV3(page, '/settings/routines', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: ROUTINES_FIXTURE,
    });
    await act(page, 'settings.routine.run-now');
    await expectRpc(page, 'routines.run_now');
  });

  test('action: settings.routine.pause', async ({ page }) => {
    await openV3(page, '/settings/routines', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: ROUTINES_FIXTURE,
    });
    await page
      .locator('[data-action="settings.routine.pause"]:not([disabled])')
      .first()
      .click();
    await expectRpc(page, 'routines.pause');
  });

  test('action: settings.routine.resume', async ({ page }) => {
    await openV3(page, '/settings/routines', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: ROUTINES_FIXTURE,
    });
    await page
      .locator('[data-action="settings.routine.resume"]:not([disabled])')
      .first()
      .click();
    await expectRpc(page, 'routines.resume');
  });

  test('action: settings.routine.view', async ({ page }) => {
    await openV3(page, '/settings/routines', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: ROUTINES_FIXTURE,
    });
    await act(page, 'settings.routine.view');
    await expectRpc(page, 'routines.get');
    await expect(page.locator('[data-testid="routine-view-dialog"]')).toBeVisible();
  });

  test('action: settings.budget.save', async ({ page }) => {
    await openV3(page, '/settings/budgets', {
      lang: 'ar',
      mode: 'advanced',
      fixtures: BUDGETS_FIXTURE,
    });
    await page
      .locator('[data-testid="project-budget-input-proj-1"] input')
      .fill('50');
    await act(page, 'settings.budget.save');
    await expectRpc(page, 'budget.set');
  });

  test('action: settings.crashes.filter', async ({ page }) => {
    await openV3(page, '/settings/postlaunch', { lang: 'ar', mode: 'advanced' });
    await page.locator('[data-testid="postlaunch-run-filter-input"] input').fill('run-code');
    await act(page, 'settings.crashes.filter');
    await expectRpc(page, 'postlaunch.crashes');
  });

  test('action: settings.crash.copy', async ({ page }) => {
    await openV3(page, '/settings/postlaunch', { lang: 'ar', mode: 'advanced' });
    await act(page, 'settings.crash.copy');
    await expect(page.locator('.w-banner--success')).toBeVisible();
  });

  test('action: settings.reviews.filter', async ({ page }) => {
    await openV3(page, '/settings/postlaunch', { lang: 'ar', mode: 'advanced' });
    await page.locator('[data-testid="postlaunch-store-select"] select').selectOption('play');
    await act(page, 'settings.reviews.filter');
    await expectRpc(page, 'postlaunch.reviews');
  });

  test('action: settings.dialog.cancel', async ({ page }) => {
    await openV3(page, '/settings/models', { lang: 'ar' });
    await act(page, 'settings.provider.add.open');
    const dialog = page.locator('[data-testid="add-provider-dialog"]');
    await expect(dialog).toBeVisible();
    await act(page, 'settings.dialog.cancel');
    await expect(dialog).not.toBeVisible();
  });

  test('action: settings.error.retry', async ({ page }) => {
    await openV3(page, '/settings/general', {
      lang: 'ar',
      fixtures: {
        'preferences.list': { error: 'Daemon connection failure' },
      },
    });
    const errorBanner = page.locator('.w-banner--danger');
    await expect(errorBanner).toBeVisible();
    const beforeCalls = (await rpcCalls(page)).filter((c) => c.method === 'preferences.list').length;
    await act(page, 'settings.error.retry');
    await expect
      .poll(async () => (await rpcCalls(page)).filter((c) => c.method === 'preferences.list').length)
      .toBeGreaterThan(beforeCalls);
  });

  // ---------------------------------------------------------------------------
  // Accessibility & Keyboard (@a11y)
  // ---------------------------------------------------------------------------
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`settings accessibility and keyboard navigation (${locale}, ${theme}) @a11y`, async ({
        page,
      }) => {
        for (const section of SECTIONS) {
          await openV3(page, `/settings/${section}`, { lang: locale, theme });
          await expect(page.locator(`[data-testid="settings-section-${section}"]`)).toBeVisible();

          const axe = await runAxe(page);
          expect(axeIsClean(axe), `axe failed on ${section} (${locale}, ${theme}):\n${describeAxe(axe)}`).toBe(
            true
          );

          const focus = await auditFocusWalk(page);
          expect(focusIsClean(focus), `focus failed on ${section} (${locale}, ${theme}):\n${describeFocus(focus)}`).toBe(
            true
          );
          expect(focus.stops.length).toBeGreaterThan(0);
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Visual checks (@visual) — per section/state × 1280×800 & 390×844 × ar/en × light/dark
  // ---------------------------------------------------------------------------
  for (const section of SECTIONS) {
    for (const viewport of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual baseline: settings ${section} ready ${viewport.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            await openV3(page, `/settings/${section}`, {
              lang: locale,
              theme,
              viewport: { width: viewport.width, height: viewport.height },
            });
            await expect(page.locator(`[data-testid="settings-section-${section}"]`)).toBeVisible();
            await expect(page).toHaveScreenshot(
              `settings-${section}-ready-${viewport.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }

  for (const viewport of VIEWPORTS) {
    for (const locale of LOCALES) {
      for (const theme of THEMES) {
        test(`visual baseline: settings models empty ${viewport.name} ${locale} ${theme} @visual`, async ({
          page,
        }) => {
          await openV3(page, '/settings/models', {
            lang: locale,
            theme,
            viewport: { width: viewport.width, height: viewport.height },
            fixtures: {
              'providers.list': { result: [] },
              'models.list': { result: [] },
            },
          });
          await expect(page.locator('[data-testid="settings-section-models"]')).toBeVisible();
          await expect(page).toHaveScreenshot(
            `settings-models-empty-${viewport.name}-${locale}-${theme}.png`
          );
        });

        test(`visual baseline: settings devices empty ${viewport.name} ${locale} ${theme} @visual`, async ({
          page,
        }) => {
          await openV3(page, '/settings/devices', {
            lang: locale,
            theme,
            viewport: { width: viewport.width, height: viewport.height },
            fixtures: {
              'devices.list': { result: [] },
            },
          });
          await expect(page.locator('[data-testid="settings-section-devices"]')).toBeVisible();
          await expect(page).toHaveScreenshot(
            `settings-devices-empty-${viewport.name}-${locale}-${theme}.png`
          );
        });

        test(`visual baseline: settings general error ${viewport.name} ${locale} ${theme} @visual`, async ({
          page,
        }) => {
          await openV3(page, '/settings/general', {
            lang: locale,
            theme,
            viewport: { width: viewport.width, height: viewport.height },
            fixtures: {
              'preferences.list': { error: 'Daemon connection failure' },
            },
          });
          await expect(page.locator('.w-banner--danger')).toBeVisible();
          await expect(page).toHaveScreenshot(
            `settings-general-error-${viewport.name}-${locale}-${theme}.png`
          );
        });
      }
    }
  }
});
