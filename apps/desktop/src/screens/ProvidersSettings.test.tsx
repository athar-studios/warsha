// Tests for the providers ledger (B3-secondary redraw): health words, the refused-key path with its next
// action, the add-form's inline validation, and the row-level remove confirmation.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ProviderConfig, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ProvidersSettings } from './ProvidersSettings';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

const providers: ProviderConfig[] = [
  { name: 'openai-main', kind: 'openai', enabled: true, budgetUsd: 50, api_base: 'https://api.openai.com/v1' },
  { name: 'local-ollama', kind: 'ollama', enabled: false },
];

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listProviders = vi.fn(async () => providers);
  client.addProvider = vi.fn(async (config: { name: string; kind: string; key: string; api_base?: string }) => ({
    name: config.name,
    kind: config.kind,
    enabled: true,
  }));
  client.testProvider = vi.fn(async () => undefined);
  client.removeProvider = vi.fn(async () => undefined);
  client.addCustomModel = vi.fn(async (provider: string, modelId: string, displayName?: string) => ({
    provider,
    modelId,
    displayName: displayName ?? null,
    contextWindow: null,
    enabled: true,
  }));
  client.setRoleConfig = vi.fn(async () => undefined);
  client.checkProviderModels = vi.fn(async () => ({
    provider: 'openai-main',
    new_models: [],
    retained_count: 0,
    total_count: 1,
    updated_catalog: [
      {
        id: 'gpt-4o-mini',
        name: 'Mini 4o',
        provider: 'openai-main',
        context_window: 128000,
        max_output: 16384,
        pricing: { input_per_million_cents: 15, output_per_million_cents: 60 },
      },
    ],
  }));
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <ProvidersSettings client={client} onBack={() => undefined} />
    </LocaleProvider>
  );
}

