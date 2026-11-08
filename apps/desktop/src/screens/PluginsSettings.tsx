// Settings → Plugins (PLAN.md Wave 2): the bundled MCP packs, wired to `plugins.*`.
//
// The seven MCP packs this build ships (github, slack, filesystem, git, memory, sequential
// thinking, strix security) are read from the daemon through `plugins.list`; a daemon that
// does not answer still shows the owner the bundled packs with the failure said in words (§7).
//
// The screen keeps the bench's rules:
//
//   * transport, command, args and tool names are machine data (§11): shown as written, in
//     mono LTR; the catalog only owns the labels around them;
//   * environment values are secrets: the form writes them to the daemon (`plugins.configure`)
//     and forgets them — the screen never renders a value the owner typed back, only the
//     variable names the daemon reports;
//   * toggles and installs land on the daemon, and rows adopt the daemon's returned shape
//     rather than an optimistic guess;
//   * the keychain note (plugins.env_note) says where values go, because AGENTS.md says the
//     OS keychain holds them.
import { type PluginDefinition, type ProjectSummary, type WarshaClient } from '@warsha/client';
import { t, useDirection, useLocale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  EmptyState,
  Field,
  Lamp,
  Ledger,
  Panel,
  Skeleton,
  Stamp,
  Text,
  fieldControl,
  SettingsScopeSentence,
} from '@warsha/ui';
import React, { useCallback, useEffect, useState } from 'react';

interface PluginsSettingsProps {
  client: WarshaClient;
  project?: ProjectSummary | null;
}

const MCP_SERVERS_SOURCE = 'github.com/modelcontextprotocol/servers';

/** The bundled packs this build ships, in showcase order — the fallback reading. */
const BUNDLED_PLUGINS: readonly { id: string; name: string; enabled: boolean; source: string }[] = [
  { id: 'github-mcp', name: 'GitHub', enabled: true, source: MCP_SERVERS_SOURCE },
  { id: 'slack-mcp', name: 'Slack', enabled: true, source: MCP_SERVERS_SOURCE },
  { id: 'filesystem-mcp', name: 'Filesystem', enabled: true, source: MCP_SERVERS_SOURCE },
  { id: 'git-mcp', name: 'Git', enabled: true, source: MCP_SERVERS_SOURCE },
  { id: 'memory-mcp', name: 'Memory', enabled: true, source: MCP_SERVERS_SOURCE },
  { id: 'sequential-thinking-mcp', name: 'Sequential Thinking', enabled: true, source: MCP_SERVERS_SOURCE },
  { id: 'security-strix-pack', name: 'Strix Security', enabled: false, source: 'github.com/usestrix/strix' },
];

function bundledPlugins(): PluginDefinition[] {
  return BUNDLED_PLUGINS.map((pack) => ({
    id: pack.id,
    name: pack.name,
    description: '',
    transport: 'stdio',
    command: null,
    args: [],
    env: {},
    enabled: pack.enabled,
    tools: [],
    source: pack.source,
  }));
}

interface EnvRow {
  key: string;
  value: string;
}

