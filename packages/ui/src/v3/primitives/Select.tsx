// packages/ui/src/v3/primitives/Select.tsx — Design System v3 Select (DS v3 §3.1)
// Native-backed select; label required; keyboard native.

import React, { useId } from 'react';

import { IconChevron } from '../icons';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string; // required
  options: SelectOption[];
  hint?: string;
  error?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      options,
      hint,
      error,
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
    const selectId = id ?? generatedId;
    const errorId = `${selectId}-error`;
    const hintId = `${selectId}-hint`;

    const describedBy = [
      error ? errorId : undefined,
      hint && !error ? hintId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div
        className={`w-field w-select ${className}`.trim()}
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
          htmlFor={selectId}
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
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--w-surface)',
            border: `var(--w-border-width) solid ${error ? 'var(--w-danger)' : 'var(--w-line-strong)'}`,
            borderRadius: 'var(--w-radius-sm)',
            minHeight: 'var(--w-control-height)',
            boxSizing: 'border-box',
          }}
        >
          <select
            ref={ref}
            id={selectId}
            disabled={disabled}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="w-select__input"
            style={{
              width: '100%',
              minHeight: 'var(--w-control-height)',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              fontFamily: 'inherit',
              paddingInlineStart: 'var(--w-space-3)',
              paddingInlineEnd: 'var(--w-space-8)',
              appearance: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
            {...rest}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>

          <span
            className="w-select__chevron"
            aria-hidden="true"
            style={{
              position: 'absolute',
              insetInlineEnd: 'var(--w-space-3)',
              pointerEvents: 'none',
              color: 'var(--w-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              transform: 'rotate(90deg)',
            }}
          >
            <IconChevron size={16} mirror={false} />
          </span>
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

Select.displayName = 'Select';
