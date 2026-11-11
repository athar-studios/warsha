import type { LivePreview } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { useT } from '@warsha/i18n/v3';
import {
  Button,
  Card,
  IconExternal,
  IconPlay,
  IconStop,
  StatusPill,
// eslint-disable-next-line import/no-unresolved
} from '@warsha/ui/v3';
import React from 'react';

import { useCapabilities } from '../../../app/CapabilitiesContext';

export interface PreviewTabProps {
  preview: LivePreview | null;
  onStart: () => Promise<void> | void;
  startPending?: boolean;
  onStop: () => Promise<void> | void;
  stopPending?: boolean;
  onOpen: () => void;
}

export const PreviewTab: React.FC<PreviewTabProps> = ({
  preview,
  onStart,
  startPending = false,
  onStop,
  stopPending = false,
  onOpen,
}) => {
  const t = useT();
  const capabilities = useCapabilities();

  if (!capabilities.preview) {
    return (
      <div
        role="tabpanel"
        id="bench-panel-preview"
        aria-labelledby="bench-tab-preview"
        data-testid="bench-tabpanel-preview"
      >
        <Card>
          <p style={{ margin: 0, color: 'var(--w-text-muted)', fontSize: 'var(--w-font-size-sm)' }}>
            {t('bench.preview.unavailable')}
          </p>
        </Card>
      </div>
    );
  }

  const isRunning = preview?.status === 'running' || preview?.status === 'starting';

  return (
    <div
      role="tabpanel"
      id="bench-panel-preview"
      aria-labelledby="bench-tab-preview"
      data-testid="bench-tabpanel-preview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-4)',
      }}
    >
      <Card
        title={t('bench.preview.title')}
        data-testid="bench-preview-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--w-space-3)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
            <StatusPill
              status={isRunning ? 'running' : 'idle'}
              label={isRunning ? t('bench.preview.running') : t('bench.preview.stopped')}
            />
            {preview?.command && (
              <span dir="ltr" style={{ fontFamily: 'var(--w-font-mono)', fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                {preview.command} {preview.args?.join(' ')}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
            {isRunning ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconExternal size={14} />}
                  onClick={onOpen}
                  data-action="bench.preview.open"
                  data-testid="bench-preview-open-btn"
                >
                  {t('bench.action.preview_open')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<IconStop size={14} />}
                  loading={stopPending}
                  onClick={onStop}
                  data-action="bench.preview.stop"
                  data-testid="bench-preview-stop-btn"
                >
                  {t('bench.action.preview_stop')}
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={<IconPlay size={14} />}
                loading={startPending}
                onClick={onStart}
                data-action="bench.preview.start"
                data-testid="bench-preview-start-btn"
              >
                {t('bench.action.preview_start')}
              </Button>
            )}
          </div>
        </div>

        {isRunning && preview?.url && (
          <div
            style={{
              padding: 'var(--w-space-3)',
              backgroundColor: 'var(--w-sunken)',
              borderRadius: 'var(--w-radius-sm)',
              fontSize: 'var(--w-font-size-sm)',
            }}
          >
            <span style={{ color: 'var(--w-text-muted)' }}>
              {t('bench.preview.url_label', { url: '' })}
            </span>
            <bdi dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
              {preview.url}
            </bdi>
          </div>
        )}
      </Card>
    </div>
  );
};

PreviewTab.displayName = 'PreviewTab';
