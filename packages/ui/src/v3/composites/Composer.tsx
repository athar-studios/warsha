// packages/ui/src/v3/composites/Composer.tsx — Design System v3 Composer (DS v3 §3.2)
// Controlled value, onSubmit, Enter sends / Shift+Enter breaks.
// variant: 'simple' | 'advanced'. submitVariant: 'primary' | 'secondary'. disabledReason.

import React from 'react';

import { IconSend } from '../icons';
import { Button } from '../primitives/Button';

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  variant?: 'simple' | 'advanced';
  submitVariant?: 'primary' | 'secondary';
  placeholder?: string;
  disabledReason?: string;
  disabled?: boolean;
  loading?: boolean;
  submitLabel?: string;
  advancedControls?: React.ReactNode;
  extraActions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSubmit,
  variant = 'simple',
  submitVariant = 'secondary',
  placeholder,
  disabledReason,
  disabled = false,
  loading = false,
  submitLabel,
  advancedControls,
  extraActions,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const isSubmitDisabled = disabled || loading || Boolean(disabledReason) || !value.trim();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isSubmitDisabled) {
        onSubmit();
      }
    }
  };

  return (
    <div
      data-variant={variant}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-composer w-composer--${variant} ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--w-surface)',
        border: 'var(--w-border-width) solid var(--w-line)',
        borderRadius: 'var(--w-radius-xl)',
        boxShadow: 'var(--w-shadow-1)',
        padding: 'var(--w-space-4)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || loading}
        rows={variant === 'advanced' ? 4 : 3}
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
          color: 'var(--w-text)',
          fontFamily: 'var(--w-font-sans)',
          fontSize: 'var(--w-font-size-md)',
          lineHeight: 'var(--w-line-height-md)',
          resize: 'none',
          boxSizing: 'border-box',
        }}
        data-testid="composer-textarea"
      />

      {variant === 'advanced' && advancedControls && (
        <div
          className="w-composer__advanced"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w-space-2)',
            flexWrap: 'wrap',
            paddingBlock: 'var(--w-space-2)',
          }}
        >
          {advancedControls}
        </div>
      )}

      <div
        className="w-composer__footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w-space-2)',
          borderBlockStart: 'var(--w-border-width) solid var(--w-line)',
          paddingBlockStart: 'var(--w-space-3)',
          marginTop: 'var(--w-space-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
          {extraActions}
        </div>

        <Button
          variant={submitVariant}
          iconEnd={<IconSend size={16} />}
          onClick={onSubmit}
          disabled={isSubmitDisabled}
          disabledReason={disabledReason}
          loading={loading}
          data-action="composer.submit"
          data-testid="composer-submit-btn"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
};

Composer.displayName = 'Composer';