describe('ProvidersSettings', () => {
  it('rules the configured providers with their kind, endpoint and budget', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('providers.title') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    expect(within(rows[0] as HTMLElement).getByText('openai-main')).toBeInTheDocument();
    // An endpoint is machine data: mono and isolated even inside the Arabic ledger (§11).
    const endpoint = within(rows[0] as HTMLElement).getByText('https://api.openai.com/v1');
    expect(endpoint).toHaveAttribute('dir', 'ltr');
    expect(endpoint).toHaveAttribute('translate', 'no');
    expect(within(rows[0] as HTMLElement).getByText('$50.00')).toBeInTheDocument();

    // Nothing has been probed yet, so the health line says exactly that (§7).
    expect(within(rows[0] as HTMLElement).getByText(ar('providers.probe.none'))).toBeInTheDocument();
    // A disabled provider is a word and a glyph, not a colour (§9).
    expect(within(rows[1] as HTMLElement).getByText(ar('providers.state.disabled'))).toBeInTheDocument();
  });

  it('states the keychain rule once, above the ledger', async () => {
    renderScreen();

    expect(await screen.findByText(ar('providers.key.note'))).toBeInTheDocument();
  });

  it('probes a provider and lights the health word it comes back with', async () => {
    const client = clientStub();
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('providers.title') });
    fireEvent.click(within(ledger).getAllByRole('button', { name: ar('providers.test_connection') })[0] as HTMLElement);

    await waitFor(() =>
      expect(within(ledger).getAllByText(ar('providers.health.ok')).length).toBeGreaterThan(0)
    );
    expect(client.testProvider).toHaveBeenCalledWith('openai-main');
  });

  it('fetches the provider’s models and adds the chosen one to the catalog', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('provider-fetch-models-openai-main'));
    await waitFor(() => expect(client.checkProviderModels).toHaveBeenCalledWith('openai-main'));
    fireEvent.click(await screen.findByTestId('provider-add-model-openai-main-gpt-4o-mini'));

    await waitFor(() =>
      expect(client.addCustomModel).toHaveBeenCalledWith('openai-main', 'gpt-4o-mini', 'Mini 4o')
    );
    expect(
      await screen.findByText(t('providers.models_added', { name: 'gpt-4o-mini' }, 'ar'))
    ).toBeInTheDocument();
  });

  it('names a refused key, says what to do about it, and lights only then', async () => {
    const client = clientStub({
      testProvider: vi.fn(async () => {
        throw new Error('provider returned 401 unauthorized');
      }),
    });
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('providers.title') });
    fireEvent.click(within(ledger).getAllByRole('button', { name: ar('providers.test_connection') })[0] as HTMLElement);

    // The problem, the daemon's own words, and the next action — all inline on the row (§7).
    expect(await screen.findByText(ar('errors.provider_unauthorized'))).toBeInTheDocument();
    expect(screen.getByText(ar('errors.provider_unauthorized_hint'))).toBeInTheDocument();
    expect(screen.getByText('provider returned 401 unauthorized')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(ar('providers.health.fail'))).toBeInTheDocument();
    // The lit chip is the owner's queue, and it appears for this failure alone (§1).
    expect(within(ledger).getAllByText(ar('providers.update_key')).length).toBeGreaterThan(0);
  });

  it('confirms a removal on the row instead of asking the browser', async () => {
    const client = clientStub();
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('providers.title') });
    const firstRow = within(ledger).getAllByRole('listitem')[0] as HTMLElement;
    fireEvent.click(within(firstRow).getByRole('button', { name: ar('providers.remove') }));

    // No `window.confirm`: the question and its two answers are on the bench (§9's keyboard path).
    expect(within(firstRow).getByRole('button', { name: ar('providers.remove_yes') })).toBeInTheDocument();
    expect(within(firstRow).getByRole('button', { name: ar('common.cancel') })).toBeInTheDocument();
    expect(client.removeProvider).not.toHaveBeenCalled();

    fireEvent.click(within(firstRow).getByRole('button', { name: ar('providers.remove_yes') }));
    await waitFor(() => expect(client.removeProvider).toHaveBeenCalledWith('openai-main'));
    expect(await within(ledger).findAllByRole('listitem')).toHaveLength(1);
  });

  it('keeps the provider on the ledger when the daemon refuses the delete', async () => {
    const client = clientStub({
      removeProvider: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('providers.title') });
    const first = within(ledger).getAllByRole('listitem')[0] as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: ar('providers.remove') }));
    fireEvent.click(within(first).getByRole('button', { name: ar('providers.remove_yes') }));

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('openai-main');
    expect(banner).toHaveTextContent(ar('providers.remove_failed'));
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(2);
  });

  describe('the add-provider plate', () => {
    it('validates inline and refuses an empty submission', async () => {
      const client = clientStub();
      renderScreen(client);

      fireEvent.click(await screen.findByRole('button', { name: ar('providers.add') }));
      fireEvent.submit(screen.getByPlaceholderText('openrouter-main').closest('form') as HTMLFormElement);

      expect(await screen.findByText(ar('providers.name_needed'))).toBeInTheDocument();
      expect(screen.getByText(ar('router.setup.reason.key_empty'))).toBeInTheDocument();
      expect(client.addProvider).not.toHaveBeenCalled();
    });

    it('rejects an endpoint that is not a URL, near the field', async () => {
      renderScreen();

      fireEvent.click(await screen.findByRole('button', { name: ar('providers.add') }));
      fireEvent.change(screen.getByRole('textbox', { name: /اسم المزوّد/ }), { target: { value: 'mine' } });
      // A password field is not a `textbox`; the placeholder is its own handle.
      fireEvent.change(screen.getByPlaceholderText(ar('providers.api_key_placeholder')), {
        target: { value: 'sk-test' },
      });
      const base = screen.getByRole('textbox', { name: /قاعدة API/ });
      fireEvent.change(base, { target: { value: 'api.example.com' } });
      fireEvent.blur(base);

      expect(await screen.findByText(ar('router.setup.reason.url_scheme'))).toBeInTheDocument();
    });

    it('adds the provider through the daemon and records it quietly', async () => {
      const client = clientStub();
      renderScreen(client);

      fireEvent.click(await screen.findByRole('button', { name: ar('providers.add') }));
      fireEvent.change(screen.getByRole('textbox', { name: /اسم المزوّد/ }), { target: { value: 'mine' } });
      fireEvent.change(screen.getByRole('combobox', { name: new RegExp(ar('providers.type')) }), {
        target: { value: 'open_router' },
      });
      fireEvent.change(screen.getByPlaceholderText(ar('providers.api_key_placeholder')), {
        target: { value: 'sk-or-test' },
      });
      fireEvent.submit(screen.getByPlaceholderText('openrouter-main').closest('form') as HTMLFormElement);

      await waitFor(() =>
        expect(client.addProvider).toHaveBeenCalledWith({
          name: 'mine',
          kind: 'open_router',
          key: 'sk-or-test',
        })
      );
      const ledger = await screen.findByRole('list', { name: ar('providers.title') });
      expect(within(ledger).getByText('mine')).toBeInTheDocument();
      expect(screen.getByText(`mine — ${ar('providers.added')}`)).toBeInTheDocument();
    });
  });

  it('says when the daemon does not answer the list, and retries', async () => {
    const client = clientStub({ listProviders: vi.fn(async () => { throw new Error('offline'); }) });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('providers.failed'));

    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listProviders).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state with its one next step', async () => {
    const client = clientStub({ listProviders: vi.fn(async () => [] as ProviderConfig[]) });
    renderScreen(client);

    expect(await screen.findByText(ar('providers.no_providers'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ar('providers.add_first') })).toBeInTheDocument();
  });

  it('reads its ledger in English too', async () => {
    renderScreen(clientStub(), 'en');

    const ledger = await screen.findByRole('list', { name: en('providers.title') });
    expect(within(ledger).getAllByText(en('providers.probe.none'))).toHaveLength(2);
    expect(screen.getByRole('button', { name: en('providers.add') })).toBeInTheDocument();
  });
});
