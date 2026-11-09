// @warsha/desktop — the first-run wizard, at the level it can break.
//
// `apps/desktop/e2e/onboarding.spec.ts` drives the real flow in a browser against a stubbed daemon;
// this file pins the details that would be invisible there: which method is called with which
// arguments, what the wizard does when the daemon reports nothing at all, and that the API key never
// comes back out of the screen.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createClient,
  type CustomModelRecord,
  type ModelCatalogDiff,
  type ProjectId,
  type ProjectSummary,
  type ProviderConfig,
  type RoleRoutingConfig,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { Onboarding, builtInProviderChoices, daemonDetail } from './Onboarding';

/** The arguments `providers.add` takes, as `@warsha/client` declares them. */
type AddProviderConfig = { name: string; kind: string; key: string; api_base?: string };

const DAEMON_URL = 'http://127.0.0.1:8766';
const ACCEPTED_KEY = 'sk-warsha-accepted';
const REJECTED_KEY = 'sk-warsha-refused';

const router: ProviderConfig = { name: 'warsha-router', kind: 'open_router', enabled: true };
const localModel: ProviderConfig = { name: 'my-ollama', kind: 'ollama', enabled: false };

const project: ProjectSummary = {
  id: 'proj-created' as ProjectId,
  name: 'متجر ورشة',
  createdAt: '2026-10-05T07:20:00.000Z',
  updatedAt: '2026-10-05T07:20:00.000Z',
};

interface FakeDaemon {
  providers?: ProviderConfig[];
  /** Make `providers.list` reject, which is not the same thing as reporting an empty list. */
  providersFail?: boolean;
  addProvider?: (config: AddProviderConfig) => Promise<ProviderConfig>;
  testProvider?: (name: string) => Promise<void>;
  addCustomModel?: (provider: string, modelId: string) => Promise<CustomModelRecord>;
  checkProviderModels?: (name: string) => Promise<ModelCatalogDiff>;
  setRoleConfig?: (config: RoleRoutingConfig) => Promise<void>;
  createProject?: (name: string) => Promise<ProjectSummary>;
}

/** The app's own client with the four calls this screen makes replaced, so nothing reaches a socket. */
function fakeClient(daemon: FakeDaemon): WarshaClient {
  const client = createClient(DAEMON_URL, 'test-token');
  client.listProviders = async () => {
    if (daemon.providersFail === true) throw new Error('RPC error -32603: no daemon');
    return daemon.providers ?? [];
  };
  client.addProvider = daemon.addProvider ?? (async () => router);
  client.testProvider = daemon.testProvider ?? (async () => undefined);
  client.addCustomModel =
    daemon.addCustomModel ??
    (async (provider: string, modelId: string) => ({
      provider,
      modelId,
      displayName: null,
      contextWindow: null,
      enabled: true,
    }));
  client.setRoleConfig = daemon.setRoleConfig ?? (async () => undefined);
  client.checkProviderModels =
    daemon.checkProviderModels ??
    (async (name: string) => ({
      provider: name,
      new_models: [],
      retained_count: 0,
      total_count: 0,
      updated_catalog: [],
    }));
  client.createProject = daemon.createProject ?? (async () => project);
  return client;
}

/** Render the wizard and let its `providers.list` on mount settle. */
async function renderWizard(
  client: WarshaClient | null,
  onComplete: (created: ProjectSummary) => void = () => undefined
): Promise<void> {
  render(
    <LocaleProvider initialLocale="ar" storage={null}>
      <Onboarding client={client} onComplete={onComplete} />
    </LocaleProvider>
  );
  await screen.findByTestId('onboarding-language');
}

/** Walk from the language step to the key step, picking the first provider the screen offers. */
async function reachKeyStep(): Promise<void> {
  fireEvent.click(screen.getByTestId('onboarding-language-next'));
  const choices = await screen.findByTestId('onboarding-provider-choices');
  fireEvent.click(choices.querySelectorAll('button')[0]);
  fireEvent.click(screen.getByTestId('onboarding-provider-next'));
  await screen.findByTestId('onboarding-key');
}

/**
 * Type a key, add the provider and wait for the test's outcome.
 *
 * The test screen exists while the call is still in flight (`data-status="running"`), so the wait is
 * on the settled status rather than on the step.
 */
async function connect(key: string, outcome: 'passed' | 'refused'): Promise<void> {
  fireEvent.change(screen.getByTestId('onboarding-key-input'), { target: { value: key } });
  fireEvent.click(screen.getByTestId('onboarding-connect'));
  await waitFor(() =>
    expect(screen.getByTestId('onboarding-test')).toHaveAttribute('data-status', outcome)
  );
}

