// packages/ui/src/v3/primitives/Combobox.tsx — Design System v3 Combobox (DS v3 §3.1)
// Searchable options, keyboard navigation, empty/loading/error states.

import React, { useId, useRef, useState } from 'react';

import { IconCheck, IconChevron } from '../icons';

import { Spinner } from './Spinner';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  label?: string;
  options: ComboboxOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Combobox: React.FC<ComboboxProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'اختر أو ابحث...',
  loading = false,
  error,
  emptyText = 'لا توجد نتائج مطابقة',
  disabled = false,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(query.toLowerCase()) ||
      opt.value.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (opt: ComboboxOption) => {
    if (opt.disabled) return;
    onChange?.(opt.value);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setActiveIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && activeIndex < filteredOptions.length) {
        handleSelect(filteredOptions[activeIndex]);
      } else if (!open) {
        setOpen(true);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`w-field w-combobox ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-1)',
        position: 'relative',
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
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--w-surface)',
          border: `var(--w-border-width) solid ${error ? 'var(--w-danger)' : 'var(--w-line-strong)'}`,
          borderRadius: 'var(--w-radius-sm)',
          minHeight: 'var(--w-control-height)',
          boxSizing: 'border-box',
          paddingInline: 'var(--w-space-3)',
        }}
      >
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${generatedId}-opt-${activeIndex}` : undefined
          }
          disabled={disabled}
          value={open ? query : selectedOption ? selectedOption.label : ''}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-combobox__input"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--w-text)',
            fontSize: 'var(--w-font-size-md)',
            lineHeight: 'var(--w-line-height-md)',
            fontFamily: 'inherit',
          }}
        />

        {loading ? (
          <Spinner size="sm" />
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label="تبديل القائمة"
            onClick={() => setOpen(!open)}
            disabled={disabled}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--w-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              padding: 0,
            }}
          >
            <IconChevron size={16} mirror={false} />
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="w-combobox__listbox"
          style={{
            position: 'absolute',
            insetBlockStart: 'calc(100% + var(--w-space-1))',
            insetInlineStart: 0,
            insetInlineEnd: 0,
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            boxShadow: 'var(--w-shadow-1)',
            maxHeight: 'var(--w-nav-width)',
            overflowY: 'auto',
            padding: 'var(--w-space-1)',
            margin: 0,
            listStyle: 'none',
            zIndex: 'var(--w-layer-dropdown)',
          }}
        >
          {loading ? (
            <li
              style={{
                padding: 'var(--w-space-3)',
                textAlign: 'center',
                color: 'var(--w-text-muted)',
                fontSize: 'var(--w-font-size-sm)',
              }}
            >
              <Spinner size="sm" />
            </li>
          ) : filteredOptions.length === 0 ? (
            <li
              style={{
                padding: 'var(--w-space-3)',
                textAlign: 'center',
                color: 'var(--w-text-muted)',
                fontSize: 'var(--w-font-size-sm)',
              }}
            >
              {emptyText}
            </li>
          ) : (
            filteredOptions.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isActive = idx === activeIndex;

              return (
                <li
                  key={opt.value}
                  id={`${generatedId}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className="w-combobox__option"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBlock: 'var(--w-space-2)',
                    paddingInline: 'var(--w-space-3)',
                    borderRadius: 'var(--w-radius-sm)',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    backgroundColor: isActive
                      ? 'var(--w-sunken)'
                      : isSelected
                      ? 'var(--w-primary-soft)'
                      : 'transparent',
                    color: opt.disabled
                      ? 'var(--w-text-faint)'
                      : isSelected
                      ? 'var(--w-primary-text)'
                      : 'var(--w-text)',
                    fontSize: 'var(--w-font-size-sm)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>{opt.label}</span>
                    {opt.description && (
                      <span style={{ fontSize: 'var(--w-font-size-xs)', color: 'var(--w-text-muted)' }}>
                        {opt.description}
                      </span>
                    )}
                  </div>
                  {isSelected && <IconCheck size={16} />}
                </li>
              );
            })
          )}
        </ul>
      )}

      {error && (
        <span
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
    </div>
  );
};

Combobox.displayName = 'Combobox';
