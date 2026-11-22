// packages/ui/src/v3/primitives/Segmented.tsx — Design System v3 Segmented Control (DS v3 §3.1)
// 2–4 options, single choice, role="radiogroup", arrows move, Space/Enter selects.

import React, { useRef } from 'react';

export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Segmented: React.FC<SegmentedProps> = ({
  options,
  value,
  onChange = () => {},
  disabled = false,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    let nextIndex = currentIndex;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!options[currentIndex].disabled && !disabled) {
        onChange(options[currentIndex].value);
      }
      return;
    }

    if (nextIndex !== currentIndex) {
      const nextOpt = options[nextIndex];
      if (!nextOpt.disabled && !disabled) {
        onChange(nextOpt.value);
        const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
        buttons?.[nextIndex]?.focus();
      }
    }
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      className={`w-segmented ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: 'var(--w-sunken)',
        borderRadius: 'var(--w-radius-sm)',
        padding: 'var(--w-space-1)',
        gap: 'var(--w-space-1)',
        fontFamily: 'var(--w-font-sans)',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      {options.map((opt, idx) => {
        const isSelected = opt.value === value;
        const optDisabled = disabled || opt.disabled;

        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={optDisabled}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => !optDisabled && onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`w-segmented__item ${isSelected ? 'w-segmented__item--selected' : ''}`.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: 'var(--w-radius-sm)',
              paddingBlock: 'var(--w-space-1)',
              paddingInline: 'var(--w-space-3)',
              minHeight: 'var(--w-control-height)',
              fontSize: 'var(--w-font-size-sm)',
              lineHeight: 'var(--w-line-height-sm)',
              fontWeight: isSelected ? 'var(--w-font-weight-medium)' : 'var(--w-font-weight-regular)',
              backgroundColor: isSelected ? 'var(--w-surface)' : 'transparent',
              color: isSelected ? 'var(--w-text)' : 'var(--w-text-muted)',
              boxShadow: isSelected ? 'var(--w-shadow-1)' : 'none',
              cursor: optDisabled ? 'not-allowed' : 'pointer',
              opacity: optDisabled ? 0.5 : 1,
              transition: 'background-color var(--w-dur-fast) var(--w-ease), color var(--w-dur-fast) var(--w-ease)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

Segmented.displayName = 'Segmented';
