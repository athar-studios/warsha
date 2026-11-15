// apps/desktop/e2e/v3/connections.spec.ts — Settings → Connections (R-EXT-1), @non-visual.
//
// Every case drives a real control through the stub daemon and asserts the method that reached it:
// the three MCP connection names already existed on the wire, so what these cases pin is that the
// screen uses exactly them (`mcp.list`, `mcp.connect` with `config`, `mcp.disconnect` with `name`,
// `mcp.permissions.set` with the reply's own role) and that a refusal is shown, not swallowed.
//
// No snapshots here: the visual baselines for this section belong to the visual lane, and this file
// is measured by the @non-visual gate.
import { expect, test } from '@playwright/test';

import {
  auditFocusWalk,
  axeIsClean,
  describeAxe,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../support/a11y';

import { act, expectRpc, openV3, rpcCalls } from './support';

/** One connected stdio server, in the exact shape `McpConnection` serialises. */
const CONNECTED_SERVER = {
  config: {
    name: 'files',
    transport: { kind: 'stdio' },
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@1.2.3'],
  },
  status: 'connected',
  process_id: 'proc-1',
  tools: ['read_file', 'write_file'],
  tool_definitions: [
    {
      name: 'read_file',
      description: 'Read one file',
      input_schema: { type: 'object' },
      annotations: { title: 'Read', read_only: true, destructive: false, idempotent: true },
    },
    {
      name: 'write_file',
      description: 'Write one file',
      input_schema: { type: 'object' },
      annotations: null,
    },
  ],
};

/** A server whose handshake failed: `McpStatus::Error` arrives as `{error: "…"}`. */
const ERROR_SERVER = {
  config: { name: 'flaky', transport: { kind: 'stdio' }, command: 'node', args: ['server.js'] },
  status: { error: 'handshake timed out' },
  process_id: null,
  tools: [],
  tool_definitions: [],
};

/** A recorded-but-not-dialled http server: it reports disconnected and no tools, by design. */
const RECORDED_HTTP_SERVER = {
  config: {
    name: 'remote',
    transport: { kind: 'http', url: 'https://mcp.example.test/x' },
    command: null,
    args: [],
  },
  status: 'disconnected',
  process_id: null,
  tools: [],
  tool_definitions: [],
};

/** The permission reply, for a role no screen may hard-code, with the fail-closed default. */
const PERMISSIONS = { rows: [], agent_role: 'reviewer', default_permission: 'ask' };

const CONNECTIONS_ROUTE = '/settings/connections';

test.describe('Settings connections (R-EXT-1)', () => {
  test('a connected server shows its tools and writes a permission for the daemon’s role', async ({
    page,
  }) => {
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'en',
      mode: 'advanced',
      fixtures: {
        'mcp.list': { result: () => [CONNECTED_SERVER] },
        'mcp.permissions.list': { result: () => PERMISSIONS },
        'mcp.permissions.set': {
          result: (params: unknown) => {
            const sent = params as Record<string, string>;
            return {
              server: sent['server'],
              tool: sent['tool'],
              role: sent['role'],
              permission: sent['permission'],
            };
          },
        },
      },
    });

    const row = page.locator('[data-testid="mcp-connection-row-files"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Connected');
    // The pid is the daemon's, not a setting: it never reaches the screen.
    await expect(row).not.toContainText('proc-1');

    await act(page, 'settings.connections.tools.toggle');
    const tools = page.locator('[data-testid="mcp-connection-tools-files"]');
    await expect(tools).toContainText('read_file');
    await expect(tools).toContainText('Read one file');
    await expect(tools).toContainText('Read-only');

    await page
      .locator('[data-action="settings.connections.tool.permission"][data-value="deny"]')
      .first()
      .click();
    // W8's shape: the role is the one `mcp.permissions.list` answered, never a literal in the screen.
    await expectRpc(page, 'mcp.permissions.set', {
      server: 'files',
      tool: 'read_file',
      role: 'reviewer',
      permission: 'deny',
    });
    await expect(
      page.locator('[data-testid="mcp-tool-permission-files-read_file"] [data-value="deny"]')
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('adds a stdio server: the row appears connected with the tools the server reported', async ({
    page,
  }) => {
    let configured: unknown[] = [];
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'en',
      mode: 'advanced',
      fixtures: {
        'mcp.list': { result: () => configured },
        'mcp.permissions.list': { result: () => PERMISSIONS },
        'mcp.connect': {
          result: () => {
            // What the daemon does: record the config, then answer the next `mcp.list` with it.
            configured = [CONNECTED_SERVER];
            return null;
          },
        },
      },
    });

    await expect(page.locator('[data-testid="mcp-connection-row-files"]')).toHaveCount(0);
    await page.locator('[data-testid="mcp-connection-name"] input').fill('files');
    await page.locator('[data-testid="mcp-connection-command"] input').fill('npx');
    await page
      .locator('[data-testid="mcp-connection-args"] input')
      .fill('-y @modelcontextprotocol/server-filesystem@1.2.3');

    await act(page, 'settings.connections.add');
    await expectRpc(page, 'mcp.connect', {
      config: {
        name: 'files',
        transport: { kind: 'stdio' },
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem@1.2.3'],
      },
    });

    const row = page.locator('[data-testid="mcp-connection-row-files"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Connected');
    await act(page, 'settings.connections.tools.toggle');
    await expect(page.locator('[data-testid="mcp-connection-tools-files"]')).toContainText(
      'read_file'
    );
  });

  test('refuses an unpinned launch in the daemon’s own words, and adds nothing', async ({
    page,
  }) => {
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'en',
      mode: 'advanced',
      fixtures: { 'mcp.list': { result: () => [] } },
    });

    await page.locator('[data-testid="mcp-connection-name"] input').fill('files');
    await page.locator('[data-testid="mcp-connection-command"] input').fill('npx');
    await page.locator('[data-testid="mcp-connection-args"] input').fill('@scope/server');

    await act(page, 'settings.connections.add');
    const banner = page.locator('.w-banner--danger');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      'the pack launches the unpinned package `@scope/server`; name the release it was tested with as `pkg@x.y.z`'
    );
    await expect(page.locator('[data-testid="mcp-connection-row-files"]')).toHaveCount(0);
  });

  test('shows a failed server’s message and a recorded http server as not connected', async ({
    page,
  }) => {
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'en',
      mode: 'advanced',
      fixtures: {
        'mcp.list': { result: () => [ERROR_SERVER, RECORDED_HTTP_SERVER] },
        'mcp.permissions.list': { result: () => PERMISSIONS },
      },
    });

    const failed = page.locator('[data-testid="mcp-connection-row-flaky"]');
    await expect(failed).toContainText('Error');
    await expect(failed).toContainText('handshake timed out');

    const recorded = page.locator('[data-testid="mcp-connection-row-remote"]');
    await expect(recorded).toContainText('Not connected');
    await expect(recorded).toContainText('https://mcp.example.test/x');
    // The row's own toggle: the first one on the page belongs to the failed server.
    await recorded.locator('[data-action="settings.connections.tools.toggle"]').click();
    await expect(page.locator('[data-testid="mcp-connection-tools-remote"]')).toContainText(
      'Recorded, not connected: nothing dials this address yet.'
    );
  });

  test('disconnects only after the confirmation step, then the row is gone', async ({ page }) => {
    let connected = true;
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'en',
      mode: 'advanced',
      fixtures: {
        'mcp.list': { result: () => (connected ? [CONNECTED_SERVER] : []) },
        'mcp.permissions.list': { result: () => PERMISSIONS },
        'mcp.disconnect': {
          result: () => {
            connected = false;
            return null;
          },
        },
      },
    });

    const row = page.locator('[data-testid="mcp-connection-row-files"]');
    await expect(row).toBeVisible();

    await act(page, 'settings.connections.disconnect.open');
    const dialog = page.locator('[data-testid="mcp-disconnect-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Disconnect files');
    // Nothing reached the daemon yet: the open step is state only.
    expect((await rpcCalls(page)).filter((call) => call.method === 'mcp.disconnect')).toEqual([]);

    await act(page, 'settings.connections.disconnect.confirm');
    await expectRpc(page, 'mcp.disconnect', { name: 'files' });
    await expect(row).toHaveCount(0);
  });

  test('refresh re-reads the server list and never claims a connection was tested', async ({
    page,
  }) => {
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'en',
      mode: 'advanced',
      fixtures: {
        'mcp.list': { result: () => [CONNECTED_SERVER] },
        'mcp.permissions.list': { result: () => PERMISSIONS },
      },
    });

    const listCalls = async (): Promise<number> =>
      (await rpcCalls(page)).filter((call) => call.method === 'mcp.list').length;
    const before = await listCalls();

    await act(page, 'settings.connections.refresh');
    await expect.poll(listCalls).toBeGreaterThan(before);
    await expect(page.locator('.w-banner--success')).toContainText('Status refreshed.');
    // The copy is a refresh, not a probe: no method could have tested the connection.
    await expect(page.locator('.w-banner--info').first()).toContainText(
      'Refresh re-reads the server list; it never tests.'
    );
  });

  test('Arabic renders RTL, keeps the wire tokens LTR, and stays axe and keyboard clean @a11y', async ({
    page,
  }) => {
    await openV3(page, CONNECTIONS_ROUTE, {
      lang: 'ar',
      mode: 'advanced',
      fixtures: {
        'mcp.list': { result: () => [CONNECTED_SERVER, ERROR_SERVER] },
        'mcp.permissions.list': { result: () => PERMISSIONS },
      },
    });

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const row = page.locator('[data-testid="mcp-connection-row-files"]');
    await expect(row).toContainText('متّصل');
    // A server name and its command are LTR tokens inside an RTL row.
    await expect(row.locator('bdi[dir="ltr"]').first()).toHaveText('files');
    await expect(row.locator('bdi[dir="ltr"]').nth(1)).toHaveText(
      'npx -y @modelcontextprotocol/server-filesystem@1.2.3'
    );

    await act(page, 'settings.connections.tools.toggle');
    const axe = await runAxe(page);
    expect(axeIsClean(axe), `axe found violations:\n${describeAxe(axe)}`).toBe(true);

    const focus = await auditFocusWalk(page);
    expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
  });
});
