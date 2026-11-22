// packages/ui/src/v3/primitives/Skeleton.tsx — Design System v3 Skeleton (DS v3 §3.1)
// aria-hidden="true", shaped like content, subtle shimmer animation.

import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circular' | 'rectangular';
  'data-action'?: string;
  'data-testid'?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  variant = 'text',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  const isCircular = variant === 'circular';

  return (
    <span
      aria-hidden="true"
      data-variant={variant}
      className={`w-skeleton w-skeleton--${variant} ${className}`.trim()}
      style={{
        display: 'inline-block',
        backgroundColor: 'var(--w-sunken)',
        borderRadius: isCircular
          ? 'var(--w-radius-full)'
          : variant === 'text'
          ? 'var(--w-radius-sm)'
          : 'var(--w-radius-md)',
        width: width ?? (isCircular ? 'var(--w-space-8)' : '100%'),
        height: height ?? (isCircular ? 'var(--w-space-8)' : variant === 'text' ? 'var(--w-font-size-md)' : 'var(--w-space-10)'),
        opacity: 0.8,
        animation: 'w-pulse 1.5s ease-in-out infinite',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    />
  );
};

Skeleton.displayName = 'Skeleton';
