// packages/ui/src/v3/primitives/TextArea.tsx — Design System v3 TextArea (DS v3 §3.1)
// Autosize support, optional counter, Enter submits only where configured.

import React, { useId, useState } from 'react';

export interface TextAreaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  counter?: boolean;
  onEnter?: () => void;
  'data-action'?: string;
  'data-testid'?: string;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      label,
      hint,
      error,
      counter = false,
      maxLength,
      onEnter,
      id,
      className = '',
      style,
      value,
      defaultValue,
      onChange,
      onKeyDown,
      rows = 3,
      disabled,
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

    const [charCount, setCharCount] = useState<number>(
      String(value ?? defaultValue ?? '').length
    );

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length);
      onChange?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && onEnter) {
        e.preventDefault();
        onEnter();
      }
      onKeyDown?.(e);
    };

    const describedBy = [
      error ? errorId : undefined,
      hint && !error ? hintId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div
        className={`w-field w-textarea ${className}`.trim()}
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
        {label && (
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
          </label>
        )}

        <div
          className="w-field__control"
          style={{
            position: 'relative',
            backgroundColor: 'var(--w-surface)',
            border: `var(--w-border-width) solid ${error ? 'var(--w-danger)' : 'var(--w-line-strong)'}`,
            borderRadius: 'var(--w-radius-sm)',
            padding: 'var(--w-space-2)',
            boxSizing: 'border-box',
          }}
        >
          <textarea
            ref={ref}
            id={inputId}
            rows={rows}
            maxLength={maxLength}
            disabled={disabled}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="w-textarea__input"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--w-text)',
              fontSize: 'var(--w-font-size-md)',
              lineHeight: 'var(--w-line-height-md)',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
            {...rest}
          />

          {counter && (
            <div
              className="w-textarea__counter"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                fontSize: 'var(--w-font-size-xs)',
                color: 'var(--w-text-muted)',
                marginBlockStart: 'var(--w-space-1)',
              }}
            >
              {charCount}
              {maxLength ? ` / ${maxLength}` : ''}
            </div>
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

TextArea.displayName = 'TextArea';