/** Reach the project step through a connection test that passed. */
async function reachProjectStep(): Promise<void> {
  await reachKeyStep();
  await connect(ACCEPTED_KEY, 'passed');
  fireEvent.click(screen.getByTestId('onboarding-test-continue'));
  await screen.findByTestId('onboarding-project');
}

describe('provider step', () => {
  it('lists what the daemon reported and needs a choice before it continues', async () => {
    const listProviders = vi.fn(async () => [router, localModel]);
    const client = fakeClient({});
    client.listProviders = listProviders;

    await renderWizard(client);
    fireEvent.click(screen.getByTestId('onboarding-language-next'));

    // The daemon's list is the choice list, and each row is one of the daemon's own providers.
    const first = await screen.findByTestId('onboarding-provider-warsha-router');
    expect(listProviders).toHaveBeenCalled();
    // The catalog names the kind; the name the daemon reported stays on the row.
    expect(first).toHaveTextContent(t('onboarding.provider_kind.open_router', {}, 'ar'));
    expect(first).toHaveTextContent('warsha-router');
    expect(first).toHaveAttribute('aria-pressed', 'false');
    // A kind the catalog does not carry keeps the daemon's own name.
    expect(screen.getByTestId('onboarding-provider-my-ollama')).toHaveTextContent('my-ollama');

    expect(screen.getByTestId('onboarding-provider-next')).toBeDisabled();
    fireEvent.click(first);
    expect(screen.getByTestId('onboarding-provider-warsha-router')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('onboarding-provider-next')).toBeEnabled();
  });

  it('offers its own kinds when the daemon reports no providers at all', async () => {
    await renderWizard(fakeClient({ providers: [] }));
    // Problem 1 check: language step shows progress indicator and steps hint
    expect(screen.getByTestId('onboarding-steps-hint')).toBeInTheDocument();
    expect(screen.getByText(t('onboarding.step_of', { current: 1, total: 5 }, 'ar'))).toBeInTheDocument();
    expect(screen.getByText(t('onboarding.steps_hint', {}, 'ar'))).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('onboarding-language-next'));

    expect(await screen.findByTestId('onboarding-provider-open_router')).toHaveTextContent(
      t('onboarding.provider_kind.open_router', {}, 'ar')
    );
    expect(screen.getByTestId('onboarding-provider-qwen')).toBeInTheDocument();

    // Problem 2 check: DeepSeek shows recommended badge and provider hint
    expect(screen.getByTestId('onboarding-provider-deep_seek')).toHaveTextContent(
      t('onboarding.provider_recommended', {}, 'ar')
    );
    expect(screen.getByText(t('onboarding.provider_hint.deep_seek', {}, 'ar'))).toBeInTheDocument();
    // The custom endpoint is the sixth choice and is always offered: it is the way in for any
    // OpenAI-compatible provider the daemon has no preset for.
    expect(screen.getByTestId('onboarding-provider-custom')).toBeInTheDocument();
  });

  it('says the daemon did not answer rather than reporting an empty list', async () => {
    await renderWizard(fakeClient({ providersFail: true }));
    fireEvent.click(screen.getByTestId('onboarding-language-next'));

    expect(await screen.findByTestId('onboarding-provider-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-provider-choices')).not.toBeInTheDocument();
  });

  it('reports a daemon that is not there yet instead of offering a list it never got', async () => {
    await renderWizard(null);
    fireEvent.click(screen.getByTestId('onboarding-language-next'));

    expect(
      await screen.findByText(t('onboarding.provider_unreachable', {}, 'ar'))
    ).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-provider-choices')).not.toBeInTheDocument();
  });
});

