// Tests for the custom model catalogue and role routing (Wave 2): the daemon rows, the static
// capability card, add/remove through `models.*`, and role assignment written through `roles.set`.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type CustomModelRecord, type RoleRouting, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ModelsSettings } from './ModelsSettings';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

const GPT4O: CustomModelRecord = {
  provider: 'openai-main',
  modelId: 'gpt-4o',
  displayName: null,
  contextWindow: 128000,
  enabled: true,
};

const SONNET: CustomModelRecord = {
  provider: 'anthropic-main',
  modelId: 'claude-3-5-sonnet',
  displayName: 'Sonnet',
  contextWindow: null,
  enabled: true,
};

const UNKNOWN: CustomModelRecord = {
  provider: 'ollama-local',
  modelId: 'llama-3.1:8b',
  displayName: null,
  contextWindow: null,
  enabled: true,
};

const CODER_ROUTING: RoleRouting = {
  role: 'coder',
  targets: [{ provider_id: 'openai-main', model_id: 'gpt-4o', weight: 100 }],
  fallback_enabled: true,
  budget_cents_per_run: null,
};

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listCustomModels = vi.fn(async () => [GPT4O, SONNET]);
  client.listRoleRoutings = vi.fn(async () => [CODER_ROUTING]);
  client.listRoles = vi.fn(async () => ['coder' as const]);
  client.addCustomModel = vi.fn(async (provider: string, modelId: string, displayName?: string, contextWindow?: number): Promise<CustomModelRecord> => ({
    provider,
    modelId,
    displayName: displayName ?? null,
    contextWindow: contextWindow ?? null,
    enabled: true,
  }));
  client.removeCustomModel = vi.fn(async () => undefined);
  client.setRoleConfig = vi.fn(async () => undefined);
  client.listProviders = vi.fn(async () => [
    { name: 'openai-main', kind: 'openai', enabled: true },
  ]);
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
      <ModelsSettings client={client} />
    </LocaleProvider>
  );
}

