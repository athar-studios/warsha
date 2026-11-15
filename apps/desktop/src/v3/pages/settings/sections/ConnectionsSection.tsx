// apps/desktop/src/v3/pages/settings/sections/ConnectionsSection.tsx — Settings → Connections
// (R-EXT-1). The MCP servers this daemon can reach: status, transport, tools, and the per-tool
// permission, plus add (stdio only), disconnect and a status refresh.
//
// A row-list in the `McpPermissionsSection.tsx`/`DevicesSection.tsx` pattern, not a `<table>`: the
// design system has no table primitive, and a row keeps its action beside the row it acts on. The
// section is separate from `mcp` on purpose (OD-EXT1-b): the permission table is B3b's and stays
// untouched.
//
// Three honesty rules hold the screen:
//   * "Refresh status" re-reads `mcp.list`. The daemon has no probe method, so nothing here claims a
//     connection was tested — `settings.connections.refresh_note` says so in both catalogs;
//   * a `websocket` server — and an `http` one the daemon recorded without dialling — has never been
//     connected, so it is reported `disconnected` with no tools and the row says why instead of
//     showing an empty list. Since R-EXT-4 an `http` server *is* dialled, so a disconnected `http`
//     row means what it says: nothing reached it yet;
//   * the daemon's own refusal text (an unpinned package, the process policy, a duplicate name, a
//     401 from a remote server) reaches the owner verbatim in a `Banner` — never reworded, never
//     swallowed.
import type {
  McpConnection,
  McpPermission,
  McpPermissionsReply,
  McpServerConfig,
  McpStatus,
  McpToolInfo,
} from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Badge,
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconTerminal,
  SettingsSection,
  Skeleton,
  StatusPill,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useCallback, useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';

/**
 * The pill state and the catalog key for one connection status.
 *
 * `disconnected` reads as `idle`, not `failed` or `waiting`: an `http`/`websocket` server is
 * recorded without a connection and a stdio server that was never started is not an error — painting
 * either one as a failure would be the screen lying about the daemon's own status word.
 */
const STATUS_VIEW: Record<
  McpStatus['kind'],
  { status: 'done' | 'running' | 'idle' | 'failed'; labelKey: string }
> = {
  connected: { status: 'done', labelKey: 'settings.connections.status.connected' },
  connecting: { status: 'running', labelKey: 'settings.connections.status.connecting' },
  disconnected: { status: 'idle', labelKey: 'settings.connections.status.disconnected' },
  error: { status: 'failed', labelKey: 'settings.connections.status.error' },
};

/** The three values `mcp.permissions.set` accepts, in the order the selector offers them. */
const PERMISSIONS: readonly McpPermission[] = ['allow', 'ask', 'deny'];

/**
 * The transports the add form offers. `websocket` is deliberately absent: the MCP revision defines
 * stdio and Streamable HTTP, and the daemon records a websocket config without ever dialling it, so
 * offering one here would be offering a server that can never connect.
 */
const TRANSPORTS: readonly { kind: 'stdio' | 'http'; labelKey: string }[] = [
  { kind: 'stdio', labelKey: 'settings.connections.transport.stdio' },
  { kind: 'http', labelKey: 'settings.connections.transport.http' },
];

/**
 * Whether a url is one the daemon will dial: `https` anywhere, a plain `http` only on loopback.
 *
 * A hint, never a decision — the daemon re-checks the url against its own policy and its refusal is
 * what the banner shows. Saying it here only saves the owner a round trip on a typo.
 */
function urlIsDiallable(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname;
  return host === 'localhost' || host === '[::1]' || /^127\./u.test(host);
}

/** The catalog key for one permission value (`settings.mcp.permission.*`, B3b's own words). */
function permissionLabelKey(permission: McpPermission): string {
  return `settings.mcp.permission.${permission}`;
}

/**
 * The permission stored for one `server::tool` at the daemon's own agent role, else its fail-closed
 * default. The role comes from the reply, never from this file: it is the daemon's setting.
 */
function permissionFor(
  reply: McpPermissionsReply | null,
  server: string,
  tool: string
): McpPermission | null {
  if (!reply) return null;
  const row = reply.rows.find(
    (candidate) =>
      candidate.server === server && candidate.tool === tool && candidate.role === reply.agentRole
  );
  return row ? row.permission : reply.defaultPermission;
}

/** The address or command a row shows under its name: the url for a recorded transport. */
function configDetail(config: McpServerConfig): string {
  if (config.transport.kind !== 'stdio') return config.transport.url;
  return [config.command ?? '', ...config.args].join(' ').trim();
}

