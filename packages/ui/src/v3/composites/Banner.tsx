// packages/ui/src/v3/composites/Banner.tsx — Design System v3 Banner (DS v3 §3.2)
// info / success / attention / danger; optional action. role="status" or role="alert" (danger).

import React from 'react';

import { IconAlert, IconCheck, IconInfo, IconX } from '../icons';
import { IconButton } from '../primitives/IconButton';

export type BannerVariant = 'info' | 'success' | 'attention' | 'danger';

export interface BannerProps {
  variant?: BannerVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

const VARIANT_CONFIG: Record<
  BannerVariant,
  {
    bg: string;
    border: string;
    color: string;
    icon: React.ReactNode;
  }
> = {
  info: {
    bg: 'var(--w-info-soft)',
    border: 'var(--w-info)',
    color: 'var(--w-info)',
    icon: <IconInfo size={20} />,
  },
  success: {
    bg: 'var(--w-success-soft)',
    border: 'var(--w-success)',
    color: 'var(--w-success)',
    icon: <IconCheck size={20} />,
  },
  attention: {
    bg: 'var(--w-attention-soft)',
    border: 'var(--w-attention)',
    color: 'var(--w-attention)',
    icon: <IconAlert size={20} />,
  },
  danger: {
    bg: 'var(--w-danger-soft)',
    border: 'var(--w-danger)',
    color: 'var(--w-danger)',
    icon: <IconAlert size={20} />,
  },
};

export const Banner: React.FC<BannerProps> = ({
  variant = 'info',
  title,
  children,
  icon,
  action,
  onDismiss,
  dismissLabel,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const config = VARIANT_CONFIG[variant];
  const role = variant === 'danger' ? 'alert' : 'status';
  const displayIcon = icon ?? config.icon;

  return (
    <div
      role={role}
      data-variant={variant}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-banner w-banner--${variant} ${className}`.trim()}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--w-space-3)',
        paddingBlock: 'var(--w-space-3)',
        paddingInline: 'var(--w-space-4)',
        backgroundColor: config.bg,
        border: 'var(--w-border-width) solid var(--w-line)',
        borderInlineStart: 'var(--w-space-1) solid ' + config.border,
        borderRadius: 'var(--w-radius-md)',
        color: 'var(--w-text)',
        fontFamily: 'var(--w-font-sans)',
        fontSize: 'var(--w-font-size-sm)',
        lineHeight: 'var(--w-line-height-sm)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: config.color,
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
          marginTop: 'var(--w-space-1)',
        }}
      >
        {displayIcon}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontWeight: 'var(--w-font-weight-semibold)',
              marginBottom: children ? 'var(--w-space-1)' : 0,
            }}
          >
            {title}
          </div>
        )}
        {children && <div>{children}</div>}
      </div>

      {action && (
        <div style={{ flexShrink: 0, alignSelf: 'center' }}>{action}</div>
      )}

      {onDismiss && dismissLabel && (
        <div style={{ flexShrink: 0 }}>
          <IconButton
            icon={<IconX size={16} />}
            label={dismissLabel}
            variant="ghost"
            size="sm"
            onClick={onDismiss}
          />
        </div>
      )}
    </div>
  );
};

Banner.displayName = 'Banner';