describe('connect and test', () => {
  it('adds the provider then tests it, and reports the pass', async () => {
    const addProvider = vi.fn(async (_config: AddProviderConfig) => router);
    const testProvider = vi.fn(async (_name: string) => undefined);

    await renderWizard(fakeClient({ providers: [router], addProvider, testProvider }));
    await reachKeyStep();

    await connect(`  ${ACCEPTED_KEY}  `, 'passed');

    // The key is trimmed, and it travels with the daemon's own name and kind. `providers.add` is
    // awaited before `providers.test`, so the order of these two calls is the flow.
    expect(addProvider.mock.calls[0][0]).toEqual({
      name: 'warsha-router',
      kind: 'open_router',
      key: ACCEPTED_KEY,
    });
    expect(testProvider.mock.calls[0][0]).toBe('warsha-router');
    expect(screen.getByTestId('onboarding-test-continue')).toBeEnabled();
  });

  it('reports a refused key, scrubs the key out of the daemon message and wipes the field', async () => {
    const testProvider = vi.fn(async (_name: string) => {
      throw new Error(`RPC error -32001: this provider refused ${REJECTED_KEY}`);
    });

    await renderWizard(fakeClient({ providers: [router], testProvider }));
    await reachKeyStep();

    await connect(REJECTED_KEY, 'refused');

    // The daemon's message is data, so it is shown — with the key taken out of it.
    const detail = screen.getByTestId('onboarding-test-detail');
    expect(detail).toHaveTextContent('refused');
    expect(detail).not.toHaveTextContent(REJECTED_KEY);
    // A refusal is not a dead end: retry with another key, or pick another provider.
    expect(screen.getByTestId('onboarding-test-retry')).toBeEnabled();
    expect(screen.getByTestId('onboarding-test-repick')).toBeEnabled();

    fireEvent.click(screen.getByTestId('onboarding-test-retry'));
    // The key the daemon has is not handed back to the screen.
    expect(screen.getByTestId('onboarding-key-input')).toHaveValue('');
  });

  it('registers a custom endpoint, its model and all twelve routes, then tests it', async () => {
    const addProvider = vi.fn(async (_config: AddProviderConfig) => ({
      name: '9router',
      kind: 'custom',
      enabled: true,
      api_base: 'https://router.example/v1',
    }));
    const addCustomModel = vi.fn(async () => ({
      provider: '9router',
      modelId: 'deepseek-v4',
      displayName: null,
      contextWindow: null,
      enabled: true,
    }));
    const setRoleConfig = vi.fn(async (_config: RoleRoutingConfig) => undefined);
    const testProvider = vi.fn(async (_name: string) => undefined);

    await renderWizard(
      fakeClient({ providers: [], addProvider, testProvider, addCustomModel, setRoleConfig })
    );
    fireEvent.click(screen.getByTestId('onboarding-language-next'));
    fireEvent.click(await screen.findByTestId('onboarding-provider-custom'));
    fireEvent.click(screen.getByTestId('onboarding-provider-next'));
    await screen.findByTestId('onboarding-key');

    fireEvent.change(screen.getByTestId('onboarding-custom-name'), {
      target: { value: '9router' },
    });
    fireEvent.change(screen.getByTestId('onboarding-custom-base'), {
      target: { value: 'https://router.example/v1' },
    });
    fireEvent.change(screen.getByTestId('onboarding-custom-model'), {
      target: { value: 'deepseek-v4' },
    });
    fireEvent.change(screen.getByTestId('onboarding-key-input'), {
      target: { value: ACCEPTED_KEY },
    });
    fireEvent.click(screen.getByTestId('onboarding-connect'));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-test')).toHaveAttribute('data-status', 'passed')
    );
    expect(addProvider.mock.calls[0][0]).toEqual({
      name: '9router',
      kind: 'custom',
      key: ACCEPTED_KEY,
      api_base: 'https://router.example/v1',
    });
    expect(addCustomModel.mock.calls[0]).toEqual(['9router', 'deepseek-v4']);
    expect(setRoleConfig).toHaveBeenCalledTimes(12);
    expect(testProvider.mock.calls[0][0]).toBe('9router');
  });

  it('fetches the custom provider’s live models and picks one', async () => {
    const addProvider = vi.fn(async () => ({
      name: '9router',
      kind: 'custom',
      enabled: true,
      api_base: 'https://router.example/v1',
    }));
    const checkProviderModels = vi.fn(async () => ({
      provider: '9router',
      new_models: [],
      retained_count: 0,
      total_count: 1,
      updated_catalog: [
        {
          id: 'deepseek-v4',
          name: 'DeepSeek V4',
          provider: '9router',
          context_window: 128000,
          max_output: 8192,
          pricing: { input_per_million_cents: 0, output_per_million_cents: 0 },
        },
      ],
    }));

    await renderWizard(fakeClient({ providers: [], addProvider, checkProviderModels }));
    fireEvent.click(screen.getByTestId('onboarding-language-next'));
    fireEvent.click(await screen.findByTestId('onboarding-provider-custom'));
    fireEvent.click(screen.getByTestId('onboarding-provider-next'));
    await screen.findByTestId('onboarding-key');

    fireEvent.change(screen.getByTestId('onboarding-custom-name'), {
      target: { value: '9router' },
    });
    fireEvent.change(screen.getByTestId('onboarding-custom-base'), {
      target: { value: 'https://router.example/v1' },
    });
    fireEvent.change(screen.getByTestId('onboarding-key-input'), {
      target: { value: ACCEPTED_KEY },
    });
    fireEvent.click(screen.getByTestId('onboarding-custom-fetch-button'));

    await waitFor(() => expect(checkProviderModels).toHaveBeenCalledWith('9router'));
    fireEvent.click(await screen.findByTestId('onboarding-custom-discovery-deepseek-v4'));
    expect(screen.getByTestId('onboarding-custom-model')).toHaveValue('deepseek-v4');
  });
});

