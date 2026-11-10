// apps/desktop/src/v3/pages/settings/sections/IntegrationsSection.tsx
import type { IntegrationConfig, IntegrationStatus } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconLink,
  IconPlug,
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

export function IntegrationsSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; status: string; message: string } | null>(null);

  // Connect / configure modal state
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectId, setConnectId] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [botTokenInput, setBotTokenInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [orgInput, setOrgInput] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Destructive disconnect modal
  const [disconnectTarget, setDisconnectTarget] = useState<IntegrationStatus | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setReady(false);
    setLoadFailed(false);
    setLoadError(null);
    if (!client) {
      setIntegrations([]);
      setLoading(false);
      setReady(true);
      return;
    }
    try {
      const rows = await client.listIntegrations();
      setIntegrations(rows);
      setLoading(false);
      setReady(true);
    } catch (err) {
      setLoadFailed(true);
      setLoadError(err instanceof Error ? err.message : null);
      setLoading(false);
      setReady(true);
    }
  }, [client, setReady]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const closeConnectModal = (): void => {
    setConnectOpen(false);
    setConnectId('');
    setTokenInput('');
    setBotTokenInput('');
    setWebhookInput('');
    setOrgInput('');
    setChannelInput('');
    setFormError(null);
  };

  const openConnectFor = (item?: IntegrationStatus): void => {
    setConnectOpen(true);
    setConnectId(item?.id ?? '');
    setTokenInput('');
    setBotTokenInput('');
    setWebhookInput('');
    setOrgInput('');
    setChannelInput('');
    setFormError(null);
  };

  const connectAction = useAction('settings.integration.connect', async () => {
    const cleanId = connectId.trim();
    if (!cleanId) {
      setFormError(t('settings.integrations.form.validation'));
      return;
    }
    setFormError(null);
    if (client) {
      const config: IntegrationConfig = {
        token: tokenInput.trim() || undefined,
        botToken: botTokenInput.trim() || undefined,
        webhookUrl: webhookInput.trim() || undefined,
        org: orgInput.trim() || undefined,
        channel: channelInput.trim() || undefined,
      };
      await client.connectIntegration(cleanId, config);
    }
    closeConnectModal();
    setStatusMessage(t('settings.common.action_done'));
    await loadData();
  });

  const testAction = useAction('settings.integration.test', async (id: string) => {
    if (!client) return;
    const res = await client.testIntegration(id);
    setTestResult({ id, status: res.status, message: res.message });
  });

  const disconnectAction = useAction('settings.integration.disconnect', async () => {
    if (!client || !disconnectTarget) return;
    await client.disconnectIntegration(disconnectTarget.id);
    setDisconnectTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    await loadData();
  });

  const anyDialogOpen = connectOpen || Boolean(disconnectTarget);

  if (loading) {
    return (
      <SettingsSection
        title={t('settings.section.integrations')}
        description={t('settings.section.integrations.desc')}
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
    <div data-testid="settings-section-integrations">
      <SettingsSection
        title={t('settings.section.integrations')}
        description={t('settings.section.integrations.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
        action={
          <Button
            variant={anyDialogOpen ? 'secondary' : 'primary'}
            size="sm"
            icon={<IconPlug size={16} />}
            data-action="settings.integration.connect.open"
            onClick={() => openConnectFor()}
          >
            {t('settings.integrations.connect_btn')}
          </Button>
        }
      >
        {loadFailed && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner variant="danger">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--w-space-3)', flexWrap: 'wrap' }}>
                <span>{loadError ?? t('common.error')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={() => {
                    void loadData();
                  }}
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

        {testResult && (
          <div style={{ padding: 'var(--w-space-4)', paddingBlockEnd: 0 }}>
            <Banner variant={testResult.status === 'ok' ? 'success' : 'info'}>
              {testResult.message}
            </Banner>
          </div>
        )}

        {integrations.length === 0 ? (
          !loadFailed && (
            <EmptyState
              icon={<IconLink size={20} />}
              title={t('settings.integrations.empty.title')}
              description={t('settings.integrations.empty.desc')}
            />
          )
        ) : (
          <div>
            {integrations.map((item) => (
              <div key={item.id} className="v3-settings-row" data-testid={`integration-row-${item.id}`}>
                <span className="v3-settings-row-icon" aria-hidden="true">
                  <IconLink size={18} />
                </span>
                <div className="v3-settings-row-main">
                  <div className="v3-settings-row-title">
                    {item.name || <bdi dir="ltr">{item.id}</bdi>}
                  </div>
                  {item.configuredAt && (
                    <div className="v3-settings-row-subtitle">
                      <span>{t('settings.devices.paired_at')}: {item.configuredAt}</span>
                    </div>
                  )}
                </div>
                <div className="v3-settings-row-meta">
                  <StatusPill
                    status={item.connected ? 'done' : 'idle'}
                    label={
                      item.connected
                        ? t('settings.integrations.connected')
                        : t('settings.integrations.disconnected')
                    }
                  />
                </div>
                <div className="v3-settings-row-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    data-action="settings.integration.connect.open"
                    onClick={() => openConnectFor(item)}
                  >
                    {t('settings.plugins.configure')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={testAction.pending}
                    data-action="settings.integration.test"
                    onClick={() => {
                      void testAction.run(item.id);
                    }}
                  >
                    {t('settings.integrations.test')}
                  </Button>
                  {item.connected && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="settings.integration.disconnect.open"
                      onClick={() => setDisconnectTarget(item)}
                    >
                      {t('settings.integrations.disconnect')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* Connect Integration Dialog */}
      <Dialog
        open={connectOpen}
        onClose={closeConnectModal}
        title={t('settings.integrations.form.title')}
        data-testid="integration-connect-dialog"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          {formError && <Banner variant="danger">{formError}</Banner>}
          <TextField
            label={t('settings.integrations.form.id')}
            required
            value={connectId}
            onChange={(e) => {
              setConnectId(e.target.value);
              setFormError(null);
            }}
            dir="ltr"
            data-testid="integration-id-input"
          />
          <TextField
            type="password"
            autoComplete="off"
            label={t('settings.integrations.form.token')}
            hint={t('settings.providers.key_saved_hint')}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            dir="ltr"
            data-testid="integration-token-input"
          />
          <TextField
            type="password"
            autoComplete="off"
            label={t('settings.integrations.form.bot_token')}
            value={botTokenInput}
            onChange={(e) => setBotTokenInput(e.target.value)}
            dir="ltr"
            data-testid="integration-bot-token-input"
          />
          <TextField
            type="url"
            label={t('settings.integrations.form.webhook')}
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
            dir="ltr"
            data-testid="integration-webhook-input"
          />
          <TextField
            label={t('settings.integrations.form.org')}
            value={orgInput}
            onChange={(e) => setOrgInput(e.target.value)}
            data-testid="integration-org-input"
          />
          <TextField
            label={t('settings.integrations.form.channel')}
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            data-testid="integration-channel-input"
          />
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={closeConnectModal}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={connectAction.pending}
              data-action="settings.integration.connect"
              onClick={() => {
                void connectAction.run();
              }}
            >
              {t('settings.integrations.form.save')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Confirm Disconnect Dialog */}
      <Dialog
        open={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        title={t('settings.integrations.disconnect.title', {
          name: disconnectTarget?.name || disconnectTarget?.id || '',
        })}
        data-testid="integration-disconnect-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.integrations.disconnect.desc', {
              name: disconnectTarget?.name || disconnectTarget?.id || '',
            })}
          </p>
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
              data-action="settings.integration.disconnect"
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
