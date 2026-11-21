import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ALL_ROLES,
  type ModelCatalogDiff,
  type ProjectId,
  type ProjectSummary,
  type ProviderConfig,
  type RunId,
  type RunSummary,
  type WarshaClient,
} from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider, useDataReady } from '../../app/DataReadyContext';
import { clearToastListeners } from '../../app/toast';
import { RouterProvider, useRoute } from '../../router';

import OnboardingPage, {
  deriveProjectName,
  findDefaultBudget,
  isMaskedKey,
  isValidHttpUrl,
  MASKED_KEY_PLACEHOLDER,
  PROVIDER_PRESETS,
  sanitizeSecretError,
} from './index';

function RouteInspector(): React.ReactElement {
  const { pathname } = useRoute();
  return <div data-testid="route-inspector">{pathname}</div>;
}

function ReadyInspector(): React.ReactElement {
  const { isReady } = useDataReady();
  return <div data-testid="ready-inspector">{String(isReady)}</div>;
}

function makeMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const createdProject: ProjectSummary = {
    id: 'proj-123' as ProjectId,
    name: 'Build store',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',

  };
  const startedRun: RunSummary = {
    id: 'run-456' as RunId,
    projectId: 'proj-123' as ProjectId,
    stage: 'idea',
    status: 'running', runMode: 'agent',
    startedAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',

  };
  const modelDiff: ModelCatalogDiff = {
    provider: 'deep_seek',
    new_models: [],
    retained_count: 1,
    total_count: 1,
    updated_catalog: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'deep_seek',
        context_window: 64000,
        max_output: 8192,
        pricing: { input_per_million_cents: 14, output_per_million_cents: 28 },
      },
    ],
  };

  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
    listProviders: vi.fn().mockResolvedValue([]),
    addProvider: vi.fn().mockResolvedValue({ name: 'deep_seek', kind: 'deep_seek', enabled: true }),
    removeProvider: vi.fn().mockResolvedValue(undefined),
    testProvider: vi.fn().mockResolvedValue(undefined),
    checkProviderModels: vi.fn().mockResolvedValue(modelDiff),
    addCustomModel: vi.fn().mockResolvedValue({
      provider: 'deep_seek',
      model_id: 'deepseek-chat',
      display_name: null,
      context_window: null,
      enabled: true,
    }),
    setRoleConfig: vi.fn().mockResolvedValue(undefined),
    createProject: vi.fn().mockResolvedValue(createdProject),
    startRun: vi.fn().mockResolvedValue(startedRun),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    listPreferences: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as WarshaClient;
}

async function renderOnboarding(
  options: {
    client?: WarshaClient;
    initialPath?: string;
    locale?: 'ar' | 'en';
  } = {}
) {
  const { client = makeMockClient(), initialPath = '/onboarding', locale = 'ar' } = options;

  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ClientProvider client={client}>
        <CapabilitiesProvider client={client}>
          <I18nProvider initialLocale={locale}>
            <DataReadyProvider>
              <RouterProvider initialPath={initialPath}>
                <RouteInspector />
                <ReadyInspector />
                <OnboardingPage />
              </RouterProvider>
            </DataReadyProvider>
          </I18nProvider>
        </CapabilitiesProvider>
      </ClientProvider>
    );
    await Promise.resolve();
  });

  return utils;
}

