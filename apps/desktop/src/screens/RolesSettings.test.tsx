// Tests for the roles ledger (B3-secondary redraw): the routing rows, the inline editor and the write it
// performs through `roles.set-config`.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  type ProviderConfig,
  type Role,
  type RoleRoutingConfig,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RolesSettings } from './RolesSettings';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

function routing(role: Role, provider: string, model: string): RoleRoutingConfig {
  return {
    role,
    targets: [{ provider_id: provider, model_id: model, weight: 100 }],
    fallback_enabled: true,
    budget_cents_per_run: 500,
  };
}

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  const providers: ProviderConfig[] = [{ name: 'openai-main', kind: 'openai', enabled: true }];
  client.listProviders = vi.fn(async () => providers);
  client.listRoles = vi.fn(async () => ['intake', 'researcher', 'pm'] as Role[]);
  client.getRoleConfig = vi.fn(async (role: Role) => {
    // `pm` is the unconfigured role: the daemon answers for the other two and refuses this one.
    if (role === 'pm') throw new Error('no config for this role');
    return routing(role, 'openai-main', 'gpt-4o-mini');
  });
  client.setRoleConfig = vi.fn(async () => undefined);
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <RolesSettings client={client} onBack={() => undefined} />
    </LocaleProvider>
  );
}

describe('RolesSettings', () => {
  it('rules every role the daemon knows, with its routing in mono', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('roles.title') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    // The role's word is the catalog's plain one; the target is machine data (§11).
    expect(within(rows[0] as HTMLElement).getByText(ar('role.intake'))).toBeInTheDocument();
    const target = within(rows[0] as HTMLElement).getByText('openai-main/gpt-4o-mini · 100');
    expect(target).toHaveAttribute('dir', 'ltr');
    expect(target).toHaveAttribute('translate', 'no');

    // A role with no config says so in words and offers its one button (§7).
    expect(within(rows[2] as HTMLElement).getByText(ar('roles.not_configured'))).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByRole('button', { name: ar('roles.configure') })).toBeInTheDocument();
  });

  it('opens the editor for a role and writes the routing through the daemon', async () => {
    const client = clientStub();
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('roles.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: ar('roles.configure') }));

    const editor = screen.getByRole('region', { name: ar('roles.editing') });
    expect(within(editor).getByRole('combobox', { name: new RegExp(ar('roles.provider')) })).toBeInTheDocument();
    // The editor offers the providers the daemon reported, never an invented shortlist (§7).
    expect(within(editor).getByRole('option', { name: 'openai-main' })).toBeInTheDocument();

    fireEvent.change(within(editor).getByRole('textbox', { name: new RegExp(ar('roles.model')) }), {
      target: { value: 'claude-3-5-sonnet' },
    });
    fireEvent.change(within(editor).getByRole('spinbutton', { name: new RegExp(ar('roles.weight')) }), {
      target: { value: '40' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: ar('roles.save') }));

    await waitFor(() => expect(client.setRoleConfig).toHaveBeenCalledTimes(1));
    expect(client.setRoleConfig).toHaveBeenCalledWith({
      role: 'pm',
      targets: [{ provider_id: 'openai-main', model_id: 'claude-3-5-sonnet', weight: 40 }],
      fallback_enabled: true,
      budget_cents_per_run: 500,
    });

    expect(await screen.findByText(`${ar('role.pm')} — ${ar('roles.saved')}`)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: ar('roles.editing') })).toBeNull();
  });

  it('adds a second target and drops one again', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('roles.title') });
    // Editing a configured role starts from what the daemon reported, not from an empty form.
    fireEvent.click(within(ledger).getAllByRole('button', { name: ar('roles.edit') })[0] as HTMLElement);

    const editor = screen.getByRole('region', { name: ar('roles.editing') });
    fireEvent.click(within(editor).getByRole('button', { name: ar('roles.add_target') }));
    expect(within(editor).getAllByRole('textbox', { name: new RegExp(ar('roles.model')) })).toHaveLength(2);

    fireEvent.click(within(editor).getAllByRole('button', { name: ar('roles.remove_target') })[0] as HTMLElement);
    expect(within(editor).getAllByRole('textbox', { name: new RegExp(ar('roles.model')) })).toHaveLength(1);

    // The last target cannot be removed: a role with no route is a role that answers nothing.
    expect(within(editor).getByRole('button', { name: ar('roles.remove_target') })).toBeDisabled();
  });

  it('keeps the editor and its words when the daemon refuses the save', async () => {
    const client = clientStub({ setRoleConfig: vi.fn(async () => { throw new Error('refused'); }) });
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('roles.title') });
    fireEvent.click(within(ledger).getByRole('button', { name: ar('roles.configure') }));
    const editor = screen.getByRole('region', { name: ar('roles.editing') });
    fireEvent.click(within(editor).getByRole('button', { name: ar('roles.save') }));

    expect(await screen.findByText(ar('roles.failed'))).toBeInTheDocument();
    expect(screen.getByRole('region', { name: ar('roles.editing') })).toBeInTheDocument();
  });

  it('says when the routing table does not answer, and retries', async () => {
    const client = clientStub({ listRoles: vi.fn(async () => { throw new Error('offline'); }) });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('roles.failed'));

    fireEvent.click(within(banner).getByRole('button', { name: ar('common.retry') }));
    await waitFor(() => expect(client.listRoles).toHaveBeenCalledTimes(2));
  });

  it('reads its rows in English too', async () => {
    renderScreen(clientStub(), 'en');

    const ledger = await screen.findByRole('list', { name: en('roles.title') });
    expect(within(ledger).getByText(en('role.researcher'))).toBeInTheDocument();
    expect(within(ledger).getByText(en('roles.not_configured'))).toBeInTheDocument();
  });
});