describe('first project', () => {
  it('creates it under the typed name and hands it to the shell', async () => {
    const createProject = vi.fn(async (_name: string) => project);
    const onComplete = vi.fn();

    await renderWizard(fakeClient({ providers: [router], createProject }), onComplete);
    await reachProjectStep();

    expect(screen.getByTestId('onboarding-project-create')).toBeDisabled();
    fireEvent.change(screen.getByTestId('onboarding-project-input'), {
      target: { value: `  ${project.name}  ` },
    });
    fireEvent.click(screen.getByTestId('onboarding-project-create'));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(project));
    expect(createProject.mock.calls[0][0]).toBe(project.name);
  });

  it('says so when the daemon refuses to create the project', async () => {
    const createProject = vi.fn(async (_name: string) => {
      throw new Error('RPC error -32000: no project');
    });
    const onComplete = vi.fn();

    await renderWizard(fakeClient({ providers: [router], createProject }), onComplete);
    await reachProjectStep();

    fireEvent.change(screen.getByTestId('onboarding-project-input'), {
      target: { value: project.name },
    });
    fireEvent.click(screen.getByTestId('onboarding-project-create'));

    expect(await screen.findByText(t('onboarding.project_failed', {}, 'ar'))).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    // Problem 3 fix: retry button is present and retries createFirstProject
    const retryBtn = screen.getByTestId('onboarding-project-retry');
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(createProject).toHaveBeenCalledTimes(2);
  });
});

describe('the wizard’s own rules', () => {
  it('shows the five rungs as a ruled ledger with the fraction of setup done', async () => {
    await renderWizard(fakeClient({ providers: [] }));

    const rail = screen.getByRole('navigation', { name: t('onboarding.steps_title', {}, 'ar') });
    const rungs = ['language', 'provider', 'key', 'test', 'project'];
    for (const rung of rungs) {
      expect(
        within(rail).getByText(t(`onboarding.step.${rung}`, {}, 'ar'))
      ).toBeInTheDocument();
    }

    // The meter always carries its readout: a bar alone cannot say step 1 of 5 (§9).
    expect(within(rail).getByRole('meter')).toHaveAttribute('aria-valuenow', '1');
    expect(within(rail).getByRole('meter')).toHaveAttribute('aria-valuemax', '5');
    expect(
      within(rail).getByText(t('onboarding.step_of', { current: 1, total: 5 }, 'ar'))
    ).toBeInTheDocument();
  });

  it('gives every field a label the control answers to', async () => {
    await renderWizard(fakeClient({ providers: [router] }));
    await reachKeyStep();

    const key = screen.getByTestId('onboarding-key-input');
    expect(key).toHaveAccessibleName(t('onboarding.key_label', {}, 'ar'));
    expect(key).toHaveAttribute('aria-required', 'true');
    // A key is machine input: left-to-right and never translated, even on an Arabic bench (§11).
    expect(key).toHaveAttribute('dir', 'ltr');
    expect(key).toHaveAttribute('translate', 'no');

    const hint = document.getElementById('onboarding-key-input-hint');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe(t('onboarding.key_hint', {}, 'ar'));
  });

  it('offers the URL-carrying one-click presets, so one pasted key is the whole input', () => {
    expect(builtInProviderChoices.map((choice) => choice.kind)).toEqual([
      'open_router',
      'deep_seek',
      'kimi',
      'glm',
      'qwen',
    ]);
    for (const choice of builtInProviderChoices) {
      expect(choice.apiBase).toMatch(/^https:\/\//);
      expect(choice.configured).toBe(false);
      expect(choice.name).toBe(choice.kind);
    }
  });

  it('takes the key out of a daemon message instead of putting it on screen', () => {
    expect(daemonDetail(new Error(`refused ${REJECTED_KEY} here`), REJECTED_KEY)).toBe(
      'refused [redacted] here'
    );
    // Nothing worth showing: a value that is not an Error, a blank message, and no key to scrub.
    expect(daemonDetail('a string, not an Error', REJECTED_KEY)).toBeNull();
    expect(daemonDetail(new Error('   '), REJECTED_KEY)).toBeNull();
    expect(daemonDetail(new Error('refused'), '')).toBe('refused');
  });
});
