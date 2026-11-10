// packages/ui/src/v3/primitives/StatusPill.tsx — Design System v3 StatusPill (DS v3 §3.1)
// Statuses: idle, running, waiting (attention), done, failed, paused.
// Always renders icon + word (never colour alone).

import React from 'react';

import {
  IconAlert,
  IconCheck,
  IconClock,
  IconPause,
  IconX,
} from '../icons';

import { Spinner } from './Spinner';

export type StatusPillState =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'paused';

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: StatusPillState;
  label?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

const STATUS_CONFIG: Record<
  StatusPillState,
  {
    defaultLabel: string;
    icon: React.ReactNode;
    style: React.CSSProperties;
  }
> = {
  idle: {
    defaultLabel: 'خامل',
    icon: <IconClock size={14} />,
    style: {
      backgroundColor: 'var(--w-sunken)',
      color: 'var(--w-text-muted)',
    },
  },
  running: {
    defaultLabel: 'قيد التنفيذ',
    icon: <Spinner size="sm" />,
    style: {
      backgroundColor: 'var(--w-info-soft)',
      color: 'var(--w-info)',
    },
  },
  waiting: {
    defaultLabel: 'ينتظر قرارك',
    icon: <IconAlert size={14} />,
    style: {
      backgroundColor: 'var(--w-attention-soft)',
      color: 'var(--w-attention)',
    },
  },
  done: {
    defaultLabel: 'مكتمل',
    icon: <IconCheck size={14} />,
    style: {
      backgroundColor: 'var(--w-success-soft)',
      color: 'var(--w-success)',
    },
  },
  failed: {
    defaultLabel: 'فشل',
    icon: <IconX size={14} />,
    style: {
      backgroundColor: 'var(--w-danger-soft)',
      color: 'var(--w-danger)',
    },
  },
  paused: {
    defaultLabel: 'موقوف مؤقتاً',
    icon: <IconPause size={14} />,
    style: {
      backgroundColor: 'var(--w-sunken)',
      color: 'var(--w-text-muted)',
    },
  },
};

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  const config = STATUS_CONFIG[status];
  const text = label ?? config.defaultLabel;

  return (
    <span
      data-status={status}
      className={`w-status-pill w-status-pill--${status} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--w-space-1)',
        paddingBlock: 'var(--w-space-1)',
        paddingInline: 'var(--w-space-2)',
        borderRadius: 'var(--w-radius-full)',
        fontSize: 'var(--w-font-size-xs)',
        lineHeight: 'var(--w-line-height-xs)',
        fontWeight: 'var(--w-font-weight-medium)',
        fontFamily: 'var(--w-font-sans)',
        ...config.style,
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {config.icon}
      </span>
      <span>{text}</span>
    </span>
  );
};

StatusPill.displayName = 'StatusPill';
