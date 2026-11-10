// packages/ui/src/v3/primitives/TextField.tsx — Design System v3 TextField (DS v3 §3.1)
// Requires visible label; error has aria-invalid + message id; prefix/suffix support.

import React, { useId } from 'react';

export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string; // required
  hint?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  'data-action'?: string;
  'data-testid'?: string;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      label,
      hint,
      error,
      prefix,
      suffix,
      id,
      className = '',
      style,
      disabled,
      required,
      'data-action': dataAction,
      'data-testid': dataTestId,
      ...rest
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    const describedBy = [
      error ? errorId : undefined,
      hint && !error ? hintId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div
        className={`w-field w-textfield ${className}`.trim()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w-space-1)',
          fontFamily: 'var(--w-font-sans)',
          ...style,
        }}
        data-action={dataAction}
        data-testid={dataTestId}
      >
        <label
          htmlFor={inputId}
          className="w-field__label"
          style={{
            fontSize: 'var(--w-font-size-sm)',
            fontWeight: 'var(--w-font-weight-medium)',
            color: 'var(--w-text)',
          }}
        >
          {label}
          {required && (
            <span aria-hidden="true" style={{ marginInlineStart: 'var(--w-space-1)', color: 'var(--w-danger)' }}>
              *
            </span>
          )}
        </label>

        <div
          className="w-field__control"
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--w-surface)',
            border: `var(--w-border-width) solid ${error ? 'var(--w-danger)' : 'var(--w-line-strong)'}`,
            borderRadius: 'var(--w-radius-sm)',
            minHeight: 'var(--w-control-height)',
            paddingInline: 'var(--w-space-3)',
            boxSizing: 'border-box',
          }}
        >
          {prefix && (
            <span
              className="w-field__prefix"
              style={{
                marginInlineEnd: 'var(--w-space-2)',
                color: 'var(--w-text-muted)',
                fontSize: 'var(--w-font-size-sm)',
              }}
            >
              {prefix}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="w-field__input"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              fontFamily: 'inherit',
              paddingBlock: 'var(--w-space-2)',
            }}
            {...rest}
          />

          {suffix && (
            <span
              className="w-field__suffix"
              style={{
                marginInlineStart: 'var(--w-space-2)',
                color: 'var(--w-text-muted)',
                fontSize: 'var(--w-font-size-sm)',
              }}
            >
              {suffix}
            </span>
          )}
        </div>

        {error && (
          <span
            id={errorId}
            role="alert"
            className="w-field__error"
            style={{
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-danger)',
            }}
          >
            {error}
          </span>
        )}

        {hint && !error && (
          <span
            id={hintId}
            className="w-field__hint"
            style={{
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-text-muted)',
            }}
          >
            {hint}
          </span>
        )}
      </div>
    );
  }
);

TextField.displayName = 'TextField';