export function ConnectionsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [servers, setServers] = useState<McpConnection[]>([]);
  const [permissions, setPermissions] = useState<McpPermissionsReply | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [disconnectTarget, setDisconnectTarget] = useState<McpConnection | null>(null);

  const [newName, setNewName] = useState('');
  const [newTransport, setNewTransport] = useState<'stdio' | 'http'>('stdio');
  const [newCommand, setNewCommand] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) {
      setServers([]);
      setPermissions(null);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      // Two reads, one round: the list says what is connected, the permission reply says which role
      // its rows are stored for and what an unseen tool gets.
      const [nextServers, nextPermissions] = await Promise.all([
        client.mcpList(),
        client.mcpPermissionsList(),
      ]);
      setServers(nextServers);
      setPermissions(nextPermissions);
      setErrorMessage(null);
      setStatus('ready');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  /** `mcp.list` again. The label says refresh because the daemon offers no probe to call. */
  const refreshAction = useAction('settings.connections.refresh', async () => {
    await load();
    setStatusMessage(t('settings.connections.refreshed'));
  });

  /**
   * Add a server: a stdio one runs the command it names with the arguments split on whitespace
   * exactly as typed; an HTTP one is the url the daemon dials over Streamable HTTP. Either way the
   * config is the daemon's own shape, and a refusal (an unpinned package, a policy on the program or
   * the url, a duplicate name, a 401 from the server) is the daemon's own message and lands in the
   * banner below, verbatim.
   */
  const addAction = useAction('settings.connections.add', async () => {
    if (!client) return;
    const name = newName.trim();
    setNameError(name.length === 0 ? t('settings.connections.add.name_required') : null);
    if (newTransport === 'stdio') {
      const command = newCommand.trim();
      setCommandError(command.length === 0 ? t('settings.connections.add.command_required') : null);
      if (name.length === 0 || command.length === 0) return;
      const config: McpServerConfig = {
        name,
        transport: { kind: 'stdio' },
        command,
        args: newArgs
          .split(/\s+/)
          .map((arg) => arg.trim())
          .filter((arg) => arg.length > 0),
      };
      await client.mcpConnect(config);
      setNewArgs('');
    } else {
      const url = newUrl.trim();
      const diallable = urlIsDiallable(url);
      setUrlError(diallable ? null : t('settings.connections.add.url'));
      if (name.length === 0 || !diallable) return;
      // No command and no arguments: the url is the whole of an HTTP server's configuration.
      const config: McpServerConfig = {
        name,
        transport: { kind: 'http', url },
        command: null,
        args: [],
      };
      await client.mcpConnect(config);
      setNewUrl('');
    }
    setNewName('');
    setNewCommand('');
    setStatusMessage(t('settings.connections.added'));
    await load();
  });

  const disconnectAction = useAction('settings.connections.disconnect.confirm', async () => {
    if (!client || !disconnectTarget) return;
    await client.mcpDisconnect(disconnectTarget.config.name);
    setDisconnectTarget(null);
    setStatusMessage(t('settings.connections.disconnected'));
    await load();
  });

  /**
   * One tool's permission, written for the daemon's own agent role. The stored row the daemon answers
   * with replaces the local one, so the selector shows what the daemon kept rather than what was
   * clicked.
   */
  const permissionAction = useAction(
    'settings.connections.tool.permission',
    async (server: string, tool: string, permission: McpPermission) => {
      if (!client || !permissions) return;
      const stored = await client.mcpPermissionsSet(
        server,
        tool,
        permissions.agentRole,
        permission
      );
      setPermissions((previous) =>
        previous
          ? {
              ...previous,
              rows: [
                ...previous.rows.filter(
                  (row) =>
                    !(
                      row.server === stored.server &&
                      row.tool === stored.tool &&
                      row.role === stored.role
                    )
                ),
                stored,
              ],
            }
          : previous
      );
      setStatusMessage(t('settings.connections.permission_saved'));
    }
  );

  const toggleTools = (name: string): void => {
    setExpanded((previous) => ({ ...previous, [name]: !previous[name] }));
  };

  const refusal = addAction.error?.message ?? null;

  const renderTools = (server: McpConnection): React.ReactElement => {
    // A `websocket` row has never been dialled. An `http` row has been — since R-EXT-4 the daemon
    // dials it — so "recorded, not connected" only fits the one case where nothing reached it: still
    // disconnected with no tools. A connected or failed HTTP server gets the ordinary copy, because
    // claiming nothing dials an address the daemon just dialled would be the screen lying.
    const recorded =
      server.config.transport.kind === 'websocket' ||
      (server.config.transport.kind === 'http' &&
        server.status.kind === 'disconnected' &&
        server.tools.length === 0);
    const tools: McpToolInfo[] = server.tools;
    if (tools.length === 0) {
      // A recorded transport says *why* it has no tools, so an empty list is never read as
      // "this server offers nothing".
      const note = recorded
        ? t('settings.connections.not_wired')
        : server.status.kind === 'connected'
          ? t('settings.connections.tools.empty')
          : t('settings.connections.not_connected');
      return (
        <Banner variant="info">
          <span dir="auto">{note}</span>
        </Banner>
      );
    }
    return (
      <>
        {tools.map((tool) => {
          const current = permissionFor(permissions, server.config.name, tool.name);
          return (
            <div key={tool.name} className="v3-settings-row">
              <span className="v3-settings-row-icon" aria-hidden="true">
                <IconTerminal size={16} />
              </span>
              <div className="v3-settings-row-main">
                <div className="v3-settings-row-title">
                  <bdi dir="ltr">{tool.name}</bdi>
                </div>
                {tool.description.length > 0 && (
                  <div className="v3-settings-row-subtitle" dir="auto">
                    {tool.description}
                  </div>
                )}
                {(tool.readOnly !== undefined || tool.destructive !== undefined) && (
                  <div className="v3-settings-row-meta">
                    {tool.readOnly === true && (
                      <Badge>{t('settings.connections.tool.read_only')}</Badge>
                    )}
                    {tool.destructive === true && (
                      <Badge variant="attention">
                        {t('settings.connections.tool.destructive')}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <div className="v3-settings-row-actions">
                {/* The segmented radiogroup the language and theme rows already use: a native
                    `select` would carry no `data-action` the gate can see, and three words are
                    quicker to read than a dropdown. The value written is the daemon's own. */}
                <div
                  role="radiogroup"
                  aria-label={t('settings.connections.tool.permission', { tool: tool.name })}
                  className="v3-settings-segmented-group"
                  data-testid={`mcp-tool-permission-${server.config.name}-${tool.name}`}
                >
                  {PERMISSIONS.map((permission) => (
                    <button
                      key={permission}
                      type="button"
                      role="radio"
                      aria-checked={current === permission}
                      disabled={current === null || permissionAction.pending}
                      data-action="settings.connections.tool.permission"
                      data-value={permission}
                      className="v3-settings-segmented-item"
                      onClick={() => {
                        void permissionAction.run(server.config.name, tool.name, permission);
                      }}
                    >
                      {t(permissionLabelKey(permission))}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div data-testid="settings-section-connections">
      <SettingsSection
        title={t('settings.section.connections')}
        description={t('settings.section.connections.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={refreshAction.pending}
            data-action="settings.connections.refresh"
            onClick={() => {
              void refreshAction.run();
            }}
          >
            {t('settings.connections.refresh')}
          </Button>
        }
      >
        {status === 'loading' && (
          <div className="v3-settings-stack">
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </div>
        )}

        {status === 'error' && (
          <div className="v3-settings-stack">
            <Banner variant="danger">
              <div className="v3-settings-row-meta">
                <span dir="auto">{errorMessage ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={() => {
                    void load();
                  }}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="v3-settings-stack">
              <Banner variant="info">{t('settings.connections.refresh_note')}</Banner>
              {statusMessage && <Banner variant="success">{statusMessage}</Banner>}
              {refusal && (
                <Banner variant="danger">
                  {/* The daemon's own words: an unpinned launch, the process policy, a duplicate. */}
                  <span dir="auto">{refusal}</span>
                </Banner>
              )}
            </div>

            {servers.length === 0 ? (
              <EmptyState
                icon={<IconTerminal size={20} />}
                title={t('settings.connections.empty.title')}
                description={t('settings.connections.empty.desc')}
              />
            ) : (
              <div>
                {permissions && (
                  <div className="v3-settings-stack">
                    <Banner variant="info">
                      {t('settings.connections.role_note', { role: permissions.agentRole })}
                    </Banner>
                  </div>
                )}
                {servers.map((server) => {
                  const name = server.config.name;
                  const view = STATUS_VIEW[server.status.kind];
                  const isOpen = expanded[name] === true;
                  return (
                    <div
                      key={name}
                      className="v3-settings-row"
                      data-testid={`mcp-connection-row-${name}`}
                    >
                      <span className="v3-settings-row-icon" aria-hidden="true">
                        <IconTerminal size={18} />
                      </span>
                      <div className="v3-settings-row-main">
                        <div className="v3-settings-row-title">
                          <bdi dir="ltr">{name}</bdi>
                        </div>
                        <div className="v3-settings-row-subtitle">
                          <bdi dir="ltr">{configDetail(server.config)}</bdi>
                        </div>
                        {server.status.kind === 'error' && (
                          <div className="v3-settings-row-subtitle" dir="auto">
                            {server.status.message}
                          </div>
                        )}
                      </div>
                      <div className="v3-settings-row-meta">
                        <Badge>
                          {t(`settings.connections.transport.${server.config.transport.kind}`)}
                        </Badge>
                        <StatusPill status={view.status} label={t(view.labelKey)} />
                      </div>
                      <div className="v3-settings-row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={isOpen}
                          data-action="settings.connections.tools.toggle"
                          onClick={() => toggleTools(name)}
                        >
                          {t('settings.connections.tools.toggle', { count: server.tools.length })}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-action="settings.connections.disconnect.open"
                          onClick={() => setDisconnectTarget(server)}
                        >
                          {t('settings.connections.disconnect')}
                        </Button>
                      </div>
                      {isOpen && (
                        <div
                          className="v3-settings-row-detail"
                          data-testid={`mcp-connection-tools-${name}`}
                        >
                          {renderTools(server)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="v3-settings-add-form" data-testid="mcp-connection-add">
              <div className="v3-settings-row-title">{t('settings.connections.add.title')}</div>
              <div className="v3-settings-row-subtitle">
                {t('settings.connections.add.stdio_only')}
              </div>
              <div className="v3-settings-add-fields">
                <TextField
                  label={t('settings.connections.add.name')}
                  data-testid="mcp-connection-name"
                  value={newName}
                  error={nameError ?? undefined}
                  onChange={(event) => {
                    setNewName(event.target.value);
                    setNameError(null);
                  }}
                />
                {/* The same segmented radiogroup the permission rows use: two words the owner
                    picks between, and a native `select` would carry nothing a test can address. */}
                <div
                  role="radiogroup"
                  aria-label={t('settings.connections.add.title')}
                  className="v3-settings-segmented-group"
                  data-testid="mcp-connection-transport"
                >
                  {TRANSPORTS.map((transport) => (
                    <button
                      key={transport.kind}
                      type="button"
                      role="radio"
                      aria-checked={newTransport === transport.kind}
                      data-value={transport.kind}
                      className="v3-settings-segmented-item"
                      onClick={() => {
                        setNewTransport(transport.kind);
                        setCommandError(null);
                        setUrlError(null);
                      }}
                    >
                      {t(transport.labelKey)}
                    </button>
                  ))}
                </div>
                {newTransport === 'stdio' ? (
                  <>
                    <TextField
                      label={t('settings.connections.add.command')}
                      data-testid="mcp-connection-command"
                      value={newCommand}
                      error={commandError ?? undefined}
                      onChange={(event) => {
                        setNewCommand(event.target.value);
                        setCommandError(null);
                      }}
                    />
                    <TextField
                      label={t('settings.connections.add.args')}
                      hint={t('settings.connections.add.args_hint')}
                      data-testid="mcp-connection-args"
                      value={newArgs}
                      onChange={(event) => setNewArgs(event.target.value)}
                    />
                  </>
                ) : (
                  <TextField
                    // The label carries the rule the daemon enforces, so the field says what it
                    // accepts before the owner types rather than after a refused round trip.
                    label={t('settings.connections.add.url')}
                    data-testid="mcp-connection-url"
                    // A url is LTR whatever the document direction is.
                    dir="ltr"
                    value={newUrl}
                    error={urlError ?? undefined}
                    onChange={(event) => {
                      setNewUrl(event.target.value);
                      setUrlError(null);
                    }}
                  />
                )}
              </div>
              <div className="v3-settings-row-actions">
                <Button
                  size="sm"
                  variant="primary"
                  loading={addAction.pending}
                  data-action="settings.connections.add"
                  onClick={() => {
                    void addAction.run();
                  }}
                >
                  {t('settings.connections.add.save')}
                </Button>
              </div>
            </div>
          </>
        )}
      </SettingsSection>

      <Dialog
        open={disconnectTarget !== null}
        onClose={() => setDisconnectTarget(null)}
        title={t('settings.connections.disconnect.title', {
          name: disconnectTarget?.config.name ?? '',
        })}
        data-testid="mcp-disconnect-dialog"
      >
        <div>
          <div className="v3-settings-row-subtitle">
            {t('settings.connections.disconnect.desc', {
              name: disconnectTarget?.config.name ?? '',
            })}
          </div>
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={() => setDisconnectTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={disconnectAction.pending}
              data-action="settings.connections.disconnect.confirm"
              onClick={() => {
                void disconnectAction.run();
              }}
            >
              {t('settings.common.confirm_disconnect')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
