// packages/ui/src/v3/primitives/Badge.tsx — Design System v3 Badge (DS v3 §3.1)
// Variants: neutral, attention, primary. Count caps at 99+.

import React from 'react';

export type BadgeVariant = 'neutral' | 'attention' | 'primary';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  count?: number;
  variant?: BadgeVariant;
  'data-action'?: string;
  'data-testid'?: string;
}

const BADGE_STYLES: Record<BadgeVariant, React.CSSProperties> = {
  neutral: {
    backgroundColor: 'var(--w-sunken)',
    color: 'var(--w-text-muted)',
  },
  attention: {
    backgroundColor: 'var(--w-attention-soft)',
    color: 'var(--w-attention)',
  },
  primary: {
    backgroundColor: 'var(--w-primary-soft)',
    color: 'var(--w-primary-text)',
  },
};

export const Badge: React.FC<BadgeProps> = ({
  count,
  variant = 'neutral',
  children,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  const displayContent =
    count !== undefined ? (count > 99 ? '99+' : String(count)) : children;

  return (
    <span
      data-variant={variant}
      className={`w-badge w-badge--${variant} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingBlock: 'var(--w-space-1)',
        paddingInline: 'var(--w-space-2)',
        borderRadius: 'var(--w-radius-full)',
        fontSize: 'var(--w-font-size-xs)',
        lineHeight: 'var(--w-line-height-xs)',
        fontWeight: 'var(--w-font-weight-medium)',
        fontFamily: 'var(--w-font-sans)',
        minWidth: 'var(--w-space-5)',
        boxSizing: 'border-box',
        ...BADGE_STYLES[variant],
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    >
      {displayContent}
    </span>
  );
};

Badge.displayName = 'Badge';
