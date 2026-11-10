// packages/ui/src/v3/primitives/ProgressBar.tsx — Design System v3 ProgressBar (DS v3 §3.1)
// role="progressbar", aria-valuenow; logical layout; RTL-aware.

import React from 'react';

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number; // 0 to max
  max?: number;
  label?: string;
  variant?: 'primary' | 'attention' | 'success';
  'data-action'?: string;
  'data-testid'?: string;
}

const VARIANT_COLORS = {
  primary: 'var(--w-primary)',
  attention: 'var(--w-attention)',
  success: 'var(--w-success)',
} as const;

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  label = 'التقدم',
  variant = 'primary',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  const isIndeterminate = value === undefined;
  const percentage = !isIndeterminate ? Math.min(100, Math.max(0, (value / max) * 100)) : undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`w-progress-bar w-progress-bar--${variant} ${className}`.trim()}
      style={{
        display: 'flex',
        width: '100%',
        height: 'var(--w-space-2)',
        borderRadius: 'var(--w-radius-full)',
        backgroundColor: 'var(--w-sunken)',
        overflow: 'hidden',
        position: 'relative',
        boxSizing: 'border-box',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    >
      <div
        className="w-progress-bar__fill"
        style={{
          height: '100%',
          width: isIndeterminate ? '30%' : `${percentage}%`,
          backgroundColor: VARIANT_COLORS[variant],
          borderRadius: 'var(--w-radius-full)',
          transition: isIndeterminate ? 'none' : 'width var(--w-dur) var(--w-ease)',
          animation: isIndeterminate ? 'w-progress-indeterminate 1.5s infinite ease-in-out' : 'none',
        }}
      />
    </div>
  );
};

ProgressBar.displayName = 'ProgressBar';
