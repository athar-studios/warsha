// packages/ui/src/v3/composites/BudgetField.tsx — Design System v3 BudgetField (DS v3 §3.2)
// Presets come from settings, custom amount. $ prefix isolated LTR.

import React from 'react';

import { Button } from '../primitives/Button';

export interface BudgetFieldProps {
  value?: number | string;
  onChange?: (value: number | string) => void;
  presets?: number[];
  presetLabelPrefix?: string;
  customPlaceholder?: string;
  currencySymbol?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const BudgetField: React.FC<BudgetFieldProps> = ({
  value,
  onChange,
  presets = [5, 10, 25, 50],
  presetLabelPrefix = '',
  customPlaceholder,
  currencySymbol = '$',
  ariaLabel,
  disabled = false,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const numericValue = typeof value === 'number' ? value : Number(value);

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-budget-field ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-2)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {presets.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w-space-2)',
            flexWrap: 'wrap',
          }}
        >
          {presets.map((preset) => {
            const isSelected = numericValue === preset;
            return (
              <Button
                key={preset}
                variant={isSelected ? 'primary' : 'secondary'}
                size="sm"
                disabled={disabled}
                onClick={() => onChange?.(preset)}
                data-selected={isSelected ? 'true' : undefined}
                style={{
                  minWidth: 'var(--w-space-8)',
                }}
              >
                <span dir="ltr" style={{ fontFamily: 'var(--w-font-mono)' }}>
                  {currencySymbol}
                  {preset}
                </span>
                {presetLabelPrefix && <span> {presetLabelPrefix}</span>}
              </Button>
            );
          })}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          paddingBlock: 'var(--w-space-1)',
          paddingInline: 'var(--w-space-3)',
          borderRadius: 'var(--w-radius-sm)',
          border: 'var(--w-border-width) solid var(--w-line-strong)',
          backgroundColor: 'var(--w-surface)',
          minHeight: 'var(--w-control-height)',
          boxSizing: 'border-box',
        }}
      >
        <span
          dir="ltr"
          aria-hidden="true"
          style={{
            fontFamily: 'var(--w-font-mono)',
            fontSize: 'var(--w-font-size-md)',
            color: 'var(--w-text-muted)',
            userSelect: 'none',
          }}
        >
          {currencySymbol}
        </span>

        <input
          type="number"
          min="0"
          step="any"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={customPlaceholder}
          aria-label={ariaLabel}
          disabled={disabled}
          data-testid="budget-custom-input"
          style={{
            border: 'none',
            background: 'transparent',
            outline: 'none',
            width: '100%',
            fontFamily: 'var(--w-font-mono)',
            fontSize: 'var(--w-font-size-md)',
            color: 'var(--w-text)',
            direction: 'ltr',
          }}
        />
      </div>
    </div>
  );
};

BudgetField.displayName = 'BudgetField';
