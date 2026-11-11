// apps/desktop/src/v3/pages/settings/sections/PluginsSection.tsx
import type { PluginDefinition } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  IconPlug,
  IconTrash,
  SettingsSection,
  Skeleton,
  TextArea,
  TextField,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { usePlugins } from '../../../data';

export function PluginsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: plugins, error, reload } = usePlugins();

  const [installManifest, setInstallManifest] = useState('');
  const [installError, setInstallError] = useState<string | null>(null);

  // Configuration modal state
  const [configureTarget, setConfigureTarget] = useState<PluginDefinition | null>(null);
  const [envKeyInput, setEnvKeyInput] = useState('');
  const [envValInput, setEnvValInput] = useState('');
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});

  // Destructive remove state
  const [removeTarget, setRemoveTarget] = useState<PluginDefinition | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  const installAction = useAction('settings.plugin.install', async () => {
    const clean = installManifest.trim();
    if (!clean) {
      setInstallError(t('settings.plugins.install_empty'));
      return;
    }
    setInstallError(null);
    if (client) {
      await client.installPlugin(clean);
    }
    setInstallManifest('');
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const toggleAction = useAction(
    'settings.plugin.toggle',
    async (plugin: PluginDefinition) => {
      if (!client) return;
      await client.togglePlugin(plugin.id, !plugin.enabled);
      setStatusMessage(t('settings.common.action_done'));
      reload();
    }
  );

  const openConfigure = (p: PluginDefinition): void => {
    setConfigureTarget(p);
    setEnvDraft({ ...(p.env ?? {}) });
    setEnvKeyInput('');
    setEnvValInput('');
  };

  const closeConfigure = (): void => {
    setConfigureTarget(null);
    setEnvDraft({});
    setEnvKeyInput('');
    setEnvValInput('');
  };

  const saveConfigAction = useAction('settings.plugin.configure.save', async () => {
    if (!client || !configureTarget) return;
    const finalEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(envDraft)) {
      if (v.trim() !== '') {
        finalEnv[k] = v;
      }
    }
    if (envKeyInput.trim()) {
      finalEnv[envKeyInput.trim()] = envValInput.trim();
    }
    await client.configurePlugin(configureTarget.id, finalEnv);
    closeConfigure();
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const removeAction = useAction('settings.plugin.remove.confirm', async () => {
    if (!client || !removeTarget) return;
    await client.removePlugin(removeTarget.id);
    setRemoveTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const anyDialogOpen = Boolean(configureTarget) || Boolean(removeTarget);

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.plugins')}
        description={t('settings.section.plugins.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-plugins">
      <SettingsSection
        title={t('settings.section.plugins')}
        description={t('settings.section.plugins.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
      >
        {status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{error?.message ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={reload}
                >
                  {t('common.retry')}
                </Button>
              </div>
            </Banner>
          </div>
        )}

        {statusMessage && (
          <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
            <Banner variant="success">{statusMessage}</Banner>
          </div>
        )}

        {/* Install manifest form */}
        <div
          style={{
            padding: 'var(--w-space-4)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-3)',
          }}
        >
          <TextArea
            label={t('settings.plugins.manifest_label')}
            rows={3}
            value={installManifest}
            onChange={(e) => {
              setInstallManifest(e.target.value);
              setInstallError(null);
            }}
            error={installError ?? undefined}
            dir="ltr"
            data-testid="plugin-install-textarea"
          />
          <div>
            <Button
              variant={anyDialogOpen ? 'secondary' : 'primary'}
              size="sm"
              loading={installAction.pending}
              data-action="settings.plugin.install"
              onClick={() => {
                void installAction.run();
              }}
            >
              {t('settings.plugins.install_btn')}
            </Button>
          </div>
        </div>

        {/* Plugins list */}
        {status === 'empty' || !plugins || plugins.length === 0 ? (
          status !== 'error' && (
            <EmptyState
              icon={<IconPlug size={20} />}
              title={t('settings.plugins.empty.title')}
              description={t('settings.plugins.empty.desc')}
            />
          )
        ) : (
          <div>
            {plugins.map((p) => (
              <div key={p.id} className="v3-settings-row" data-testid={`plugin-row-${p.id}`}>
                <span className="v3-settings-row-icon" aria-hidden="true">
                  <IconPlug size={18} />
                </span>
                <div className="v3-settings-row-main">
                  <div className="v3-settings-row-title">
                    {p.name || <bdi dir="ltr">{p.id}</bdi>}
                  </div>
                  <div className="v3-settings-row-subtitle">
                    <span>
                      {p.description && (
                        <>
                          <span>{p.description}</span>
                          {' · '}
                        </>
                      )}
                      <bdi dir="ltr">{p.transport}</bdi>
                      {' · '}
                      <span>{t('settings.plugins.tools_count', { count: p.tools?.length ?? 0 })}</span>
                    </span>
                  </div>
                </div>
                <div className="v3-settings-row-meta">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled}
                    aria-label={t('settings.plugins.toggle', { name: p.name || p.id })}
                    data-action="settings.plugin.toggle"
                    className="v3-settings-switch-btn"
                    onClick={() => {
                      void toggleAction.run(p);
                    }}
                  >
                    <span className="v3-settings-switch-track">
                      <span className="v3-settings-switch-thumb" />
                    </span>
                  </button>
                </div>
                <div className="v3-settings-row-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="settings.plugin.configure.open"
                    onClick={() => openConfigure(p)}
                  >
                    {t('settings.plugins.configure')}
                  </Button>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    icon={<IconTrash size={16} />}
                    label={t('settings.plugins.remove')}
                    data-action="settings.plugin.remove.open"
                    onClick={() => setRemoveTarget(p)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Configure Plugin Dialog */}
      <Dialog
        open={Boolean(configureTarget)}
        onClose={closeConfigure}
        title={t('settings.plugins.configure.title', {
          name: configureTarget?.name || configureTarget?.id || '',
        })}
        data-testid="plugin-configure-dialog"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          {Object.entries(envDraft).map(([k, v]) => (
            <TextField
              key={k}
              type="password"
              autoComplete="off"
              label={k}
              value={v}
              onChange={(e) => {
                const nextVal = e.target.value;
                setEnvDraft((prev) => ({ ...prev, [k]: nextVal }));
              }}
              dir="ltr"
              data-testid={`plugin-env-draft-${k}`}
            />
          ))}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w-space-2)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 'var(--w-space-10)' }}>
              <TextField
                label={t('settings.plugins.configure.env_key')}
                value={envKeyInput}
                onChange={(e) => setEnvKeyInput(e.target.value)}
                dir="ltr"
                data-testid="plugin-env-key-input"
              />
            </div>
            <div style={{ flex: 1, minWidth: 'var(--w-space-10)' }}>
              <TextField
                type="password"
                autoComplete="off"
                label={t('settings.plugins.configure.env_val')}
                value={envValInput}
                onChange={(e) => setEnvValInput(e.target.value)}
                dir="ltr"
                data-testid="plugin-env-val-input"
              />
            </div>
          </div>

          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={closeConfigure}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={saveConfigAction.pending}
              data-action="settings.plugin.configure.save"
              onClick={() => {
                void saveConfigAction.run();
              }}
            >
              {t('settings.plugins.configure.save')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm Remove Plugin Dialog */}
      <Dialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={t('settings.plugins.remove.title', {
          name: removeTarget?.name || removeTarget?.id || '',
        })}
        data-testid="plugin-remove-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.plugins.remove.desc', {
              name: removeTarget?.name || removeTarget?.id || '',
            })}
          </p>
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={() => setRemoveTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removeAction.pending}
              data-action="settings.plugin.remove.confirm"
              onClick={() => {
                void removeAction.run();
              }}
            >
              {t('settings.common.confirm_remove')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