export function PluginsSettings({ client, project }: PluginsSettingsProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [plugins, setPlugins] = useState<PluginDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [envDone, setEnvDone] = useState(false);
  const [installed, setInstalled] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [manifest, setManifest] = useState('');
  const [installing, setInstalling] = useState(false);
  const [envFor, setEnvFor] = useState<string | null>(null);
  const [envRows, setEnvRows] = useState<EnvRow[]>([{ key: '', value: '' }]);
  const [savingEnv, setSavingEnv] = useState(false);

  const label = useCallback((key: string, values?: MessageValues) => t(key, values ?? {}, locale), [locale]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      let answer: PluginDefinition[] | null = null;
      try {
        answer = await client.listPlugins();
      } catch {
        answer = null;
      }
      if (cancelled) return;
      if (answer === null) {
        // §7: the failure is said, and the bundled packs are what the owner still gets to read.
        setFailed(true);
        setPlugins(bundledPlugins());
      } else {
        setFailed(false);
        setPlugins(answer);
      }
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, reload]);

  const toggle = async (plugin: PluginDefinition) => {
    setActionError(null);
    try {
      const updated = await client.togglePlugin(plugin.id, !plugin.enabled);
      setPlugins((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      setActionError(label('plugins.failed'));
    }
  };

  const openEnv = (plugin: PluginDefinition) => {
    setEnvFor(plugin.id === envFor ? null : plugin.id);
    setEnvRows([{ key: '', value: '' }]);
    setActionError(null);
    setEnvDone(false);
  };

  const saveEnv = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (envFor === null) return;
    const record: Record<string, string> = {};
    for (const row of envRows) {
      if (row.key.trim() !== '' && row.value.trim() !== '') record[row.key.trim()] = row.value;
    }
    setSavingEnv(true);
    setActionError(null);
    try {
      const updated = await client.configurePlugin(envFor, record);
      setPlugins((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setEnvDone(true);
      // secrets are written once and forgotten: the form never keeps a value to re-render (§, AGENTS.md).
      setEnvRows([{ key: '', value: '' }]);
    } catch {
      setActionError(label('plugins.env_failed'));
      setEnvRows([{ key: '', value: '' }]);
    } finally {
      setSavingEnv(false);
    }
  };

  const install = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manifest.trim() === '') return;
    setInstalling(true);
    setActionError(null);
    try {
      const created = await client.installPlugin(manifest);
      setPlugins((previous) => [...previous, created]);
      setInstalled(created.name);
      setShowInstall(false);
      setManifest('');
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.length > 0 ? error.message : label('plugins.install_failed')
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Box
      dir={dir}
      className="plugins-settings"
      data-testid="settings-plugins"
      style={{
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-4)',
        maxInlineSize: 'var(--warsha-size-plate-max)',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--warsha-space-4)',
        minInlineSize: 0,
      }}
    >
      <header dir={dir} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--warsha-space-4)', flexWrap: 'wrap' }}>
        <Box dir={dir} style={{ flex: '1', minInlineSize: 0 }}>
          <h1
            dir={dir}
            style={{
              margin: 0,
              fontSize: 'var(--warsha-font-size-xl)',
              fontWeight: 'var(--warsha-font-weight-bold)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {label('plugins.title')}
          </h1>
          <Text size="sm" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('plugins.desc')}
          </Text>
        </Box>
        <Button
          variant={showInstall ? 'secondary' : 'primary'}
          dir={dir}
          aria-expanded={showInstall}
          data-testid="plugins-install-open"
          onClick={() => {
            setShowInstall((open) => !open);
            setActionError(null);
          }}
        >
          {label('plugins.install')}
        </Button>
      </header>

      {/* Settings scope sentence (t3code pattern): shows whether these settings apply globally or to a specific project */}
      <Box dir={dir} style={{ paddingInline: 'var(--warsha-space-4)', paddingBlock: 'var(--warsha-space-2)' }}>
        <SettingsScopeSentence project={project} dir={dir} />
      </Box>

      {failed && (
        <Banner
          tone="error"
          action={
            <Button variant="secondary" size="sm" dir={dir} onClick={() => setReload((n) => n + 1)}>
              {label('common.retry')}
            </Button>
          }
        >
          {label('plugins.failed')}
        </Banner>
      )}

      {installed && (
        <Box dir={dir}>
          <Stamp tone="ok">{label('plugins.install_done', { name: installed })}</Stamp>
        </Box>
      )}

      {showInstall && (
        <Panel title={label('plugins.install_title')} label={label('plugins.install_title')}>
          <form onSubmit={install} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
            <Field id="plugins-install-manifest" label={label('plugins.install_manifest_label')} required>
              <textarea
                {...fieldControl('plugins-install-manifest')}
                dir="ltr"
                rows={6}
                spellCheck={false}
                value={manifest}
                onChange={(event) => setManifest(event.target.value)}
                style={{ fontFamily: 'var(--warsha-font-mono)', minInlineSize: 0 }}
              />
            </Field>

            {actionError && <Banner tone="error">{actionError}</Banner>}

            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" dir={dir} onClick={() => setShowInstall(false)}>
                {label('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" dir={dir} disabled={installing || manifest.trim() === ''}>
                {label('plugins.install_submit')}
              </Button>
            </Box>
          </form>
        </Panel>
      )}

      {loading ? (
        <Box dir={dir} p={4}>
          <Skeleton label={label('plugins.loading')} variant="row" lines={6} />
        </Box>
      ) : plugins.length === 0 ? (
        <EmptyState
          title={label('plugins.empty')}
          action={
            <Button variant="primary" dir={dir} onClick={() => setShowInstall(true)}>
              {label('plugins.install')}
            </Button>
          }
        />
      ) : (
        <Ledger label={label('plugins.bundled')} recessed>
          {plugins.map((plugin) => {
            const envOpen = envFor === plugin.id;
            const envKeys = Object.keys(plugin.env);
            return (
              <Ledger.Row
                key={plugin.id}
                selected={plugin.enabled}
                meta={
                  <Chip label={label(plugin.enabled ? 'skills.enabled' : 'skills.disabled')}>
                    {label(plugin.enabled ? 'skills.enabled' : 'skills.disabled')}
                  </Chip>
                }
                actions={
                  <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      dir={dir}
                      aria-expanded={envOpen}
                      data-testid={`plugin-env-${plugin.id}`}
                      onClick={() => openEnv(plugin)}
                    >
                      {label('plugins.configure_env')}
                    </Button>
                    <Button
                      variant={plugin.enabled ? 'ghost' : 'secondary'}
                      size="sm"
                      dir={dir}
                      aria-label={`${label('plugins.toggle')} — ${plugin.name}`}
                      data-testid={`plugin-toggle-${plugin.id}`}
                      onClick={() => void toggle(plugin)}
                    >
                      {label('plugins.toggle')}
                    </Button>
                  </Box>
                }
              >
                <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}>
                  <Box dir={dir} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
                    <Text size="sm" weight="medium" dir={dir}>
                      {plugin.name}
                    </Text>
                    <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontSize: 'var(--warsha-font-size-xs)' }}>
                      {plugin.id}
                    </span>
                    {plugin.enabled ? (
                      <Lamp state="ok" size="xs">
                        {label('skills.enabled')}
                      </Lamp>
                    ) : null}
                  </Box>

                  {plugin.description.length > 0 && (
                    <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                      {plugin.description}
                    </Text>
                  )}

                  {/* launch shape (§11): the machine wrote it, the screen only labels it. */}
                  <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text size="xs" dir="ltr" style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                      {`${label('plugins.transport')}: ${plugin.transport}`}
                    </Text>
                    {plugin.command !== null && (
                      <Text size="xs" dir="ltr" translate="no" data-testid={`plugin-command-${plugin.id}`} style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                        {`${label('plugins.command')}: ${[plugin.command, ...plugin.args].join(' ')}`}
                      </Text>
                    )}
                  </Box>

                  <Text size="xs" dir={dir} data-testid={`plugin-tools-${plugin.id}`}>
                    {label('plugins.tools')}: {label('plugins.tool_count', { count: plugin.tools.length })}
                  </Text>

                  {envKeys.length > 0 && (
                    <Box dir={dir} style={{ display: 'inline-flex', gap: 'var(--warsha-space-1)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <Text size="xs" dir={dir}>
                        {label('plugins.env')}:
                      </Text>
                      {envKeys.map((key) => (
                        <Chip key={key} label={key}>
                          <span dir="ltr" translate="no">
                            {key}
                          </span>
                        </Chip>
                      ))}
                    </Box>
                  )}

                  {envOpen && (
                    <Panel title={label('plugins.configure_env')} label={label('plugins.configure_env')}>
                      <form onSubmit={saveEnv} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)' }}>
                        <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                          {label('plugins.env_note')}
                        </Text>

                        {envRows.map((row, index) => (
                          <Box
                            key={index}
                            dir={dir}
                            style={{ display: 'flex', gap: 'var(--warsha-space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}
                          >
                            <Box dir={dir} style={{ flex: '1', minInlineSize: 'var(--warsha-size-input-min)' }}>
                              <Field id={`plugins-env-key-${index}`} label={label('plugins.env_key')}>
                                <input
                                  {...fieldControl(`plugins-env-key-${index}`)}
                                  dir="ltr"
                                  value={row.key}
                                  onChange={(event) =>
                                    setEnvRows((previous) =>
                                      previous.map((entry, position) =>
                                        position === index ? { ...entry, key: event.target.value } : entry
                                      )
                                    )
                                  }
                                  style={{ fontFamily: 'var(--warsha-font-mono)' }}
                                />
                              </Field>
                            </Box>
                            <Box dir={dir} style={{ flex: '1', minInlineSize: 'var(--warsha-size-input-min)' }}>
                              <Field id={`plugins-env-value-${index}`} label={label('plugins.env_value')}>
                                <input
                                  {...fieldControl(`plugins-env-value-${index}`)}
                                  dir="ltr"
                                  type="password"
                                  autoComplete="off"
                                  value={row.value}
                                  onChange={(event) =>
                                    setEnvRows((previous) =>
                                      previous.map((entry, position) =>
                                        position === index ? { ...entry, value: event.target.value } : entry
                                      )
                                    )
                                  }
                                  style={{ fontFamily: 'var(--warsha-font-mono)' }}
                                />
                              </Field>
                            </Box>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              dir={dir}
                              aria-label={label('plugins.env_remove')}
                              data-testid={`plugins-env-remove-${index}`}
                              disabled={envRows.length === 1}
                              onClick={() =>
                                setEnvRows((previous) => (previous.length > 1 ? previous.filter((_, position) => position !== index) : previous))
                              }
                            >
                              {label('plugins.env_remove')}
                            </Button>
                          </Box>
                        ))}

                        <Box dir={dir}>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            dir={dir}
                            data-testid="plugins-env-add"
                            onClick={() => setEnvRows((previous) => [...previous, { key: '', value: '' }])}
                          >
                            {label('plugins.env_add')}
                          </Button>
                        </Box>

                        {envDone && (
                          <Box dir={dir}>
                            <Stamp tone="ok">{label('plugins.env_done')}</Stamp>
                          </Box>
                        )}

                        <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <Button type="button" variant="secondary" dir={dir} onClick={() => setEnvFor(null)}>
                            {label('common.cancel')}
                          </Button>
                          <Button
                            type="submit"
                            variant="primary"
                            dir={dir}
                            disabled={savingEnv || !envRows.some((row) => row.key.trim() !== '' && row.value.trim() !== '')}
                          >
                            {label('plugins.env_submit')}
                          </Button>
                        </Box>
                      </form>
                    </Panel>
                  )}
                </Box>
              </Ledger.Row>
            );
          })}
        </Ledger>
      )}
    </Box>
  );
}