describe('ModelsSettings', () => {
  it('rules the custom catalogue with the daemon facts and the known capability card', async () => {
    renderScreen(clientStub({ listCustomModels: vi.fn(async () => [GPT4O, SONNET, UNKNOWN]) }));

    const catalog = await screen.findByRole('region', { name: ar('models.catalog') });
    const rows = within(catalog).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    // An undeclared display name falls back to the machine id; a declared one reads as written.
    expect(within(rows[0] as HTMLElement).getAllByText('gpt-4o').length).toBeGreaterThan(0);
    expect(within(rows[1] as HTMLElement).getByText('Sonnet')).toBeInTheDocument();

    // The context window is the daemon's number; null is "not reported", never zero (§7).
    expect(screen.getByTestId('model-context-openai-main-gpt-4o')).toHaveTextContent('128000');
    expect(screen.getByTestId('model-context-anthropic-main-claude-3-5-sonnet')).toHaveTextContent(
      ar('bench.not_reported')
    );

    // The static card states costs/vision/tools for the models this build knows…
    const caps = screen.getByTestId('model-capabilities-openai-main-gpt-4o');
    expect(
      within(caps).getByText(
        `${ar('models.cost')} — ${ar('models.cost_input')}: $2.50, ${ar('models.cost_output')}: $10.00`
      )
    ).toBeInTheDocument();
    expect(within(caps).getByText(`${ar('models.vision')}: ${ar('models.yes')}`)).toBeInTheDocument();
    // …and stays silent for the ones it does not.
    expect(screen.queryByTestId('model-capabilities-ollama-local-llama-3.1:8b')).toBeNull();
  });

  it('validates the add form and then writes the new row through the daemon', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('models-add-open'));
    const panel = screen.getByRole('region', { name: ar('models.add_title') });

    // Provider first: the catalog hangs rows under a provider, so the screen asks for it by name.
    fireEvent.click(within(panel).getByRole('button', { name: ar('models.add_submit') }));
    expect(await within(panel).findByText(ar('models.provider_needed'))).toBeInTheDocument();

    fireEvent.change(within(panel).getByRole('textbox', { name: ar('models.provider') }), {
      target: { value: 'openai-main' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('models.add_submit') }));
    expect(await within(panel).findByText(ar('models.model_id_needed'))).toBeInTheDocument();

    fireEvent.change(within(panel).getByRole('textbox', { name: ar('models.model_id') }), {
      target: { value: 'gpt-4o-mini' },
    });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('models.display_name') }), {
      target: { value: 'Mini' },
    });
    fireEvent.change(within(panel).getByRole('spinbutton', { name: ar('models.context_window') }), {
      target: { value: '16000' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('models.add_submit') }));

    await waitFor(() =>
      expect(client.addCustomModel).toHaveBeenCalledWith('openai-main', 'gpt-4o-mini', 'Mini', 16000)
    );
    expect(await screen.findByText(t('models.add_done', { name: 'Mini' }, 'ar'))).toBeInTheDocument();
    const catalog = screen.getByRole('region', { name: ar('models.catalog') });
    expect(within(catalog).getAllByRole('listitem')).toHaveLength(3);
  });

  it('fetches the provider’s live models and fills the form from one', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('models-add-open'));
    const panel = screen.getByRole('region', { name: ar('models.add_title') });

    fireEvent.change(within(panel).getByTestId('models-provider-picker'), {
      target: { value: 'openai-main' },
    });
    fireEvent.click(within(panel).getByTestId('models-fetch-button'));

    await waitFor(() => expect(client.checkProviderModels).toHaveBeenCalledWith('openai-main'));
    fireEvent.click(await within(panel).findByTestId('models-fetch-choice-gpt-4o-mini'));

    expect(within(panel).getByRole('textbox', { name: ar('models.provider') })).toHaveValue(
      'openai-main'
    );
    expect(within(panel).getByRole('textbox', { name: ar('models.model_id') })).toHaveValue(
      'gpt-4o-mini'
    );
    expect(within(panel).getByRole('textbox', { name: ar('models.display_name') })).toHaveValue(
      'Mini 4o'
    );
  });

  it('removes a row through the daemon and forgets it from the ledger', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('model-remove-openai-main-gpt-4o'));
    await waitFor(() => expect(client.removeCustomModel).toHaveBeenCalledWith('openai-main', 'gpt-4o'));

    expect(await screen.findByText(t('models.remove_done', { name: 'gpt-4o' }, 'ar'))).toBeInTheDocument();
    const catalog = screen.getByRole('region', { name: ar('models.catalog') });
    expect(within(catalog).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows the reported routing and assigns a role with a single weighted target', async () => {
    const client = clientStub();
    renderScreen(client);

    const roles = await screen.findByRole('region', { name: ar('models.roles') });
    const rows = within(roles).getAllByRole('listitem');
    // Every role the loop can staff is ruled, routings or not — twelve honest rows.
    expect(rows).toHaveLength(12);

    // The current model line appears only where the daemon reported a routing (§7).
    expect(
      await within(roles).findByText(t('models.current_model', { model: 'openai-main/gpt-4o' }, 'ar'))
    ).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText(/openai-main\/gpt-4o/)).toBeNull();

    const select = within(roles).getByTestId('models-role-select-pm');
    fireEvent.change(select, { target: { value: 'anthropic-main/claude-3-5-sonnet' } });
    fireEvent.click(within(roles).getByTestId('models-role-assign-pm'));

    await waitFor(() => expect(client.setRoleConfig).toHaveBeenCalledTimes(1));
    expect(client.setRoleConfig).toHaveBeenCalledWith({
      role: 'pm',
      targets: [{ provider_id: 'anthropic-main', model_id: 'claude-3-5-sonnet', weight: 100 }],
      fallback_enabled: true,
      budget_cents_per_run: 0,
    });
    expect(
      await screen.findByText(t('models.assign_done', { role: ar('role.pm') }, 'ar'))
    ).toBeInTheDocument();
  });

  it('surfaces the daemon refusal on assignment', async () => {
    const client = clientStub({ setRoleConfig: vi.fn(async () => { throw new Error('refused'); }) });
    renderScreen(client);

    const roles = await screen.findByRole('region', { name: ar('models.roles') });
    fireEvent.change(within(roles).getByTestId('models-role-select-pm'), {
      target: { value: 'openai-main/gpt-4o' },
    });
    fireEvent.click(within(roles).getByTestId('models-role-assign-pm'));

    expect(await screen.findByRole('alert')).toHaveTextContent(ar('models.assign_failed'));
  });

  it('says when the daemon does not answer the catalogue, with an honest empty ledger', async () => {
    const client = clientStub({
      listCustomModels: vi.fn(async () => { throw new Error('offline'); }),
      listRoleRoutings: vi.fn(async () => { throw new Error('offline'); }),
    });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('models.failed'));

    // No invented rows: an unread catalogue reads empty, and the add action stays offered.
    const catalog = screen.getByRole('region', { name: ar('models.catalog') });
    expect(within(catalog).getByText(ar('models.empty'))).toBeInTheDocument();

    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listCustomModels).toHaveBeenCalledTimes(2));
  });

  it('reads its words in English too', async () => {
    renderScreen(clientStub(), 'en');

    const catalog = await screen.findByRole('region', { name: en('models.catalog') });
    expect(catalog).toBeInTheDocument();
    const roles = screen.getByRole('region', { name: en('models.roles') });
    expect(within(roles).getByText(en('role.architect'))).toBeInTheDocument();
    expect(screen.getByTestId('model-capabilities-openai-main-gpt-4o')).toHaveTextContent(
      `${en('models.vision')}: ${en('models.yes')}`
    );
  });
});
