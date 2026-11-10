// packages/ui/src/v3/primitives/Radio.tsx — Design System v3 Radio (DS v3 §3.1)
// Label required; logical layout; forwards data-action, data-testid, aria-*.

import React, { useId } from 'react';

export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string; // required
  error?: string;
  hint?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  (
    {
      label,
      error,
      hint,
      id,
      checked,
      disabled,
      className = '',
      style,
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
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
      <div
        className={`w-radio-field ${className}`.trim()}
        style={{
          display: 'inline-flex',
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
          className="w-radio"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--w-space-2)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            userSelect: 'none',
          }}
        >
          <input
            ref={ref}
            id={inputId}
            type="radio"
            checked={checked}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="w-radio__input"
            style={{
              position: 'absolute',
              opacity: 0,
              width: 0,
              height: 0,
              margin: 0,
            }}
            {...rest}
          />
          <span
            className="w-radio__circle"
            aria-hidden="true"
            style={{
              width: 'var(--w-space-5)',
              height: 'var(--w-space-5)',
              borderRadius: 'var(--w-radius-full)',
              border: `var(--w-border-width) solid ${error ? 'var(--w-danger)' : checked ? 'var(--w-primary-text)' : 'var(--w-line-strong)'}`,
              backgroundColor: 'var(--w-surface)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
              flexShrink: 0,
              transition: 'border-color var(--w-dur-fast) var(--w-ease)',
            }}
          >
            {checked && (
              <span
                style={{
                  width: 'var(--w-space-2)',
                  height: 'var(--w-space-2)',
                  borderRadius: 'var(--w-radius-full)',
                  backgroundColor: 'var(--w-primary)',
                }}
              />
            )}
          </span>
          <span
            className="w-radio__label"
            style={{
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              color: 'var(--w-text)',
            }}
          >
            {label}
          </span>
        </label>

        {error && (
          <span
            id={errorId}
            role="alert"
            style={{
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-danger)',
              marginInlineStart: 'calc(var(--w-space-5) + var(--w-space-2))',
            }}
          >
            {error}
          </span>
        )}

        {hint && !error && (
          <span
            id={hintId}
            className="w-radio__hint"
            style={{
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-text-muted)',
              marginInlineStart: 'calc(var(--w-space-5) + var(--w-space-2))',
            }}
          >
            {hint}
          </span>
        )}
      </div>
    );
  }
);

Radio.displayName = 'Radio';
