// packages/ui/src/v3/primitives/IconButton.tsx — Design System v3 IconButton (DS v3 §3.1)
// Requires label (becomes aria-label + Tooltip). Forwards data-action, data-testid, aria-*.

import React from 'react';

import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { Tooltip } from './Tooltip';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: React.ReactNode;
  label: string; // required
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabledReason?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

const ICON_SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    width: 'var(--w-control-height)',
    height: 'var(--w-control-height)',
    padding: 0,
  },
  md: {
    width: 'var(--w-control-height)',
    height: 'var(--w-control-height)',
    padding: 0,
  },
  lg: {
    width: 'var(--w-control-height)',
    height: 'var(--w-control-height)',
    padding: 0,
  },
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      label,
      variant = 'ghost',
      size = 'md',
      disabledReason,
      className = '',
      style,
      ...rest
    },
    ref
  ) => {
    const tooltipContent = disabledReason ?? label;

    return (
      <Tooltip content={tooltipContent}>
        <Button
          ref={ref}
          variant={variant}
          size={size}
          aria-label={label}
          disabledReason={disabledReason}
          className={`w-icon-button ${className}`.trim()}
          style={{
            ...ICON_SIZE_STYLES[size],
            ...style,
          }}
          {...rest}
        >
          {icon}
        </Button>
      </Tooltip>
    );
  }
);

IconButton.displayName = 'IconButton';