describe('Onboarding helper utilities', () => {
  it('validates HTTP/HTTPS URLs cleanly', () => {
    expect(isValidHttpUrl('https://api.example.com/v1')).toBe(true);
    expect(isValidHttpUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });

  it('redacts secret keys from daemon error messages', () => {
    const err = new Error('auth failed for token sk-secret-12345 on server');
    expect(sanitizeSecretError(err, 'sk-secret-12345')).toBe(
      'auth failed for token [redacted] on server'
    );
    expect(sanitizeSecretError(err, '')).toBe(err.message);
  });

  it('derives project name from first line up to 60 chars', () => {
    expect(deriveProjectName('My Store\nWith inventory')).toBe('My Store');
    const longLine = 'A'.repeat(80);
    expect(deriveProjectName(longLine)).toHaveLength(60);
  });

  it('findDefaultBudget returns 10 by default or parses default_budget_usd preference', () => {
    expect(findDefaultBudget(null)).toBe(10);
    expect(findDefaultBudget(undefined)).toBe(10);
    expect(findDefaultBudget([])).toBe(10);
    expect(findDefaultBudget([{ key: 'other', score: 50 }])).toBe(10);
    expect(findDefaultBudget([{ key: 'default_budget_usd', score: 15 }])).toBe(15);
    expect(findDefaultBudget([{ key: 'default_budget_usd', score: -5 }])).toBe(10);
    expect(findDefaultBudget([{ key: 'default_budget_usd', score: 0 }])).toBe(10);
  });
});

describe('OnboardingPage', () => {
  beforeEach(() => {
    clearToastListeners();
    window.location.hash = '';
    try {
      window.localStorage?.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('renders loading skeleton while providers are pending and sets ready=false', async () => {
    const pendingResolvers: ((val: ProviderConfig[]) => void)[] = [];
    const client = makeMockClient({
      listProviders: vi.fn(
        () =>
          new Promise<ProviderConfig[]>((resolve) => {
            pendingResolvers.push(resolve);
          })
      ),
    });

    await renderOnboarding({ client });

    expect(screen.getByTestId('onboarding-loading')).toBeTruthy();
    expect(screen.getByTestId('ready-inspector').textContent).toBe('false');

    await act(async () => {
      pendingResolvers.forEach((r) => r([]));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('ready-inspector').textContent).toBe('true');
      expect(screen.getByTestId('onboarding-step-language')).toBeTruthy();
    });
  });

  it('renders error banner and retries when providers.list fails', async () => {
    const listProviders = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValue([]);
    const client = makeMockClient({ listProviders });

    window.location.hash = '#/onboarding?step=provider';
    await renderOnboarding({ client, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-error-banner')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await Promise.resolve();
    });

    expect(listProviders.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('handles step 1 language picking and enforces max 1 primary button', async () => {
    const { container } = await renderOnboarding({ locale: 'ar' });

    const arBtn = screen.getByTestId('onboarding-lang-ar');
    const enBtn = screen.getByTestId('onboarding-lang-en');
    expect(arBtn.getAttribute('aria-pressed')).toBe('true');
    expect(enBtn.getAttribute('aria-pressed')).toBe('false');

    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(enBtn);
    });

    expect(enBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Onboarding');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Choose your language');

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    expect(screen.getByTestId('onboarding-step-provider')).toBeTruthy();
  });

  it('renders all 7 providers, empty banner, and validates API key before save-test', async () => {
    const client = makeMockClient();
    await renderOnboarding({ client, locale: 'ar' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    expect(screen.getByTestId('onboarding-empty-banner')).toBeTruthy();
    for (const preset of PROVIDER_PRESETS) {
      expect(screen.getByTestId(`onboarding-provider-${preset.kind}`)).toBeTruthy();
    }

    // Clicking save-test with empty key flags validation error and does not dial RPC
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
    });

    expect(client.addProvider).not.toHaveBeenCalled();
    expect(screen.getByText('أدخل مفتاح API')).toBeTruthy();
  });

  it('runs add + test, wipes secret, fetches models, and routes all 12 roles', async () => {
    const client = makeMockClient();
    const { container } = await renderOnboarding({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);

    const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'sk-warsha-accepted' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-test-success')).toBeTruthy();
      expect((screen.getByLabelText(/API key/i) as HTMLInputElement).value).toBe('');
    });

    expect(client.addProvider).toHaveBeenCalledWith({
      name: 'deep_seek',
      kind: 'deep_seek',
      key: 'sk-warsha-accepted',
      api_base: 'https://api.deepseek.com/v1',
    });
    expect(client.testProvider).toHaveBeenCalledWith('deep_seek');
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);

    // Fetch models
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-fetch-models-btn'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(client.checkProviderModels).toHaveBeenCalledWith('deep_seek');
      expect(screen.getByTestId('onboarding-model-select')).toBeTruthy();
    });

    // Use model
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-use-model-btn'));
      await Promise.resolve();
    });

    expect(client.addCustomModel).toHaveBeenCalledWith('deep_seek', 'deepseek-chat');
    expect(client.setRoleConfig).toHaveBeenCalledTimes(ALL_ROLES.length);
  });

  it('redacts secret key if testProvider fails with echoed key', async () => {
    const client = makeMockClient({
      testProvider: vi.fn().mockRejectedValue(new Error('Bad key sk-secret-xyz refused')),
    });
    await renderOnboarding({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'sk-secret-xyz' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
      await Promise.resolve();
    });

    await waitFor(() => {
      const errorBanner = screen.getByTestId('onboarding-test-error');
      expect(errorBanner.textContent).toContain('[redacted]');
      expect(errorBanner.textContent).not.toContain('sk-secret-xyz');
    });
  });

  it('handles custom endpoint validation and 12-role routing on save-test', async () => {
    const client = makeMockClient();
    await renderOnboarding({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-provider-custom'));
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Provider name/i), { target: { value: 'local-vllm' } });
      fireEvent.change(screen.getByLabelText(/Base URL/i), {
        target: { value: 'http://127.0.0.1:8000/v1' },
      });
      fireEvent.change(screen.getByLabelText(/Model ID/i), { target: { value: 'qwen-32b' } });
      fireEvent.change(screen.getByLabelText(/API key/i), { target: { value: 'sk-custom-token' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(client.addProvider).toHaveBeenCalledWith({
        name: 'local-vllm',
        kind: 'custom',
        key: 'sk-custom-token',
        api_base: 'http://127.0.0.1:8000/v1',
      });
      expect(client.addCustomModel).toHaveBeenCalledWith('local-vllm', 'qwen-32b');
      expect(client.setRoleConfig).toHaveBeenCalledTimes(ALL_ROLES.length);
      expect(client.testProvider).toHaveBeenCalledWith('local-vllm');
    });
  });

  it('handles step 3 idea creation (projects.create + runs.start + config + nav) and later skip', async () => {
    const setConfigSpy = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: unknown) => {
        if (cmd === 'set_config') return setConfigSpy(args);
        return Promise.resolve('');
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => p,
    };

    const client = makeMockClient();
    const { container } = await renderOnboarding({ client, locale: 'en' });

    // Go to step 2 -> step 3
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    expect(screen.getByTestId('onboarding-step-idea')).toBeTruthy();
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);

    // Back returns to step 2
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-back-btn'));
    });
    expect(screen.getByTestId('onboarding-step-provider')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    // Empty idea shows validation error
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-start-btn'));
    });
    expect(client.createProject).not.toHaveBeenCalled();

    // Valid idea creates project and starts run
    const textarea = screen.getByLabelText(/Your first idea/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Build store\nwith full cart' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-start-btn'));
      await Promise.resolve();
    });

    expect(client.createProject).toHaveBeenCalledWith(
      'Build store',
      'Build store\nwith full cart',
      'en'
    );
    expect(client.startRun).toHaveBeenCalledWith('proj-123', 'Build store\nwith full cart');
    expect(client.setProjectBudget).toHaveBeenCalledWith('proj-123', 1000);
    expect(setConfigSpy).toHaveBeenCalledWith({ key: 'onboarding_complete', value: 'true' });
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-123');
  });

  it('later button sets onboarding_complete and navigates to /', async () => {
    const setConfigSpy = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: unknown) => {
        if (cmd === 'set_config') return setConfigSpy(args);
        return Promise.resolve('');
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => p,
    };

    window.location.hash = '#/onboarding?step=idea';
    await renderOnboarding({ locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-later-btn'));
      await Promise.resolve();
    });

    expect(setConfigSpy).toHaveBeenCalledWith({ key: 'onboarding_complete', value: 'true' });
    expect(screen.getByTestId('route-inspector').textContent).toBe('/');
  });

  it('F1 proving test: save-only-after-success (rolls back provider if testProvider fails)', async () => {
    const client = makeMockClient({
      testProvider: vi.fn().mockRejectedValue(new Error('Connection timed out after 8s')),
    });
    await renderOnboarding({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'sk-fail-key' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-test-error')).toBeTruthy();
    });

    expect(client.addProvider).toHaveBeenCalledWith({
      name: 'deep_seek',
      kind: 'deep_seek',
      key: 'sk-fail-key',
      api_base: 'https://api.deepseek.com/v1',
    });
    // Rolled back so provider is not saved
    expect(client.removeProvider).toHaveBeenCalledWith('deep_seek');
    expect(screen.queryByTestId('onboarding-test-success')).toBeNull();
  });

  it('F1 proving test: key-preserved-on-failure (retains user input on test failure)', async () => {
    const client = makeMockClient({
      testProvider: vi.fn().mockRejectedValue(new Error('Unauthorized 401')),
    });
    await renderOnboarding({ client, locale: 'en' });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-next-btn'));
    });

    const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'sk-preserve-me-secret-key' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-test-error')).toBeTruthy();
    });

    // Key must be preserved on failure, NOT cleared
    expect(keyInput.value).toBe('sk-preserve-me-secret-key');
  });

  it('G4 proving test: masked-key restored wizard healthy (reflects healthy state, skips re-test on save, never exposes real key)', async () => {
    const existingProvider: ProviderConfig = {
      name: 'deep_seek',
      kind: 'deep_seek',
      enabled: true,
    };
    const client = makeMockClient({
      listProviders: vi.fn().mockResolvedValue([existingProvider]),
    });

    // Relaunch / restored onboarding wizard
    window.location.hash = '#/onboarding?step=provider';
    await renderOnboarding({ client, locale: 'en', initialPath: '/onboarding?step=provider' });

    await waitFor(() => {
      const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
      expect(keyInput.value).toBe(MASKED_KEY_PLACEHOLDER);
    });

    // Healthy state reflected: no red failure banner, success indicator shown
    expect(screen.queryByTestId('onboarding-test-error')).toBeNull();
    expect(screen.getByTestId('onboarding-test-success')).toBeTruthy();

    const keyInput = screen.getByLabelText(/API key/i) as HTMLInputElement;
    expect(isMaskedKey(keyInput.value)).toBe(true);
    // Never displays real secret key
    expect(keyInput.value).not.toContain('sk-');

    // Submitting with masked key skips destructive re-test or re-save
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-save-test-btn'));
      await Promise.resolve();
    });

    // Did not invoke addProvider with placeholder
    expect(client.addProvider).not.toHaveBeenCalled();
    // Did not invoke testProvider
    expect(client.testProvider).not.toHaveBeenCalled();
    // Still healthy
    expect(screen.queryByTestId('onboarding-test-error')).toBeNull();
    expect(screen.getByTestId('onboarding-test-success')).toBeTruthy();
  });

  it('N2 proving test: wizard start calls createProject -> startRun -> setProjectBudget in order with 1000 cents default and navigates to /p/:id', async () => {
    const callOrder: string[] = [];
    const client = makeMockClient({
      createProject: vi.fn().mockImplementation(async () => {
        callOrder.push('createProject');
        return {
          id: 'proj-n2' as ProjectId,
          name: 'N2 Project',
          description: 'Idea for N2',
          path: '/path/to/n2',
          createdAt: '2026-11-21T00:00:00.000Z',
          updatedAt: '2026-11-21T00:00:00.000Z',
        };
      }),
      startRun: vi.fn().mockImplementation(async () => {
        callOrder.push('startRun');
        return {
          id: 'run-n2' as RunId,
          projectId: 'proj-n2' as ProjectId,
          stage: 'idea',
          status: 'running',
          runMode: 'agent',
          startedAt: '2026-11-21T00:00:00.000Z',
          updatedAt: '2026-11-21T00:00:00.000Z',
        };
      }),
      setProjectBudget: vi.fn().mockImplementation(async () => {
        callOrder.push('setProjectBudget');
      }),
    });

    const setConfigSpy = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: unknown) => {
        if (cmd === 'set_config') {
          callOrder.push('markOnboardingComplete');
          return setConfigSpy(args);
        }
        return Promise.resolve('');
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => p,
    };

    window.location.hash = '#/onboarding?step=idea';
    await renderOnboarding({ client, locale: 'en', initialPath: '/onboarding?step=idea' });

    const textarea = screen.getByLabelText(/Your first idea/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'N2 Project Idea\nWith multiple lines' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-start-btn'));
      await Promise.resolve();
    });

    // Check parameters
    expect(client.createProject).toHaveBeenCalledWith(
      'N2 Project Idea',
      'N2 Project Idea\nWith multiple lines',
      'en'
    );
    expect(client.startRun).toHaveBeenCalledWith('proj-n2', 'N2 Project Idea\nWith multiple lines');
    expect(client.setProjectBudget).toHaveBeenCalledWith('proj-n2', 1000);

    // Assert exact order: createProject -> startRun -> setProjectBudget -> markOnboardingComplete
    expect(callOrder).toEqual([
      'createProject',
      'startRun',
      'setProjectBudget',
      'markOnboardingComplete',
    ]);

    // Navigated to /p/:id
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-n2');
  });

  it('N2 proving test: wizard start respects custom default_budget_usd preference', async () => {
    const client = makeMockClient({
      listPreferences: vi.fn().mockResolvedValue([
        { key: 'default_budget_usd', score: 25 },
      ]),
    });

    window.location.hash = '#/onboarding?step=idea';
    await renderOnboarding({ client, locale: 'en', initialPath: '/onboarding?step=idea' });

    const textarea = screen.getByLabelText(/Your first idea/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Custom budget app' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-start-btn'));
      await Promise.resolve();
    });

    // 25 USD -> 2500 cents
    expect(client.setProjectBudget).toHaveBeenCalledWith('proj-123', 2500);
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-123');
  });

  it('N2 proving test: wizard start handles setProjectBudget failure gracefully without blocking navigation or orphaning run', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const budgetError = new Error('Budget service temporarily unreachable');
    const client = makeMockClient({
      setProjectBudget: vi.fn().mockRejectedValue(budgetError),
    });

    const setConfigSpy = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: unknown) => {
        if (cmd === 'set_config') return setConfigSpy(args);
        return Promise.resolve('');
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => p,
    };

    window.location.hash = '#/onboarding?step=idea';
    await renderOnboarding({ client, locale: 'en', initialPath: '/onboarding?step=idea' });

    const textarea = screen.getByLabelText(/Your first idea/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Resilient project idea' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-start-btn'));
      await Promise.resolve();
    });

    // Both project and run were created
    expect(client.createProject).toHaveBeenCalled();
    expect(client.startRun).toHaveBeenCalled();
    expect(client.setProjectBudget).toHaveBeenCalledWith('proj-123', 1000);

    // Warning was logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Failed to set initial project budget:',
      budgetError
    );

    // Navigation and onboarding completion were NOT blocked
    expect(setConfigSpy).toHaveBeenCalledWith({ key: 'onboarding_complete', value: 'true' });
    expect(screen.getByTestId('route-inspector').textContent).toBe('/p/proj-123');

    consoleWarnSpy.mockRestore();
  });
});
