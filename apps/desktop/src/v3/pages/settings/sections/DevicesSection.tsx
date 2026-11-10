// apps/desktop/src/v3/pages/settings/sections/DevicesSection.tsx
import type { DeviceSummary, PairingOffer } from '@warsha/client';
/* eslint-disable import/no-unresolved */
import { useLocale, useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  IconPhone,
  KeyValue,
  SettingsSection,
  Skeleton,
  StatusPill,
} from '@warsha/ui/v3';
/* eslint-enable import/no-unresolved */
import React, { useEffect, useState } from 'react';

import { useAction } from '../../../actions';
import { useClient } from '../../../app/ClientContext';
import { useDataReady } from '../../../app/DataReadyContext';
import { useDevices } from '../../../data';

function formatTimestamp(iso: string | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: 'latn',
  }).format(date);
}

export function DevicesSection(): React.ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: devices, error, reload } = useDevices();

  const [pairOffer, setPairOffer] = useState<PairingOffer | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DeviceSummary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  const startPairAction = useAction('settings.device.pair.start', async () => {
    if (!client) return;
    const offer = await client.startPairing();
    setPairOffer(offer);
  });

  const revokeAction = useAction('settings.device.revoke.confirm', async () => {
    if (!client || !revokeTarget) return;
    await client.removeDevice(revokeTarget.id);
    setRevokeTarget(null);
    setStatusMessage(t('settings.common.action_done'));
    reload();
  });

  const anyDialogOpen = Boolean(pairOffer) || Boolean(revokeTarget);

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.devices')}
        description={t('settings.section.devices.desc')}
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
    <div data-testid="settings-section-devices">
      <SettingsSection
        title={t('settings.section.devices')}
        description={t('settings.section.devices.desc')}
        scope={<span className="v3-settings-scope">{t('settings.scope.daemon')}</span>}
        action={
          <Button
            variant={anyDialogOpen ? 'secondary' : 'primary'}
            size="sm"
            icon={<IconPhone size={16} />}
            loading={startPairAction.pending}
            data-action="settings.device.pair.start"
            onClick={() => {
              void startPairAction.run();
            }}
          >
            {t('settings.devices.pair')}
          </Button>
        }
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

        {status === 'empty' || !devices || devices.length === 0 ? (
          status !== 'error' && (
            <EmptyState
              icon={<IconPhone size={20} />}
              title={t('settings.devices.empty.title')}
              description={t('settings.devices.empty.desc')}
            />
          )
        ) : (
          <div>
            {devices.map((dev) => (
              <div key={dev.id} className="v3-settings-row" data-testid={`device-row-${dev.id}`}>
                <span className="v3-settings-row-icon" aria-hidden="true">
                  <IconPhone size={18} />
                </span>
                <div className="v3-settings-row-main">
                  <div className="v3-settings-row-title">
                    {dev.name || <bdi dir="ltr">{dev.id}</bdi>}
                  </div>
                  <div className="v3-settings-row-subtitle">
                    <span>
                      {t('settings.devices.paired_at')}: {formatTimestamp(dev.pairedAt, locale)}
                      {' · '}
                      {t('settings.devices.last_seen')}: {formatTimestamp(dev.lastSeen, locale)}
                    </span>
                  </div>
                </div>
                <div className="v3-settings-row-meta">
                  <StatusPill
                    status={dev.revoked ? 'failed' : 'done'}
                    label={
                      dev.revoked
                        ? t('settings.devices.status.revoked')
                        : t('settings.devices.status.active')
                    }
                  />
                </div>
                <div className="v3-settings-row-actions">
                  {!dev.revoked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-action="settings.device.revoke.open"
                      onClick={() => setRevokeTarget(dev)}
                    >
                      {t('settings.devices.revoke')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {/* QR Pairing Dialog */}
      <Dialog
        open={Boolean(pairOffer)}
        onClose={() => setPairOffer(null)}
        title={t('settings.devices.pair.title')}
        description={t('settings.devices.pair.desc')}
        data-testid="device-pair-dialog"
      >
        {pairOffer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w-space-4)', alignItems: 'center' }}>
            {pairOffer.qr_code_png && (
              <img
                src={`data:image/png;base64,${pairOffer.qr_code_png}`}
                alt={t('settings.devices.pair.title')}
                style={{
                  width: 'var(--w-nav-width)',
                  maxWidth: '100%',
                  aspectRatio: '1 / 1',
                  objectFit: 'contain',
                  border: 'var(--w-border-width) solid var(--w-line)',
                  borderRadius: 'var(--w-radius-md)',
                  backgroundColor: 'var(--w-surface)',
                }}
              />
            )}

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
              <KeyValue
                label={t('settings.devices.pair.origin')}
                value={<bdi dir="ltr">{pairOffer.server_origin}</bdi>}
              />
              <KeyValue
                label={t('settings.devices.pair.expires')}
                value={formatTimestamp(pairOffer.pairing.expires_at, locale)}
              />
            </div>

            {pairOffer.loopback_only && (
              <Banner variant="info">{t('settings.devices.pair.loopback_note')}</Banner>
            )}

            <div className="v3-settings-dialog-actions" style={{ width: '100%' }}>
              <Button
                variant="secondary"
                data-action="settings.dialog.cancel"
                onClick={() => setPairOffer(null)}
              >
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Confirm Revoke Dialog */}
      <Dialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title={t('settings.devices.revoke.title', {
          name: revokeTarget?.name || revokeTarget?.id || '',
        })}
        data-testid="device-revoke-dialog"
      >
        <div>
          <p style={{ margin: 0 }}>
            {t('settings.devices.revoke.desc', {
              name: revokeTarget?.name || revokeTarget?.id || '',
            })}
          </p>
          <div className="v3-settings-dialog-actions">
            <Button
              variant="ghost"
              data-action="settings.dialog.cancel"
              onClick={() => setRevokeTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={revokeAction.pending}
              data-action="settings.device.revoke.confirm"
              onClick={() => {
                void revokeAction.run();
              }}
            >
              {t('settings.common.confirm_revoke')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
