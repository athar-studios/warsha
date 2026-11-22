// packages/ui/src/v3/primitives/Spinner.tsx — Design System v3 Spinner (DS v3 §3.1)
import React from 'react';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

const SIZE_MAP = {
  sm: 16,
  md: 20,
  lg: 28,
} as const;

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  label = 'جارٍ التحميل...',
  className = '',
  style,
  ...rest
}) => {
  const pixelSize = SIZE_MAP[size];

  return (
    <span
      role="progressbar"
      aria-label={label}
      data-size={size}
      className={`w-spinner w-spinner--${size} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'currentColor',
        ...style,
      }}
      {...rest}
    >
      <svg
        viewBox="0 0 24 24"
        width={pixelSize}
        height={pixelSize}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          animation: 'w-spin 0.8s linear infinite',
        }}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" />
      </svg>
    </span>
  );
};

Spinner.displayName = 'Spinner';
