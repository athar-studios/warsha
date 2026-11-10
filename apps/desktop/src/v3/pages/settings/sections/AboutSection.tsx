// apps/desktop/src/v3/pages/settings/sections/AboutSection.tsx
import { invoke } from '@tauri-apps/api/core';
/* eslint-disable import/no-unresolved */
import { useT } from '@warsha/i18n/v3';
import {
  Banner,
  Button,
  IconCopy,
  IconRefresh,
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
import { useHealth } from '../../../data';

export function AboutSection(): React.ReactElement {
  const t = useT();
  const client = useClient();
  const { setReady } = useDataReady();
  const { status, data: health, error, reload } = useHealth();

  const [dataDir, setDataDir] = useState<string>('—');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setReady(status !== 'loading');
  }, [status, setReady]);

  useEffect(() => {
    invoke<string>('get_config', { key: 'data_dir' })
      .then((val) => {
        if (val) setDataDir(val);
      })
      .catch(() => {
        // Non-tauri fallback
      });
  }, []);

  const refreshAction = useAction('settings.about.health.refresh', async () => {
    if (client) {
      await client.health();
    }
    reload();
  });

  const handleCopy = (): void => {
    const info = `Warsha Daemon ${health?.version ?? '—'} (Status: ${health?.status ?? 'down'}) - Data: ${dataDir}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(info).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (status === 'loading') {
    return (
      <SettingsSection
        title={t('settings.section.about')}
        description={t('settings.section.about.desc')}
        scope={t('settings.scope.device')}
      >
        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-3)' }}>
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      </SettingsSection>
    );
  }

  return (
    <div data-testid="settings-section-about">
      <SettingsSection
        title={t('settings.section.about')}
        description={t('settings.section.about.desc')}
        scope={t('settings.scope.device')}
        action={
          <div style={{ display: 'flex', gap: 'var(--w-space-2)' }}>
            <Button
              size="sm"
              variant="secondary"
              icon={<IconRefresh size={16} />}
              loading={refreshAction.pending}
              data-action="settings.about.health.refresh"
              onClick={() => {
                void refreshAction.run();
              }}
            >
              {t('settings.about.refresh')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconCopy size={16} />}
              data-action="settings.about.copy"
              onClick={handleCopy}
            >
              {copied ? t('settings.about.copied') : t('settings.about.copy')}
            </Button>
          </div>
        }
      >
        {status === 'error' && (
          <div style={{ padding: 'var(--w-space-4)' }}>
            <Banner
              variant="danger"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  data-action="settings.error.retry"
                  onClick={reload}
                >
                  {t('common.retry')}
                </Button>
              }
            >
              {error?.message ?? t('common.error')}
            </Banner>
          </div>
        )}

        <div style={{ padding: 'var(--w-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--w-space-2)' }}>
          <KeyValue
            label={t('settings.about.status')}
            value={
              <StatusPill
                status={health?.status === 'ok' ? 'done' : 'failed'}
                label={
                  health?.status === 'ok'
                    ? t('settings.about.status.ok')
                    : t('settings.about.status.down')
                }
              />
            }
          />
          <KeyValue
            label={t('settings.about.version')}
            value={<bdi dir="ltr">{health?.version ?? '—'}</bdi>}
          />
          <KeyValue
            label={t('settings.about.data_dir')}
            value={<bdi dir="ltr">{dataDir}</bdi>}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
