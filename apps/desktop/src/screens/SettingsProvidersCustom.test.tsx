// Tests for the custom-provider section added to Settings → Providers (Wave 2): the collapsed add form,
// the write through `providers.add`, the connection test through `providers.test`, and the rule that the
// API key is cleared the moment it is sent and never rendered back.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ProviderEntry } from '../components/ProviderRow';

import { SettingsProviders } from './SettingsProviders';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

const providers: ProviderEntry[] = [{ name: 'Claude Code', mode: 'notify', pinnedVersion: '1.2.3', enabled: true }];

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const store: { name: string; kind: string; enabled: boolean }[] = [];
  const client = {} as WarshaClient;
  client.addProvider = vi.fn(async (config: { name: string; kind?: string }) => {
    const row = { name: config.name, kind: config.kind ?? 'openai', enabled: true };
    store.push(row);
    return row;
  });
  client.testProvider = vi.fn(async () => undefined);
  client.removeProvider = vi.fn(async (name: string) => {
    const idx = store.findIndex((p) => p.name === name);
    if (idx >= 0) store.splice(idx, 1);
  });
  client.listProviders = vi.fn(async () => [...store]);
  return Object.assign(client, overrides);
}

function renderScreen(client?: WarshaClient, locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <SettingsProviders
        providers={providers}
        onModeChange={() => undefined}
        onToggle={() => undefined}
        onPinVersion={() => undefined}
        client={client}
      />
    </LocaleProvider>
  );
}

describe('SettingsProviders custom providers', () => {
  it('omits the custom section entirely without a client', () => {
    renderScreen();
    expect(screen.queryByTestId('settings-providers-custom')).toBeNull();
  });

  it('starts collapsed and opens the form on demand', () => {
    renderScreen(clientStub());

    const open = screen.getByTestId('settings-providers-custom-add');
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: ar('settings_providers.custom_add') })).toBeNull();

    fireEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: ar('settings_providers.custom_add') });
    expect(within(panel).getByText(ar('settings_providers.kind.openai'))).toBeInTheDocument();
    expect(within(panel).getByText(ar('settings_providers.kind.custom'))).toBeInTheDocument();
    // an empty ledger has nothing to test; only the ledger's own row keeps one connection control (§7).
    expect(within(screen.getByTestId('settings-providers-custom')).queryAllByText(ar('providers.test_connection'))).toHaveLength(0);
  });

  it('adds a custom provider, clears the key and lists the new row', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(screen.getByTestId('settings-providers-custom-add'));
    const panel = screen.getByRole('region', { name: ar('settings_providers.custom_add') });

    fireEvent.change(within(panel).getByRole('textbox', { name: ar('models.display_name') }), {
      target: { value: 'edge-llm' },
    });
    fireEvent.change(within(panel).getByRole('combobox', { name: ar('providers.type') }), {
      target: { value: 'openai' },
    });
    const key = within(panel).getByLabelText(ar('providers.api_key'));
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: 'sk-never-echo-me' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('providers.api_base') }), {
      target: { value: 'https://llm.internal/v1' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('providers.add') }));

    await waitFor(() =>
      expect(client.addProvider).toHaveBeenCalledWith({
        name: 'edge-llm',
        kind: 'openai',
        key: 'sk-never-echo-me',
        api_base: 'https://llm.internal/v1',
      })
    );
    // the draft forgets the key the moment it rides the write (AGENTS.md)
    expect(within(panel).getByLabelText(ar('providers.api_key'))).toHaveValue('');
    expect(screen.queryByDisplayValue('sk-never-echo-me')).toBeNull();
    expect(screen.queryByText('sk-never-echo-me')).toBeNull();

    expect(await screen.findByText(t('settings_providers.custom_added', { name: 'edge-llm' }, 'ar'))).toBeInTheDocument();
    expect(
      await within(screen.getByRole('list', { name: ar('settings_providers.custom_title') })).findByText('edge-llm')
    ).toBeInTheDocument();
  });

  it('tests an added provider and says which way the answer went', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(screen.getByTestId('settings-providers-custom-add'));
    const panel = screen.getByRole('region', { name: ar('settings_providers.custom_add') });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('models.display_name') }), {
      target: { value: 'edge-llm' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('providers.add') }));

    const testButton = await screen.findByTestId('custom-provider-test-edge-llm');
    fireEvent.click(testButton);
    await waitFor(() => expect(client.testProvider).toHaveBeenCalledWith('edge-llm'));
    expect(await screen.findByText(ar('settings_providers.test_ok'))).toBeInTheDocument();

    client.testProvider = vi.fn(async () => {
      throw new Error('timeout');
    });
    fireEvent.click(testButton);
    expect(await screen.findByText(ar('settings_providers.test_failed'))).toBeInTheDocument();
  });

  it('hydrates custom providers on mount and removes a provider on demand', async () => {
    const client = clientStub({
      listProviders: vi.fn(async () => [
        { name: 'remote-llm', kind: 'anthropic', enabled: true },
      ]),
    });
    renderScreen(client);

    expect(await screen.findByText('remote-llm')).toBeInTheDocument();
    const removeBtn = screen.getByTestId('custom-provider-remove-remote-llm');
    fireEvent.click(removeBtn);
    await waitFor(() => expect(client.removeProvider).toHaveBeenCalledWith('remote-llm'));
  });

  it('names the section in English too', async () => {
    renderScreen(clientStub(), 'en');

    expect(screen.getByText(en('settings_providers.custom_title'))).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings-providers-custom-add'));
    expect(await screen.findByText(en('settings_providers.custom_note'))).toBeInTheDocument();
  });
});
