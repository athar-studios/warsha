// Tests for the live connectors on the settings plate (Wave 2): the daemon-backed ledger, the
// credential forms that clear after sending, the disconnect and the connection test — plus the
// promised fallback to the local ledger when the daemon does not answer.
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type IntegrationStatus, type IntegrationTestResult, type WarshaClient } from '@warsha/client';
import { LocaleProvider, t } from '@warsha/i18n';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../theme';

import { SettingsScreen } from './SettingsScreen';

const ar = (key: string) => t(key, {}, 'ar');

const GITHUB: IntegrationStatus = { id: 'github', name: 'GitHub', connected: true, configuredAt: null, details: null };
const SLACK: IntegrationStatus = { id: 'slack', name: 'Slack', connected: false, configuredAt: null, details: null };

function liveClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  const client = {} as WarshaClient;
  client.listIntegrations = vi.fn(async () => [GITHUB, SLACK]);
  client.connectIntegration = vi.fn(async (id: string): Promise<IntegrationStatus> => ({
    id,
    name: id === 'slack' ? 'Slack' : 'GitHub',
    connected: true,
    configuredAt: '2026-11-05T00:00:00Z',
    details: null,
  }));
  client.disconnectIntegration = vi.fn(async (): Promise<IntegrationStatus> => ({ ...GITHUB, connected: false }));
  client.testIntegration = vi.fn(async (): Promise<IntegrationTestResult> => ({ status: 'ok', message: 'ping 210ms' }));
  return Object.assign(client, overrides);
}

function renderScreen(client: WarshaClient) {
  return render(
    <ThemeProvider initialPreference="light">
      <LocaleProvider initialLocale="ar" storage={null}>
        <SettingsScreen client={client} onBack={() => undefined} />
      </LocaleProvider>
    </ThemeProvider>
  );
}

describe('SettingsScreen live connectors', () => {
  it('replaces the local ledger with the daemon integration statuses', async () => {
    renderScreen(liveClient());

    const ledger = await screen.findByRole('list', { name: ar('connectors.title') });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText(ar('settings.subscription.connected'))).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(ar('settings.subscription.disconnected'))).toBeInTheDocument();
  });

  it('connects GitHub with a PAT, writes once and never shows the token again', async () => {
    const client = liveClient();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('connector-connect-slack'));
    // keep github for the second case; open slack's form first then switch expectation: slack uses webhook/bot
    const form = screen.getByTestId('connector-form-slack');
    fireEvent.change(within(form).getByLabelText(ar('connectors.slack_bot')), {
      target: { value: 'xoxb-live-token' },
    });
    fireEvent.click(within(form).getByRole('button', { name: ar('connectors.connect_submit') }));

    await waitFor(() => expect(client.connectIntegration).toHaveBeenCalledWith('slack', { botToken: 'xoxb-live-token' }));
    expect(await screen.findByText(t('connectors.connect_done', { name: 'Slack' }, 'ar'))).toBeInTheDocument();
    // the secret is gone from the DOM after the write, and the form itself closed (AGENTS.md)
    expect(screen.queryByDisplayValue('xoxb-live-token')).toBeNull();
    expect(screen.queryByTestId('connector-form-slack')).toBeNull();
  });

  it('connects a generic service with its API key', async () => {
    const client = liveClient({
      listIntegrations: vi.fn(async (): Promise<IntegrationStatus[]> => [
        { id: 'openai', name: 'OpenAI', connected: false, configuredAt: null, details: null },
      ]),
    });
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('connector-connect-openai'));
    const form = screen.getByTestId('connector-form-openai');
    const keyInput = within(form).getByLabelText(new RegExp(ar('providers.api_key')));
    expect(keyInput).toHaveAttribute('type', 'password');
    fireEvent.change(keyInput, { target: { value: 'sk-secret-value' } });
    fireEvent.click(within(form).getByRole('button', { name: ar('connectors.connect_submit') }));

    await waitFor(() => expect(client.connectIntegration).toHaveBeenCalledWith('openai', { token: 'sk-secret-value' }));
    expect(await screen.findByText(t('connectors.connect_done', { name: 'OpenAI' }, 'ar'))).toBeInTheDocument();
    expect(screen.queryByDisplayValue('sk-secret-value')).toBeNull();
  });

  it('tests a connected integration and says what came back', async () => {
    const client = liveClient();
    renderScreen(client);

    fireEvent.click(await screen.findByTestId('connector-test-github'));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(t('connectors.test_result', { status: 'ok', message: 'ping 210ms' }, 'ar'));
    expect(client.testIntegration).toHaveBeenCalledWith('github');
  });

  it('disconnects through the daemon and follows the answer', async () => {
    const client = liveClient();
    renderScreen(client);

    const ledger = await screen.findByRole('list', { name: ar('connectors.title') });
    const firstRow = within(ledger).getAllByRole('listitem')[0] as HTMLElement;
    fireEvent.click(within(firstRow).getByRole('button', { name: ar('common.disconnect') }));

    await waitFor(() => expect(client.disconnectIntegration).toHaveBeenCalledWith('github'));
    // Slack is disconnected too, so the word is scoped to the row that changed (§1).
    expect(await within(firstRow).findByText(ar('settings.subscription.disconnected'))).toBeInTheDocument();
  });

  it('falls back to the local subscriptions ledger when the daemon refuses the list', async () => {
    const client = liveClient({ listIntegrations: vi.fn(async () => { throw new Error('offline'); }) });
    renderScreen(client);

    // The fallback is the promise: the four local rows read, not a broken screen (§7).
    const ledger = await screen.findByRole('list', { name: ar('settings.subscriptions') });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('list', { name: ar('connectors.title') })).toBeNull();
  });
});
