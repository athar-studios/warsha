// packages/ui/src/v3/composites/EmptyState.tsx — Design System v3 EmptyState (DS v3 §3.2)
// Icon, one sentence description, one action. Rendered when lists are empty.

import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-empty-state ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        paddingBlock: 'var(--w-space-8)',
        paddingInline: 'var(--w-space-4)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {icon && (
        <div
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'var(--w-space-10)',
            height: 'var(--w-space-10)',
            borderRadius: 'var(--w-radius-full)',
            backgroundColor: 'var(--w-sunken)',
            color: 'var(--w-text-muted)',
            marginBottom: 'var(--w-space-3)',
          }}
        >
          {icon}
        </div>
      )}

      <div
        style={{
          fontSize: 'var(--w-font-size-md)',
          lineHeight: 'var(--w-line-height-md)',
          fontWeight: 'var(--w-font-weight-semibold)',
          color: 'var(--w-text)',
        }}
      >
        {title}
      </div>

      {description && (
        <div
          style={{
            fontSize: 'var(--w-font-size-sm)',
            lineHeight: 'var(--w-line-height-sm)',
            color: 'var(--w-text-muted)',
            marginTop: 'var(--w-space-1)',
            maxWidth: 'var(--w-content-narrow)',
          }}
        >
          {description}
        </div>
      )}

      {action && (
        <div style={{ marginTop: 'var(--w-space-4)' }}>
          {action}
        </div>
      )}
    </div>
  );
};

EmptyState.displayName = 'EmptyState';
