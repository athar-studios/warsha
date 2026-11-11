// packages/ui/src/v3/composites/PreviewCard.tsx — Design System v3 PreviewCard (DS v3 §3.2)
// Start/stop/open live preview. Rendered only when preview capability is available.

import React from 'react';

import { IconExternal, IconPlay, IconStop } from '../icons';
import { Button } from '../primitives/Button';
import { StatusPill, type StatusPillState } from '../primitives/StatusPill';

export type PreviewStatus = 'idle' | 'running' | 'stopped';

export interface PreviewCardProps {
  available?: boolean;
  status?: PreviewStatus;
  url?: string;
  title?: React.ReactNode;
  statusLabel?: string;
  onStart?: () => void;
  onStop?: () => void;
  onOpen?: () => void;
  startLabel?: string;
  stopLabel?: string;
  openLabel?: string;
  unavailableMessage?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

const STATUS_MAP: Record<PreviewStatus, StatusPillState> = {
  idle: 'idle',
  running: 'running',
  stopped: 'paused',
};

export const PreviewCard: React.FC<PreviewCardProps> = ({
  available = true,
  status = 'idle',
  url,
  title,
  statusLabel,
  onStart,
  onStop,
  onOpen,
  startLabel = '',
  stopLabel = '',
  openLabel = '',
  unavailableMessage,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  if (!available) {
    if (!unavailableMessage) return null;
    return (
      <div
        className={`w-preview-card w-preview-card--unavailable ${className}`.trim()}
        style={{
          paddingBlock: 'var(--w-space-3)',
          paddingInline: 'var(--w-space-4)',
          borderRadius: 'var(--w-radius-md)',
          backgroundColor: 'var(--w-sunken)',
          color: 'var(--w-text-muted)',
          fontSize: 'var(--w-font-size-sm)',
          ...style,
        }}
        data-action={dataAction}
        data-testid={dataTestId}
      >
        {unavailableMessage}
      </div>
    );
  }

  const isRunning = status === 'running';

  return (
    <div
      data-status={status}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-preview-card ${className}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--w-space-4)',
        paddingBlock: 'var(--w-space-3)',
        paddingInline: 'var(--w-space-4)',
        borderRadius: 'var(--w-radius-md)',
        border: 'var(--w-border-width) solid var(--w-line)',
        backgroundColor: 'var(--w-surface)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-3)', minWidth: 0 }}>
        <StatusPill status={STATUS_MAP[status]} label={statusLabel} />

        {title && (
          <span
            style={{
              fontWeight: 'var(--w-font-weight-medium)',
              fontSize: 'var(--w-font-size-sm)',
              color: 'var(--w-text)',
            }}
          >
            {title}
          </span>
        )}

        {isRunning && url && (
          <span
            dir="ltr"
            style={{
              fontFamily: 'var(--w-font-mono)',
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {url}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          flexShrink: 0,
        }}
      >
        {isRunning ? (
          <>
            {onOpen && openLabel && (
              <Button
                variant="secondary"
                size="sm"
                icon={<IconExternal size={14} />}
                onClick={onOpen}
                data-action="preview.open"
                data-testid="preview-open-btn"
              >
                {openLabel}
              </Button>
            )}

            {onStop && stopLabel && (
              <Button
                variant="ghost"
                size="sm"
                icon={<IconStop size={14} />}
                onClick={onStop}
                data-action="preview.stop"
                data-testid="preview-stop-btn"
              >
                {stopLabel}
              </Button>
            )}
          </>
        ) : (
          onStart && startLabel && (
            <Button
              variant="secondary"
              size="sm"
              icon={<IconPlay size={14} />}
              onClick={onStart}
              data-action="preview.start"
              data-testid="preview-start-btn"
            >
              {startLabel}
            </Button>
          )
        )}
      </div>
    </div>
  );
};

PreviewCard.displayName = 'PreviewCard';
