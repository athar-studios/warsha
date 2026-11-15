// apps/desktop/src/v3/pages/settings/sections/ConnectionsSection.test.tsx
// R-EXT-1: the Connections section renders every MCP status, drives add/disconnect/refresh and
// writes a tool's permission for the role the daemon's own reply names.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { McpConnection, McpPermissionsReply, WarshaClient } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { I18nProvider, type Locale } from '@warsha/i18n/v3';
/* eslint-enable import/no-unresolved */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../../app/ClientContext';
import { DataReadyProvider } from '../../../app/DataReadyContext';
import { DensityProvider } from '../../../app/DensityContext';
import { ThemeProvider } from '../../../app/ThemeContext';

import { ConnectionsSection } from './ConnectionsSection';

const CONNECTED: McpConnection = {
  config: {
    name: 'files',
    transport: { kind: 'stdio' },
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@1.2.3'],
  },
  status: { kind: 'connected' },
  processId: 'proc-1',
  tools: [
    { name: 'read_file', description: 'Read one file' },
    { name: 'write_file', description: 'Write one file' },
  ],
};

const CONNECTING: McpConnection = {
  config: { name: 'slow', transport: { kind: 'stdio' }, command: 'node', args: [] },
  status: { kind: 'connecting' },
  processId: null,
  tools: [],
};

const DISCONNECTED: McpConnection = {
  config: { name: 'idle', transport: { kind: 'stdio' }, command: 'node', args: [] },
  status: { kind: 'disconnected' },
  processId: null,
  tools: [],
};

const RECORDED_HTTP: McpConnection = {
  config: {
    name: 'remote',
    transport: { kind: 'http', url: 'https://mcp.example.test/x' },
    command: null,
    args: [],
  },
  status: { kind: 'disconnected' },
  processId: null,
  tools: [],
};

/** An `http` server the daemon dialled (R-EXT-4): connected, no process, and no tools at all. */
const CONNECTED_HTTP: McpConnection = {
  config: {
    name: 'dialled',
    transport: { kind: 'http', url: 'https://mcp.example.test/mcp' },
    command: null,
    args: [],
  },
  status: { kind: 'connected' },
  processId: null,
  tools: [],
};

/** A websocket config: the one transport nothing dials, with our client or without it. */
const RECORDED_WEBSOCKET: McpConnection = {
  config: {
    name: 'socket',
    transport: { kind: 'websocket', url: 'wss://mcp.example.test/ws' },
    command: null,
    args: [],
  },
  status: { kind: 'disconnected' },
  processId: null,
  tools: [],
};

const ERRORED: McpConnection = {
  config: { name: 'flaky', transport: { kind: 'stdio' }, command: 'node', args: [] },
  status: { kind: 'error', message: 'handshake timed out' },
  processId: null,
  tools: [],
};

/** The permission reply with a role no screen may hard-code, so the write's role is provable. */
const PERMISSIONS: McpPermissionsReply = {
  rows: [{ server: 'files', tool: 'write_file', role: 'reviewer', permission: 'deny' }],
  agentRole: 'reviewer',
  defaultPermission: 'ask',
};

function createClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  return {
    mcpList: vi.fn().mockResolvedValue([CONNECTED]),
    mcpPermissionsList: vi.fn().mockResolvedValue(PERMISSIONS),
    mcpConnect: vi.fn().mockResolvedValue(undefined),
    mcpDisconnect: vi.fn().mockResolvedValue(undefined),
    mcpPermissionsSet: vi.fn().mockResolvedValue({
      server: 'files',
      tool: 'read_file',
      role: 'reviewer',
      permission: 'deny',
    }),
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
              <ConnectionsSection />
            </DataReadyProvider>
          </ClientProvider>
        </DensityProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

async function renderWith(servers: McpConnection[], overrides: Partial<WarshaClient> = {}) {
  const client = createClient({
    mcpList: vi.fn().mockResolvedValue(servers),
    ...overrides,
  });
  renderSection(client);
  // The add form renders only once both reads have answered, so waiting for it is waiting for the
  // section to be ready; the section root exists while the rows are still skeletons.
  await waitFor(() => expect(screen.getByTestId('mcp-connection-add')).toBeDefined());
  return client;
}

function row(name: string): HTMLElement {
  return screen.getByTestId(`mcp-connection-row-${name}`);
}

describe('ConnectionsSection (R-EXT-1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all four statuses with their own words', async () => {
    await renderWith([CONNECTED, CONNECTING, DISCONNECTED, ERRORED]);
    expect(within(row('files')).getByText('Connected')).toBeDefined();
    expect(within(row('slow')).getByText('Connecting')).toBeDefined();
    expect(within(row('idle')).getByText('Not connected')).toBeDefined();
    expect(within(row('flaky')).getByText('Error')).toBeDefined();
  });

  it('shows the daemon’s own error message as text, not as chrome', async () => {
    await renderWith([ERRORED]);
    expect(within(row('flaky')).getByText('handshake timed out')).toBeDefined();
  });

  it('hides the process id and shows the command instead', async () => {
    await renderWith([CONNECTED]);
    expect(within(row('files')).queryByText('proc-1')).toBeNull();
    expect(
      within(row('files')).getByText('npx -y @modelcontextprotocol/server-filesystem@1.2.3')
    ).toBeDefined();
  });

  it('tells a disconnected server with no tools why, instead of showing an empty list', async () => {
    await renderWith([DISCONNECTED, RECORDED_HTTP]);
    fireEvent.click(screen.getAllByText('Tools (0)')[0] as HTMLElement);
    expect(screen.getByText('Not connected yet, so it has reported no tools.')).toBeDefined();

    fireEvent.click(screen.getAllByText('Tools (0)')[1] as HTMLElement);
    expect(
      screen.getByText('Recorded, not connected: nothing dials this address yet.')
    ).toBeDefined();
  });

  it('writes a tool permission for the role the daemon’s reply names', async () => {
    const client = await renderWith([CONNECTED]);
    fireEvent.click(screen.getByText('Tools (2)'));

    const group = screen.getByTestId('mcp-tool-permission-files-read_file');
    fireEvent.click(within(group).getByRole('radio', { name: 'Denied' }));

    await waitFor(() =>
      expect(client.mcpPermissionsSet).toHaveBeenCalledWith(
        'files',
        'read_file',
        'reviewer',
        'deny'
      )
    );
    // The stored row the reply carries is what the selector now shows.
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'Denied' })).toHaveProperty(
        'ariaChecked',
        'true'
      )
    );
  });

  it('shows the stored permission of a tool and the fail-closed default of an unseen one', async () => {
    await renderWith([CONNECTED]);
    fireEvent.click(screen.getByText('Tools (2)'));

    const stored = screen.getByTestId('mcp-tool-permission-files-write_file');
    expect(within(stored).getByRole('radio', { name: 'Denied' })).toHaveProperty(
      'ariaChecked',
      'true'
    );
    const unseen = screen.getByTestId('mcp-tool-permission-files-read_file');
    expect(within(unseen).getByRole('radio', { name: 'Asks first' })).toHaveProperty(
      'ariaChecked',
      'true'
    );
  });

  it('disconnects only after the confirmation step', async () => {
    const client = await renderWith([CONNECTED]);
    fireEvent.click(within(row('files')).getByText('Disconnect'));

    const dialog = screen.getByTestId('mcp-disconnect-dialog');
    expect(within(dialog).getByText('Disconnect files')).toBeDefined();
    expect(client.mcpDisconnect).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText('Yes, disconnect'));
    await waitFor(() => expect(client.mcpDisconnect).toHaveBeenCalledWith('files'));
  });

  it('cancels a disconnect without dialling the daemon', async () => {
    const client = await renderWith([CONNECTED]);
    fireEvent.click(within(row('files')).getByText('Disconnect'));
    fireEvent.click(within(screen.getByTestId('mcp-disconnect-dialog')).getByText('Cancel'));
    expect(client.mcpDisconnect).not.toHaveBeenCalled();
  });

  it('refreshes through mcp.list, because the daemon has no probe method', async () => {
    const client = await renderWith([CONNECTED]);
    const list = client.mcpList as unknown as ReturnType<typeof vi.fn>;
    const before = list.mock.calls.length;
    fireEvent.click(screen.getByText('Refresh status'));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByText('Status refreshed.')).toBeDefined();
  });

  it('adds a stdio server: the config is the daemon’s own shape and args split on spaces', async () => {
    const client = await renderWith([]);
    fireEvent.change(
      screen.getByTestId('mcp-connection-name').querySelector('input') as HTMLElement,
      {
        target: { value: ' files ' },
      }
    );
    fireEvent.change(
      screen.getByTestId('mcp-connection-command').querySelector('input') as HTMLElement,
      { target: { value: 'npx' } }
    );
    fireEvent.change(
      screen.getByTestId('mcp-connection-args').querySelector('input') as HTMLElement,
      {
        target: { value: '-y  @scope/server@1.2.3   /tmp' },
      }
    );
    fireEvent.click(screen.getByText('Add and connect'));

    await waitFor(() =>
      expect(client.mcpConnect).toHaveBeenCalledWith({
        name: 'files',
        transport: { kind: 'stdio' },
        command: 'npx',
        args: ['-y', '@scope/server@1.2.3', '/tmp'],
      })
    );
  });

  it('refuses to add without a name or a command, and says which is missing', async () => {
    const client = await renderWith([]);
    fireEvent.change(
      screen.getByTestId('mcp-connection-command').querySelector('input') as HTMLElement,
      { target: { value: 'npx' } }
    );
    fireEvent.click(screen.getByText('Add and connect'));
    await waitFor(() => expect(screen.getByText('Enter a server name.')).toBeDefined());
    expect(client.mcpConnect).not.toHaveBeenCalled();
  });

  it('renders the daemon’s refusal verbatim in a banner', async () => {
    const refusal =
      'the pack launches the unpinned package `@scope/server`; name the release it was tested with as `pkg@x.y.z`';
    await renderWith([], { mcpConnect: vi.fn().mockRejectedValue(new Error(refusal)) });

    fireEvent.change(
      screen.getByTestId('mcp-connection-name').querySelector('input') as HTMLElement,
      {
        target: { value: 'files' },
      }
    );
    fireEvent.change(
      screen.getByTestId('mcp-connection-command').querySelector('input') as HTMLElement,
      { target: { value: 'npx' } }
    );
    fireEvent.change(
      screen.getByTestId('mcp-connection-args').querySelector('input') as HTMLElement,
      {
        target: { value: '@scope/server' },
      }
    );
    fireEvent.click(screen.getByText('Add and connect'));

    await waitFor(() => expect(screen.getByText(refusal)).toBeDefined());
  });

  it('does not call a dialled HTTP server “recorded, not connected” just because it has no tools', async () => {
    await renderWith([CONNECTED_HTTP, RECORDED_WEBSOCKET]);

    fireEvent.click(within(row('dialled')).getByText('Tools (0)'));
    expect(within(row('dialled')).getByText('This server reported no tools.')).toBeDefined();
    expect(
      within(row('dialled')).queryByText('Recorded, not connected: nothing dials this address yet.')
    ).toBeNull();

    // A websocket row has still never been dialled, so it keeps saying so.
    fireEvent.click(within(row('socket')).getByText('Tools (0)'));
    expect(
      within(row('socket')).getByText('Recorded, not connected: nothing dials this address yet.')
    ).toBeDefined();
  });

  it('shows an HTTP server’s own failure reason instead of the recorded note', async () => {
    await renderWith([
      {
        ...CONNECTED_HTTP,
        status: { kind: 'error', message: 'server requires authorization, which this version does not support' },
        tools: [],
      },
    ]);
    expect(
      within(row('dialled')).getByText(
        'server requires authorization, which this version does not support'
      )
    ).toBeDefined();
    fireEvent.click(within(row('dialled')).getByText('Tools (0)'));
    expect(
      within(row('dialled')).queryByText('Recorded, not connected: nothing dials this address yet.')
    ).toBeNull();
  });

  it('adds an HTTP server: the config carries the url and no command', async () => {
    const client = await renderWith([]);
    fireEvent.change(
      screen.getByTestId('mcp-connection-name').querySelector('input') as HTMLElement,
      { target: { value: 'remote' } }
    );
    fireEvent.click(
      within(screen.getByTestId('mcp-connection-transport')).getByRole('radio', { name: 'HTTP' })
    );
    fireEvent.change(
      screen.getByTestId('mcp-connection-url').querySelector('input') as HTMLElement,
      { target: { value: ' https://mcp.example.test/mcp ' } }
    );
    fireEvent.click(screen.getByText('Add and connect'));

    await waitFor(() =>
      expect(client.mcpConnect).toHaveBeenCalledWith({
        name: 'remote',
        transport: { kind: 'http', url: 'https://mcp.example.test/mcp' },
        command: null,
        args: [],
      })
    );
  });

  it('refuses an HTTP url the daemon would not dial, without calling it', async () => {
    const client = await renderWith([]);
    fireEvent.change(
      screen.getByTestId('mcp-connection-name').querySelector('input') as HTMLElement,
      { target: { value: 'remote' } }
    );
    fireEvent.click(
      within(screen.getByTestId('mcp-connection-transport')).getByRole('radio', { name: 'HTTP' })
    );
    // A plain-http host that is not this machine: the daemon refuses it, and the form says so
    // before spending a round trip.
    fireEvent.change(
      screen.getByTestId('mcp-connection-url').querySelector('input') as HTMLElement,
      { target: { value: 'http://mcp.example.test/mcp' } }
    );
    fireEvent.click(screen.getByText('Add and connect'));

    // The field itself says what it accepts, and nothing reached the daemon.
    const input = screen
      .getByTestId('mcp-connection-url')
      .querySelector('input') as HTMLElement;
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(client.mcpConnect).not.toHaveBeenCalled();
  });

  it('shows the catalog’s Arabic copy in an RTL document', async () => {
    const client = createClient();
    renderSection(client, 'ar');
    await waitFor(() => expect(screen.getByTestId('mcp-connection-add')).toBeDefined());
    expect(screen.getByText('تحديث الحالة')).toBeDefined();
    expect(screen.getByText('إضافة وربط')).toBeDefined();
  });
});
