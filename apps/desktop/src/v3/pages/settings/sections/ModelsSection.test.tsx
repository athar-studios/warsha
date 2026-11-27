// apps/desktop/src/v3/pages/settings/sections/ModelsSection.test.tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CustomModelRecord,
  ModelCatalogDiff,
  ModelInfo,
  ProviderConfig,
  RoleRouting,
  WarshaClient,
} from '@warsha/client';
import { I18nProvider, type Locale } from '@warsha/i18n/v3';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';
import { DensityProvider } from '../../../app/DensityContext';
import { ThemeProvider } from '../../../app/ThemeContext';

import { ModelsSection, sanitizeSecretError } from './ModelsSection';

function makeModelInfo(id: string, name = id, provider = 'mock-provider'): ModelInfo {
  return {
    id,
    name,
    provider,
    context_window: 128000,
    max_output: 4096,
    pricing: { input_per_million_cents: 0, output_per_million_cents: 0 },
  };
}

function makeDiff(
  provider: string,
  updated: ModelInfo[],
  newModels: ModelInfo[],
  retainedCount: number
): ModelCatalogDiff {
  return {
    provider,
    updated_catalog: updated,
    new_models: newModels,
    retained_count: retainedCount,
    total_count: updated.length,
  };
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { name: 'mock-provider', kind: 'openai', enabled: true },
  { name: 'local-ollama', kind: 'ollama', enabled: false, api_base: 'http://localhost:11434' },
];

const DEFAULT_MODELS: CustomModelRecord[] = [
  {
    provider: 'mock-provider',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    enabled: true,
  },
];

const DEFAULT_ROLES: RoleRouting[] = [
  {
    role: 'intake',
    targets: [{ provider_id: 'mock-provider', model_id: 'gpt-4o', weight: 100 }],
    fallback_enabled: true,
    budget_cents_per_run: 0,
    daily_spend_cap_cents: null,
  },
];

function createClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  return {
    listProviders: vi.fn().mockResolvedValue(DEFAULT_PROVIDERS),
    listCustomModels: vi.fn().mockResolvedValue(DEFAULT_MODELS),
    listRoleRoutings: vi.fn().mockResolvedValue(DEFAULT_ROLES),
    providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'none' }),
    checkProviderModels: vi.fn().mockResolvedValue(
      makeDiff(
        'mock-provider',
        [makeModelInfo('gpt-4o', 'GPT-4o'), makeModelInfo('gpt-4o-mini', 'GPT-4o Mini')],
        [makeModelInfo('gpt-4o-mini', 'GPT-4o Mini')],
        1
      )
    ),
    testProvider: vi.fn().mockResolvedValue(undefined),
    addProvider: vi.fn().mockResolvedValue(undefined),
    removeProvider: vi.fn().mockResolvedValue(undefined),
    addCustomModel: vi.fn().mockResolvedValue(undefined),
    removeCustomModel: vi.fn().mockResolvedValue(undefined),
    setRoleConfig: vi.fn().mockResolvedValue(undefined),
    providerDisconnect: vi.fn().mockResolvedValue(undefined),
    providerAuthStart: vi.fn().mockResolvedValue({ kind: 'none' }),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderSection(client: WarshaClient, locale: Locale = 'en'): void {
  render(
    <I18nProvider initialLocale={locale}>
      <ThemeProvider>
        <DensityProvider>
          <ClientProvider client={client}>
            <DataReadyProvider>
              <ModelsSection />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('ModelsSection - Model Discovery & Live List Diff', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders provider list and discovers live models with diff badges and model chips', async () => {
    const diffResult = makeDiff(
      'mock-provider',
      [
        makeModelInfo('gpt-4o', 'GPT-4o'),
        makeModelInfo('o1-preview', 'o1 Preview'),
        makeModelInfo('o3-mini', 'o3 Mini'),
      ],
      [makeModelInfo('o1-preview', 'o1 Preview'), makeModelInfo('o3-mini', 'o3 Mini')],
      1
    );

    const client = createClient({
      checkProviderModels: vi.fn().mockResolvedValue(diffResult),
    });

    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    const mockRow = screen.getByTestId('provider-row-mock-provider');
    const fetchBtn = within(mockRow).getByText('Fetch models');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(client.checkProviderModels).toHaveBeenCalledWith('mock-provider');
    });

    // Check that diff container rendered on row
    await waitFor(() => {
      expect(screen.getByTestId('provider-models-list-mock-provider')).toBeDefined();
    });

    const diffContainer = screen.getByTestId('provider-models-list-mock-provider');
    expect(within(diffContainer).getByText('Discovered models')).toBeDefined();
    expect(within(diffContainer).getByText('2 new')).toBeDefined();
    expect(within(diffContainer).getByText('1 retained')).toBeDefined();

    // Check individual model chips
    expect(screen.getByTestId('provider-model-item-mock-provider-gpt-4o')).toBeDefined();
    expect(screen.getByTestId('provider-model-item-mock-provider-o1-preview')).toBeDefined();
    expect(screen.getByTestId('provider-model-item-mock-provider-o3-mini')).toBeDefined();
  });

  it('surfaces error on provider row when checkProviderModels fails (unknown provider or network down)', async () => {
    const client = createClient({
      checkProviderModels: vi
        .fn()
        .mockRejectedValue(new Error('Unknown provider or endpoint connection failed: 502 Bad Gateway')),
    });

    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    const mockRow = screen.getByTestId('provider-row-mock-provider');
    const fetchBtn = within(mockRow).getByText('Fetch models');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByTestId('provider-fetch-error-mock-provider')).toBeDefined();
    });

    const errorContainer = screen.getByTestId('provider-fetch-error-mock-provider');
    expect(
      within(errorContainer).getByText(/Unknown provider or endpoint connection failed: 502 Bad Gateway/)
    ).toBeDefined();

    // Should NOT show diff list
    expect(screen.queryByTestId('provider-models-list-mock-provider')).toBeNull();
  });

  it('sanitizes and redacts secrets from error messages without leaking credentials', async () => {
    const secretKey = 'sk-live-super-secret-key-123456789';
    const rawError = `Failed to connect with Bearer ${secretKey}: 401 Unauthorized`;

    const sanitized = sanitizeSecretError(new Error(rawError), secretKey);
    expect(sanitized).not.toContain(secretKey);
    expect(sanitized).toContain('[redacted]');

    const client = createClient({
      checkProviderModels: vi.fn().mockRejectedValue(new Error(rawError)),
    });

    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    const mockRow = screen.getByTestId('provider-row-mock-provider');
    const fetchBtn = within(mockRow).getByText('Fetch models');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByTestId('provider-fetch-error-mock-provider')).toBeDefined();
    });

    const errorContainer = screen.getByTestId('provider-fetch-error-mock-provider');
    expect(errorContainer.textContent).not.toContain(secretKey);
    expect(errorContainer.textContent).toContain('[redacted]');
  });

  it('supports model discovery inside Add Provider dialog with live list and manual fallback warning', async () => {
    const dialogDiffResult = makeDiff(
      'my-ollama',
      [makeModelInfo('llama3:8b', 'Llama 3 8B'), makeModelInfo('qwen2.5-coder:7b', 'Qwen 2.5 Coder 7B')],
      [makeModelInfo('llama3:8b', 'Llama 3 8B'), makeModelInfo('qwen2.5-coder:7b', 'Qwen 2.5 Coder 7B')],
      0
    );

    const client = createClient({
      checkProviderModels: vi.fn().mockResolvedValue(dialogDiffResult),
    });

    renderSection(client);

    await waitFor(() => {
      expect(screen.getByTestId('provider-add-button')).toBeDefined();
    });

    // Open Add Provider Dialog
    fireEvent.click(screen.getByTestId('provider-add-button'));
    await waitFor(() => {
      expect(screen.getByTestId('add-provider-dialog')).toBeDefined();
    });

    // Fill form using input elements inside TextField wrappers
    const nameInput = screen.getByTestId('provider-form-name').querySelector('input')!;
    const keyInput = screen.getByTestId('provider-form-key').querySelector('input')!;
    const urlInput = screen.getByTestId('provider-form-api-base').querySelector('input')!;

    fireEvent.change(nameInput, { target: { value: 'my-ollama' } });
    fireEvent.change(keyInput, { target: { value: 'local-token-999' } });
    fireEvent.change(urlInput, { target: { value: 'http://localhost:11434' } });

    // Click Fetch Models button in dialog
    const dialogFetchBtn = screen.getByTestId('provider-form-fetch-models-btn');
    fireEvent.click(dialogFetchBtn);

    await waitFor(() => {
      expect(client.checkProviderModels).toHaveBeenCalledWith('my-ollama', {
        api_base: 'http://localhost:11434',
        key: 'local-token-999',
        kind: 'openai',
      });
    });

    // Select should now be populated
    await waitFor(() => {
      expect(screen.getByTestId('provider-form-model-select')).toBeDefined();
    });

    // Manual model fallback: typing an unoffered model triggers warning
    const manualInput = screen.getByTestId('provider-form-model-manual').querySelector('input')!;
    fireEvent.change(manualInput, { target: { value: 'nonexistent-model-xyz' } });

    await waitFor(() => {
      expect(screen.getByTestId('provider-form-model-warning')).toBeDefined();
    });
    expect(screen.getByTestId('provider-form-model-warning').textContent).toContain(
      'Model not offered by this provider'
    );

    // Typing an offered model hides warning
    fireEvent.change(manualInput, { target: { value: 'llama3:8b' } });
    await waitFor(() => {
      expect(screen.queryByTestId('provider-form-model-warning')).toBeNull();
    });
  });

  it('renders Arabic i18n labels correctly for model discovery diff and errors', async () => {
    const diffResult = makeDiff(
      'mock-provider',
      [makeModelInfo('claude-3-7-sonnet', 'Claude 3.7 Sonnet')],
      [makeModelInfo('claude-3-7-sonnet', 'Claude 3.7 Sonnet')],
      0
    );

    const client = createClient({
      checkProviderModels: vi.fn().mockResolvedValue(diffResult),
    });

    renderSection(client, 'ar');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    const mockRow = screen.getByTestId('provider-row-mock-provider');
    const fetchBtn = within(mockRow).getByText('جلب النماذج');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(screen.getByTestId('provider-models-list-mock-provider')).toBeDefined();
    });

    const diffContainer = screen.getByTestId('provider-models-list-mock-provider');
    expect(within(diffContainer).getByText('النماذج المكتشفة')).toBeDefined();
    expect(within(diffContainer).getByText('1 جديد')).toBeDefined();
    expect(within(diffContainer).getByText('0 باقٍ')).toBeDefined();
  });

  it('N2a proving test: renders unknown fallback label when authStatus.kind is undefined', async () => {
    const client = createClient({
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: undefined } as unknown as { kind: 'none' }),
    });

    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    // Must NOT render literal "settings.providers.auth.undefined"
    expect(screen.queryByText('settings.providers.auth.undefined')).toBeNull();
    // Must render fallback "Unknown" under the provider card
    const mockRow = screen.getByTestId('provider-row-mock-provider');
    expect(within(mockRow).getByText('Unknown')).toBeDefined();
  });

  it('N2a proving test (Arabic): renders غير معروف when authStatus.kind is undefined', async () => {
    const client = createClient({
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: undefined } as unknown as { kind: 'none' }),
    });

    renderSection(client, 'ar');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    expect(screen.queryByText('settings.providers.auth.undefined')).toBeNull();
    const mockRow = screen.getByTestId('provider-row-mock-provider');
    expect(within(mockRow).getByText('غير معروف')).toBeDefined();
  });

  it('N5 proving test: add-provider dialog is constrained to viewport and closes on Escape', async () => {
    const client = createClient();
    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-add-button')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('provider-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('add-provider-dialog')).toBeDefined();
    });

    const dialog = screen.getByTestId('add-provider-dialog');
    expect(dialog.className).toContain('v3-provider-dialog');
    expect(dialog.style.maxHeight).toContain('min(90dvh');
    expect(dialog.style.maxBlockSize).toContain('min(90dvh');

    // Press Escape key on dialog
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('add-provider-dialog')).toBeNull();
    });
  });

  describe('sanitizeSecretError', () => {
    it('strips duplicate HTTP prefixes and RPC envelopes', () => {
      expect(
        sanitizeSecretError('HTTP 400: HTTP 400: Bad Request')
      ).toBe('HTTP 400: Bad Request');

      expect(
        sanitizeSecretError('RPC error -32603: HTTP 500: HTTP 500: Server Failure')
      ).toBe('HTTP 500: Server Failure');
    });

    it('sanitizes raw RPC JSON dump into clean user message', () => {
      expect(
        sanitizeSecretError('HTTP 401: {"error":{"message":"Incorrect API key provided: sk-abcdef12345"}}', 'sk-abcdef12345')
      ).toBe('HTTP 401: Incorrect API key provided: [redacted]');

      expect(
        sanitizeSecretError('HTTP 400: HTTP 400: {"error":"Model not supported"}')
      ).toBe('HTTP 400: Model not supported');

      expect(
        sanitizeSecretError('{"message":"Rate limit reached"}')
      ).toBe('Rate limit reached');
    });

    it('redacts sensitive API keys and tokens', () => {
      expect(
        sanitizeSecretError('Failed with Bearer eyJhbGciOiJIUzI1NiJ9 and sk-1234567890abcdef')
      ).toBe('Failed with Bearer [redacted] and [redacted]');
    });
  });

  it('shows the routed model for snake_case product_manager and qa keys, not "No model"', async () => {
    const client = createClient({
      listRoleRoutings: vi.fn().mockResolvedValue([
        {
          role: 'product_manager',
          targets: [{ provider_id: 'mock-provider', model_id: 'gpt-4o', weight: 100 }],
          fallback_enabled: true,
          budget_cents_per_run: 0,
          daily_spend_cap_cents: null,
        },
        {
          role: 'qa',
          targets: [{ provider_id: 'mock-provider', model_id: 'gpt-4o-mini', weight: 100 }],
          fallback_enabled: true,
          budget_cents_per_run: null,
          daily_spend_cap_cents: null,
        },
      ] as unknown as RoleRouting[]),
    });

    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('role-route-select-pm')).toBeDefined();
    });

    const pmSelect = screen.getByTestId('role-route-select-pm').querySelector('select');
    const qaSelect = screen.getByTestId('role-route-select-qa').querySelector('select');
    expect(pmSelect).not.toBeNull();
    expect(qaSelect).not.toBeNull();
    expect(pmSelect).toHaveValue('mock-provider::gpt-4o');
    expect(qaSelect).toHaveValue('mock-provider::gpt-4o-mini');
    expect(pmSelect).not.toHaveValue('');
    expect(qaSelect).not.toHaveValue('');

    const secretaryRow = screen.getByTestId('role-route-select-secretary').closest('tr');
    expect(secretaryRow).not.toBeNull();
    expect(secretaryRow).toHaveTextContent('Secretary');
  });

  it('resets save button loading state on failure when adding a provider', async () => {
    const client = createClient({
      addProvider: vi.fn().mockRejectedValue(new Error('HTTP 401: HTTP 401: {"error":{"message":"Unauthorized key"}}')),
    });
    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-add-button')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('provider-add-button'));
    await waitFor(() => {
      expect(screen.getByTestId('add-provider-dialog')).toBeDefined();
    });

    const nameInput = screen.getByTestId('provider-form-name').querySelector('input')!;
    const keyInput = screen.getByTestId('provider-form-key').querySelector('input')!;
    fireEvent.change(nameInput, { target: { value: 'test-provider' } });
    fireEvent.change(keyInput, { target: { value: 'sk-secret-key-123' } });

    const saveBtn = screen.getByRole('button', { name: 'Save provider' });
    expect(saveBtn).not.toHaveAttribute('aria-busy');

    fireEvent.click(saveBtn);

    // Error banner renders sanitized message (single prefix, extracted from JSON, secret redacted)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByRole('alert')).toHaveTextContent('HTTP 401: Unauthorized key');
    });

    // Save button loading state is reset
    expect(saveBtn).not.toHaveAttribute('aria-busy');
    expect(saveBtn).not.toBeDisabled();
  });

  it('m2: removes/hides stray unknown badge next to custom endpoint (e.g. 9router)', async () => {
    const customProviders: ProviderConfig[] = [
      {
        name: '9router',
        kind: 'custom',
        enabled: true,
        api_base: 'http://127.0.0.1:8000/v1',
      },
    ];
    const client = createClient({
      listProviders: vi.fn().mockResolvedValue(customProviders),
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'none' }),
    });

    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-9router')).toBeDefined();
    });

    const row = screen.getByTestId('provider-row-9router');
    expect(within(row).getByText('http://127.0.0.1:8000/v1')).toBeDefined();
    expect(within(row).queryByText('Unknown')).toBeNull();
  });

  it('m2: removes/hides stray unknown badge in Arabic next to custom endpoint', async () => {
    const customProviders: ProviderConfig[] = [
      {
        name: '9router',
        kind: 'custom',
        enabled: true,
        api_base: 'http://127.0.0.1:8000/v1',
      },
    ];
    const client = createClient({
      listProviders: vi.fn().mockResolvedValue(customProviders),
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'none' }),
    });

    renderSection(client, 'ar');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-9router')).toBeDefined();
    });

    const row = screen.getByTestId('provider-row-9router');
    expect(within(row).getByText('http://127.0.0.1:8000/v1')).toBeDefined();
    expect(within(row).queryByText('غير معروف')).toBeNull();
  });

  it('opens prefilled login dialog on api_key response, upserts key, and refreshes providers', async () => {
    const providers: ProviderConfig[] = [
      {
        name: '9router',
        kind: 'custom',
        enabled: true,
        api_base: 'http://127.0.0.1:8000/v1',
        last_test_ok: false,
      },
    ];
    const listProviders = vi.fn().mockResolvedValue(providers);
    const addProvider = vi.fn().mockResolvedValue(undefined);
    const providerAuthStart = vi
      .fn()
      .mockResolvedValue({ kind: 'api_key', name: '9router' });
    const client = createClient({
      listProviders,
      addProvider,
      providerAuthStart,
    });

    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-9router')).toBeDefined();
    });

    const row = screen.getByTestId('provider-row-9router');
    const loginBtn = row.querySelector('[data-action="settings.provider.login"]') as HTMLElement;
    expect(loginBtn).toBeDefined();
    fireEvent.click(loginBtn);

    await waitFor(() => {
      expect(screen.getByTestId('provider-login-dialog')).toBeDefined();
    });
    expect(providerAuthStart).toHaveBeenCalledWith('9router');

    const dialog = screen.getByTestId('provider-login-dialog');
    expect(dialog.textContent).toContain('Log in to 9router');
    const nameInput = within(dialog).getByTestId('provider-form-name').querySelector('input')!;
    const kindSelect = within(dialog).getByTestId('provider-form-kind').querySelector('select')!;
    const apiBaseInput = within(dialog).getByTestId('provider-form-api-base').querySelector('input')!;
    const keyInput = within(dialog).getByTestId('provider-form-key').querySelector('input')!;

    expect(nameInput.value).toBe('9router');
    expect(nameInput.disabled).toBe(true);
    expect(kindSelect.value).toBe('custom');
    expect(apiBaseInput.value).toBe('http://127.0.0.1:8000/v1');
    expect(keyInput.value).toBe('');
    expect(keyInput.required).toBe(true);

    fireEvent.change(keyInput, { target: { value: 'sk-fresh-9router-key' } });
    const saveBtn = dialog.querySelector('[data-action="settings.provider.add.save"]') as HTMLElement;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(addProvider).toHaveBeenCalledWith({
        name: '9router',
        kind: 'custom',
        key: 'sk-fresh-9router-key',
        api_base: 'http://127.0.0.1:8000/v1',
      });
    });
    await waitFor(() => {
      expect(listProviders.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('keeps pkce window.open behavior on Log in', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const providerAuthStart = vi
      .fn()
      .mockResolvedValue({ kind: 'pkce', url: 'https://auth.example.com/oauth' });
    const client = createClient({ providerAuthStart });

    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    const row = screen.getByTestId('provider-row-mock-provider');
    const loginBtn = row.querySelector('[data-action="settings.provider.login"]') as HTMLElement;
    fireEvent.click(loginBtn);

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://auth.example.com/oauth');
    });
    expect(screen.queryByTestId('provider-login-dialog')).toBeNull();
  });

  it('shows Log in button even when authStatus is authenticated if provider test failed', async () => {
    const client = createClient({
      providerAuthStatus: vi.fn().mockResolvedValue({ kind: 'authenticated' }),
      testProvider: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    });

    renderSection(client, 'en');

    await waitFor(() => {
      expect(screen.getByTestId('provider-row-mock-provider')).toBeDefined();
    });

    const row = screen.getByTestId('provider-row-mock-provider');
    expect(row.querySelector('[data-action="settings.provider.disconnect"]')).not.toBeNull();
    expect(row.querySelector('[data-action="settings.provider.login"]')).toBeNull();

    const testBtn = row.querySelector('[data-action="settings.provider.test"]') as HTMLElement;
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(row.querySelector('[data-action="settings.provider.login"]')).not.toBeNull();
    });
    expect(row.querySelector('[data-action="settings.provider.disconnect"]')).not.toBeNull();
  });
});
