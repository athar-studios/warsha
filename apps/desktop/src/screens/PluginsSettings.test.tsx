// Tests for the plugins ledger (Wave 2): the daemon rows, the toggle, the environment form that
// writes a secret once and forgets it, the manifest install, and the bundled seven on failure.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type PluginDefinition, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PluginsSettings } from './PluginsSettings';

const ar = (key: string) => t(key, {}, 'ar');
const en = (key: string) => t(key, {}, 'en');

const GITHUB_MCP: PluginDefinition = {
  id: 'github-mcp',
  name: 'GitHub',
  description: 'Repository operations for the ticket-to-PR factory.',
  transport: 'stdio',
  command: 'npx',
  args: ['@modelcontextprotocol/server-github'],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${secrets:github-token}' },
  enabled: true,
  tools: [
    { name: 'create_issue', description: 'Open an issue.', parametersJson: null },
    { name: 'search_code', description: 'Search code.', parametersJson: null },
  ],
  source: 'github.com/modelcontextprotocol/servers',
};

const STRIX: PluginDefinition = {
  id: 'security-strix-pack',
  name: 'Strix Security',
  description: '',
  transport: 'stdio',
  command: 'uvx',
  args: ['strix-mcp'],
  env: {},
  enabled: false,
  tools: [],
  source: 'github.com/usestrix/strix',
};

function clientStub(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listPlugins = vi.fn(async () => [GITHUB_MCP, STRIX]);
  client.togglePlugin = vi.fn(async (id: string, enabled: boolean): Promise<PluginDefinition> => ({
    ...(id === 'github-mcp' ? GITHUB_MCP : STRIX),
    id,
    enabled,
  }));
  client.configurePlugin = vi.fn(async (id: string, env: Record<string, string>): Promise<PluginDefinition> => ({
    ...GITHUB_MCP,
    id,
    env,
  }));
  client.installPlugin = vi.fn(async (): Promise<PluginDefinition> => ({
    id: 'jira-mcp',
    name: 'Jira',
    description: '',
    transport: 'http',
    command: null,
    args: [],
    env: {},
    enabled: true,
    tools: [],
    source: 'installed',
  }));
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient = clientStub(), locale: 'ar' | 'en' = 'ar') {
  return render(
    <LocaleProvider initialLocale={locale} storage={null}>
      <PluginsSettings client={client} />
    </LocaleProvider>
  );
}

describe('PluginsSettings', () => {
  it('rules the daemon packs with transport, command and tool count as machine data', async () => {
    renderScreen();

    const ledger = await screen.findByRole('list', { name: ar('plugins.bundled') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    expect(within(rows[0] as HTMLElement).getAllByText('GitHub').length).toBeGreaterThan(0);
    expect(within(rows[0] as HTMLElement).getByText(`${ar('plugins.transport')}: stdio`)).toBeInTheDocument();
    expect(screen.getByTestId('plugin-command-github-mcp')).toHaveTextContent(
      'npx @modelcontextprotocol/server-github'
    );
    expect(screen.getByTestId('plugin-tools-github-mcp')).toHaveTextContent(
      t('plugins.tool_count', { count: 2 }, 'ar')
    );
    expect(screen.getByTestId('plugin-tools-security-strix-pack')).toHaveTextContent(
      t('plugins.tool_count', { count: 0 }, 'ar')
    );

    // env values never render — only the variable names the daemon reports (§, AGENTS.md).
    expect(within(rows[0] as HTMLElement).getByText('GITHUB_PERSONAL_ACCESS_TOKEN')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).queryByText('${secrets:github-token}')).toBeNull();
  });

  it('toggles a pack through the daemon', async () => {
    const client = clientStub();
    renderScreen(client);

    const toggle = await screen.findByTestId('plugin-toggle-security-strix-pack');
    expect(toggle).toHaveAccessibleName(`${ar('plugins.toggle')} — Strix Security`);
    fireEvent.click(toggle);

    await waitFor(() => expect(client.togglePlugin).toHaveBeenCalledWith('security-strix-pack', true));
    const ledger = screen.getByRole('list', { name: ar('plugins.bundled') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(within(rows[1] as HTMLElement).getAllByText(ar('skills.enabled')).length).toBeGreaterThan(0);
  });

  it('writes environment values once and never shows them again', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('plugin-env-github-mcp'));
    const add = await screen.findByTestId('plugins-env-add');
    const form = add.closest('form');
    expect(form).not.toBeNull();

    fireEvent.change(within(form as HTMLFormElement).getByRole('textbox', { name: ar('plugins.env_key') }), {
      target: { value: 'SLACK_BOT_TOKEN' },
    });
    const valueInput = within(form as HTMLFormElement).getByLabelText(ar('plugins.env_value'));
    expect(valueInput).toHaveAttribute('type', 'password');
    fireEvent.change(valueInput, { target: { value: 'xoxb-super-secret' } });
    fireEvent.click(within(form as HTMLFormElement).getByRole('button', { name: ar('plugins.env_submit') }));

    await waitFor(() =>
      expect(client.configurePlugin).toHaveBeenCalledWith('github-mcp', { SLACK_BOT_TOKEN: 'xoxb-super-secret' })
    );

    // the draft is emptied and the secret is nowhere on the screen afterwards
    expect(within(form as HTMLFormElement).getByLabelText(ar('plugins.env_value'))).toHaveValue('');
    expect(within(form as HTMLFormElement).getByLabelText(ar('plugins.env_key'))).toHaveValue('');
    expect(screen.queryByText('xoxb-super-secret')).toBeNull();
    expect(await screen.findByText(ar('plugins.env_done'))).toBeInTheDocument();
    expect(screen.getByText(ar('plugins.env_note'))).toBeInTheDocument();
  });

  it('installs a pack from a manifest through the daemon', async () => {
    const client = clientStub();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('plugins-install-open'));
    const panel = screen.getByRole('region', { name: ar('plugins.install_title') });
    fireEvent.change(within(panel).getByRole('textbox', { name: ar('plugins.install_manifest_label') }), {
      target: { value: '{"id":"jira-mcp"}' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: ar('plugins.install_submit') }));

    await waitFor(() => expect(client.installPlugin).toHaveBeenCalledWith('{"id":"jira-mcp"}'));
    expect(await screen.findByText(t('plugins.install_done', { name: 'Jira' }, 'ar'))).toBeInTheDocument();
    const ledger = screen.getByRole('list', { name: ar('plugins.bundled') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(3);
  });

  it('says when the daemon does not answer and still shows the bundled seven', async () => {
    const client = clientStub({ listPlugins: vi.fn(async () => { throw new Error('offline'); }) });
    renderScreen(client);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(ar('plugins.failed'));

    const ledger = screen.getByRole('list', { name: ar('plugins.bundled') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(7);
    expect(within(ledger).getByText('Memory')).toBeInTheDocument();
    expect(within(ledger).getByText('Sequential Thinking')).toBeInTheDocument();
  });

  it('reads its words in English too', async () => {
    renderScreen(clientStub(), 'en');

    expect(await screen.findByText(en('plugins.title'))).toBeInTheDocument();
    const ledger = screen.getByRole('list', { name: en('plugins.bundled') });
    expect(ledger).toBeInTheDocument();
    // machine data reads the same in either language (§11).
    expect(screen.getByTestId('plugin-command-security-strix-pack')).toHaveTextContent('uvx strix-mcp');
    expect(screen.getByTestId('plugin-tools-security-strix-pack')).toHaveTextContent(
      t('plugins.tool_count', { count: 0 }, 'en')
    );
  });
});
