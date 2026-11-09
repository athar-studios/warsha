// packages/ui/src/v3/primitives/Button.tsx — Design System v3 Button (DS v3 §3.1)
// Variants: primary (logo yellow fill), secondary, ghost, danger.
// Supports loading (aria-busy, keeps width), disabledReason (aria-disabled + Tooltip), icon, iconEnd.
// Must render data-variant attribute (Gate U0.8).

import React from 'react';

import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconEnd?: React.ReactNode;
  loading?: boolean;
  disabledReason?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--w-primary)',
    color: 'var(--w-on-primary)',
    border: 'none',
  },
  secondary: {
    backgroundColor: 'var(--w-surface)',
    color: 'var(--w-text)',
    border: 'var(--w-border-width) solid var(--w-line-strong)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--w-text)',
    border: 'none',
  },
  danger: {
    backgroundColor: 'var(--w-danger)',
    color: 'var(--w-surface)',
    border: 'none',
  },
};

const SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    minHeight: 'var(--w-control-height)',
    paddingBlock: 'var(--w-space-1)',
    paddingInline: 'var(--w-space-3)',
    fontSize: 'var(--w-font-size-sm)',
    lineHeight: 'var(--w-line-height-sm)',
  },
  md: {
    minHeight: 'var(--w-control-height)',
    paddingBlock: 'var(--w-space-2)',
    paddingInline: 'var(--w-space-4)',
    fontSize: 'var(--w-font-size-md)',
    lineHeight: 'var(--w-line-height-md)',
  },
  lg: {
    minHeight: 'var(--w-control-height)',
    paddingBlock: 'var(--w-space-3)',
    paddingInline: 'var(--w-space-5)',
    fontSize: 'var(--w-font-size-lg)',
    lineHeight: 'var(--w-line-height-lg)',
  },
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      icon,
      iconEnd,
      loading = false,
      disabledReason,
      disabled,
      className = '',
      style,
      children,
      type = 'button',
      'data-action': dataAction,
      'data-testid': dataTestId,
      ...rest
    },
    ref
  ) => {
    const isDisabled = disabled || loading || Boolean(disabledReason);
    const ariaDisabled = Boolean(disabledReason) || undefined;

    const buttonElement = (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-disabled={ariaDisabled}
        aria-busy={loading ? true : undefined}
        data-variant={variant}
        data-size={size}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-button w-button--${variant} w-button--${size} ${loading ? 'w-button--loading' : ''} ${className}`.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--w-space-2)',
          fontFamily: 'var(--w-font-sans)',
          fontWeight: 'var(--w-font-weight-medium)',
          borderRadius: 'var(--w-radius-sm)',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled && !loading ? 0.5 : 1,
          position: 'relative',
          textDecoration: 'none',
          boxSizing: 'border-box',
          transition: 'background-color var(--w-dur-fast) var(--w-ease), opacity var(--w-dur-fast) var(--w-ease)',
          ...VARIANT_STYLES[variant],
          ...SIZE_STYLES[size],
          ...style,
        }}
        {...rest}
      >
        {loading && (
          <span
            className="w-button__spinner"
            style={{
              position: 'absolute',
              insetInlineStart: '50%',
              insetBlockStart: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spinner size={size === 'lg' ? 'md' : 'sm'} />
          </span>
        )}

        <span
          className="w-button__content"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--w-space-2)',
            visibility: loading ? 'hidden' : 'visible',
          }}
        >
          {icon && <span className="w-button__icon" aria-hidden="true">{icon}</span>}
          {children}
          {iconEnd && <span className="w-button__icon-end" aria-hidden="true">{iconEnd}</span>}
        </span>
      </button>
    );

    if (disabledReason) {
      return <Tooltip content={disabledReason}>{buttonElement}</Tooltip>;
    }

    return buttonElement;
  }
);

Button.displayName = 'Button';
