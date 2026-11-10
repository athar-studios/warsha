import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  CustomModelRecord,
  DeviceId,
  DeviceSummary,
  HarnessDefinition,
  PairingOffer,
  ProviderConfig,
  RoleRouting,
  WarshaClient,
} from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { I18nProvider } from '@warsha/i18n/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { ThemeProvider } from '../../app/ThemeContext';
import { RouteOutlet, RouterProvider } from '../../router';

function createMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const providers: ProviderConfig[] = [
    { name: 'prov-alpha', kind: 'openai', enabled: true },
    { name: 'prov-local', kind: 'custom', enabled: false, api_base: 'http://localhost:11434' },
  ];
  const models: CustomModelRecord[] = [
    {
      provider: 'prov-alpha',
      modelId: 'model-one',
      displayName: 'Model One',
      contextWindow: 32000,
      enabled: true,
    },
  ];
  const roles: RoleRouting[] = [
    {
      role: 'intake',
      targets: [{ provider_id: 'prov-alpha', model_id: 'model-one', weight: 100 }],
      fallback_enabled: true,
      budget_cents_per_run: 0,
    },
  ];
  const devices: DeviceSummary[] = [
    {
      id: 'dev-1' as DeviceId,
      name: 'Phone Alpha',
      pairedAt: '2026-10-05T07:00:00.000Z',
      lastSeen: '2026-10-05T07:10:00.000Z',
      revoked: false,
    },
  ];
  const offer: PairingOffer = {
    pairing: {
      device_id: 'dev-new' as DeviceId,
      static_public: Array.from({ length: 32 }, () => 1),
      relay_url: null,
      pairing_secret: Array.from({ length: 32 }, () => 2),
      expires_at: '2026-10-05T07:25:00.000Z',
    },
    server_origin: 'http://127.0.0.1:8766',
    pairing_link: 'http://127.0.0.1:8766/pair',
    qr_code_png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    loopback_only: true,
  };

  return {
    listPreferences: vi.fn().mockResolvedValue([]),
    recordPreference: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue(providers),
    addProvider: vi.fn().mockResolvedValue({ name: 'prov-beta', kind: 'deepseek', enabled: true }),
    testProvider: vi.fn().mockResolvedValue(undefined),
    checkProviderModels: vi.fn().mockResolvedValue({
      provider: 'prov-alpha',
      new_models: [],
      retained_count: 1,
      total_count: 1,
      updated_catalog: [
        {
          id: 'model-two',
          name: 'model-two',
          provider: 'prov-alpha',
          context_window: 8192,
          max_output: 4096,
          pricing: { input_per_million_cents: 10, output_per_million_cents: 20 },
        },
      ],
    }),
    removeProvider: vi.fn().mockResolvedValue(undefined),
    listCustomModels: vi.fn().mockResolvedValue(models),
    addCustomModel: vi.fn().mockResolvedValue({
      provider: 'prov-alpha',
      modelId: 'model-three',
      displayName: null,
      contextWindow: null,
      enabled: true,
    }),
    removeCustomModel: vi.fn().mockResolvedValue(undefined),
    listRoleRoutings: vi.fn().mockResolvedValue(roles),
    setRoleConfig: vi.fn().mockResolvedValue(undefined),
    listDevices: vi.fn().mockResolvedValue(devices),
    startPairing: vi.fn().mockResolvedValue(offer),
    removeDevice: vi.fn().mockResolvedValue(undefined),
    listHarnesses: vi.fn().mockResolvedValue([
      {
        id: 'wf-1',
        version: '1.0.0',
        name: 'Standard Workflow',
        description: 'Default workflow',
        stages: [
          {
            id: 'code',
            role: 'coder',
            name: 'Code',
            promptTemplate: null,
            gate: null,
            autoAdvance: false,
          },
        ],
        rules: {
          maxRepairIterations: 2,
          budgetCapCents: null,
          allowParallelSubagents: false,
          requireVerificationReceipt: true,
        },
        preset: true,
        active: false,
        createdAt: '2026-10-05T07:00:00.000Z',
      } satisfies HarnessDefinition,
    ]),
    getHarness: vi.fn().mockResolvedValue({
      id: 'wf-1',
      version: '1.0.0',
      name: 'Standard Workflow',
      description: 'Default workflow',
      stages: [],
      rules: {
        maxRepairIterations: 2,
        budgetCapCents: null,
        allowParallelSubagents: false,
        requireVerificationReceipt: true,
      },
      preset: true,
      active: false,
      createdAt: '2026-10-05T07:00:00.000Z',
    } satisfies HarnessDefinition),
    importHarness: vi.fn().mockResolvedValue({
      id: 'wf-new',
      version: '1.0.0',
      name: 'Imported Workflow',
      description: '',
      stages: [],
      rules: {
        maxRepairIterations: 0,
        budgetCapCents: null,
        allowParallelSubagents: false,
        requireVerificationReceipt: false,
      },
      preset: false,
      active: false,
      createdAt: '2026-10-05T07:00:00.000Z',
    } satisfies HarnessDefinition),
    selectHarness: vi.fn().mockResolvedValue(undefined),
    deleteHarness: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderSettings(
  initialPath = '/settings/general',
  client: WarshaClient = createMockClient(),
  mode: 'simple' | 'advanced' = 'simple',
  locale: 'ar' | 'en' = 'ar'
) {
  return render(
    <ClientProvider client={client}>
      <CapabilitiesProvider
        initialCapabilities={{
          daemon: true,
          provider: true,
          devices: true,
          integrations: true,
          plugins: true,
          skills: true,
          harnesses: true,
          routines: true,
          preview: true,
          backend: true,
        }}
      >
        <I18nProvider initialLocale={locale}>
          <ThemeProvider initialTheme="light">
            <DensityProvider initialMode={mode}>
              <DataReadyProvider>
                <RouterProvider initialPath={initialPath}>
                  <RouteOutlet />
                </RouterProvider>
              </DataReadyProvider>
            </DensityProvider>
          </ThemeProvider>
        </I18nProvider>
      </CapabilitiesProvider>
    </ClientProvider>
  );
}

describe('SettingsPage (Slice 1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows 4 primary sections and advanced toggle in Simple mode', async () => {
    renderSettings('/settings/general');
    await waitFor(() => expect(screen.getByTestId('settings-section-general')).toBeDefined());

    const nav = screen.getByRole('navigation');
    const links = nav.querySelectorAll('a[data-action="settings.nav.open"]');
    expect(links.length).toBe(4);

    const toggle = nav.querySelector('button[data-action="settings.advanced.toggle"]');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLElement);

    const expandedLinks = nav.querySelectorAll('a[data-action="settings.nav.open"]');
    expect(expandedLinks.length).toBe(12);
  });

  it('shows all 12 nav sections immediately in Advanced mode', async () => {
    renderSettings('/settings/general', createMockClient(), 'advanced');
    await waitFor(() => expect(screen.getByTestId('settings-section-general')).toBeDefined());

    const nav = screen.getByRole('navigation');
    const links = nav.querySelectorAll('a[data-action="settings.nav.open"]');
    expect(links.length).toBe(12);
    expect(nav.querySelector('button[data-action="settings.advanced.toggle"]')).toBeNull();
  });

  it('switches language, theme, mode and saves default budget in GeneralSection', async () => {
    const client = createMockClient();
    renderSettings('/settings/general', client, 'simple', 'ar');
    await waitFor(() => expect(screen.getByTestId('settings-section-general')).toBeDefined());

    const enBtn = document.querySelector('button[data-action="settings.language.set"][data-value="en"]');
    expect(enBtn).not.toBeNull();
    fireEvent.click(enBtn as HTMLElement);
    expect(document.documentElement.dir).toBe('ltr');

    const darkBtn = document.querySelector('button[data-action="settings.theme.set"][data-value="dark"]');
    expect(darkBtn).not.toBeNull();
    fireEvent.click(darkBtn as HTMLElement);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    const advBtn = document.querySelector('button[data-action="settings.mode-default.set"][data-value="advanced"]');
    expect(advBtn).not.toBeNull();
    fireEvent.click(advBtn as HTMLElement);
    expect(document.documentElement.getAttribute('data-mode')).toBe('advanced');

    const budgetInput = screen.getByTestId('general-default-budget-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(budgetInput, { target: { value: '25' } });

    const saveBtn = document.querySelector('button[data-action="settings.budget-default.save"]') as HTMLElement;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(client.recordPreference).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'default_budget_usd', weight: 25 })
      );
    });
  });

  it('shows error banner and retries in GeneralSection when preferences.list fails', async () => {
    const listPreferences = vi
      .fn()
      .mockRejectedValueOnce(new Error('Pref load failed'))
      .mockResolvedValueOnce([]);
    const client = createMockClient({ listPreferences });

    renderSettings('/settings/general', client);
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());

    const retryBtn = document.querySelector('button[data-action="settings.error.retry"]') as HTMLElement;
    fireEvent.click(retryBtn);

    await waitFor(() => expect(listPreferences).toHaveBeenCalledTimes(2));
  });

  it('handles provider add (password key), test, fetch models, and remove dialog in ModelsSection', async () => {
    const client = createMockClient();
    renderSettings('/settings/models', client);
    await waitFor(() => expect(screen.getByTestId('settings-section-models')).toBeDefined());

    // Open add dialog
    fireEvent.click(document.querySelector('button[data-action="settings.provider.add.open"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('add-provider-dialog')).toBeDefined());

    const keyInput = screen.getByTestId('provider-form-key').querySelector('input') as HTMLInputElement;
    expect(keyInput.type).toBe('password');

    fireEvent.change(screen.getByTestId('provider-form-name').querySelector('input') as HTMLInputElement, {
      target: { value: 'prov-new' },
    });
    fireEvent.change(keyInput, { target: { value: 'sk-secret-key' } });
    fireEvent.click(document.querySelector('button[data-action="settings.provider.add.save"]') as HTMLElement);

    await waitFor(() => {
      expect(client.addProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'prov-new', key: 'sk-secret-key' })
      );
    });

    // Test & fetch models
    fireEvent.click(document.querySelector('button[data-action="settings.provider.test"]') as HTMLElement);
    await waitFor(() => expect(client.testProvider).toHaveBeenCalledWith('prov-alpha'));

    fireEvent.click(document.querySelector('button[data-action="settings.provider.models.fetch"]') as HTMLElement);
    await waitFor(() => expect(client.checkProviderModels).toHaveBeenCalledWith('prov-alpha'));

    // Remove provider via Dialog
    fireEvent.click(document.querySelector('button[data-action="settings.provider.remove.open"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('remove-provider-dialog')).toBeDefined());
    fireEvent.click(document.querySelector('button[data-action="settings.provider.remove.confirm"]') as HTMLElement);
    await waitFor(() => expect(client.removeProvider).toHaveBeenCalledWith('prov-alpha'));
  });

  it('handles custom model add/remove dialog and role routing in ModelsSection', async () => {
    const client = createMockClient();
    renderSettings('/settings/models', client);
    await waitFor(() => expect(screen.getByTestId('settings-section-models')).toBeDefined());

    fireEvent.change(screen.getByTestId('custom-model-id-input').querySelector('input') as HTMLInputElement, {
      target: { value: 'custom-m1' },
    });
    fireEvent.click(document.querySelector('button[data-action="settings.model.add"]') as HTMLElement);
    await waitFor(() => expect(client.addCustomModel).toHaveBeenCalledWith('prov-alpha', 'custom-m1', undefined));

    fireEvent.click(document.querySelector('button[data-action="settings.model.remove.open"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('remove-model-dialog')).toBeDefined());
    fireEvent.click(document.querySelector('button[data-action="settings.model.remove.confirm"]') as HTMLElement);
    await waitFor(() => expect(client.removeCustomModel).toHaveBeenCalledWith('prov-alpha', 'model-one'));

    // Role route save
    fireEvent.click(document.querySelector('button[data-action="settings.role.route.set"]') as HTMLElement);
    await waitFor(() => expect(client.setRoleConfig).toHaveBeenCalled());
  });

  it('handles pairing QR dialog and device revoke confirmation in DevicesSection', async () => {
    const client = createMockClient();
    renderSettings('/settings/devices', client);
    await waitFor(() => expect(screen.getByTestId('settings-section-devices')).toBeDefined());

    fireEvent.click(document.querySelector('button[data-action="settings.device.pair.start"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('device-pair-dialog')).toBeDefined());
    fireEvent.click(document.querySelector('button[data-action="settings.dialog.cancel"]') as HTMLElement);

    fireEvent.click(document.querySelector('button[data-action="settings.device.revoke.open"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('device-revoke-dialog')).toBeDefined());
    fireEvent.click(document.querySelector('button[data-action="settings.device.revoke.confirm"]') as HTMLElement);
    await waitFor(() => expect(client.removeDevice).toHaveBeenCalledWith('dev-1'));
  });

  it('renders empty state when no devices are paired in DevicesSection', async () => {
    const client = createMockClient({ listDevices: vi.fn().mockResolvedValue([]) });
    renderSettings('/settings/devices', client);
    await waitFor(() => expect(screen.getByTestId('settings-section-devices')).toBeDefined());
    expect(document.querySelector('.w-empty-state')).not.toBeNull();
  });

  it('renders health info and supports refresh and copy in AboutSection', async () => {
    const client = createMockClient();
    renderSettings('/settings/about', client);
    await waitFor(() => expect(screen.getByTestId('settings-section-about')).toBeDefined());

    fireEvent.click(document.querySelector('button[data-action="settings.about.health.refresh"]') as HTMLElement);
    await waitFor(() => expect(client.health).toHaveBeenCalled());

    fireEvent.click(document.querySelector('button[data-action="settings.about.copy"]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('.w-banner--success')).not.toBeNull());
  });

  it('handles workflow import, select, view dialog, and delete dialog in WorkflowsSection', async () => {
    const client = createMockClient();
    renderSettings('/settings/workflows', client, 'advanced');
    await waitFor(() => expect(screen.getByTestId('settings-section-workflows')).toBeDefined());

    const importArea = screen.getByTestId('workflow-import-textarea').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(importArea, { target: { value: '{"id":"wf-new","name":"Imported"}' } });
    fireEvent.click(document.querySelector('button[data-action="settings.harness.import"]') as HTMLElement);
    await waitFor(() => expect(client.importHarness).toHaveBeenCalled());

    fireEvent.click(document.querySelector('button[data-action="settings.harness.select"]') as HTMLElement);
    await waitFor(() => expect(client.selectHarness).toHaveBeenCalledWith('wf-1'));

    fireEvent.click(document.querySelector('button[data-action="settings.harness.view"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('workflow-view-dialog')).toBeDefined());
    fireEvent.click(document.querySelector('button[data-action="settings.dialog.cancel"]') as HTMLElement);

    fireEvent.click(document.querySelector('button[data-action="settings.harness.delete.open"]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('workflow-delete-dialog')).toBeDefined());
    fireEvent.click(document.querySelector('button[data-action="settings.harness.delete.confirm"]') as HTMLElement);
    await waitFor(() => expect(client.deleteHarness).toHaveBeenCalledWith('wf-1'));
  });
});
