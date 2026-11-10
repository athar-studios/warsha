// packages/ui/src/v3/primitives/Switch.tsx — Design System v3 Switch (DS v3 §3.1)
// Uses role="switch", aria-checked; label required; forwards data-action, data-testid, aria-*.

import React, { useId } from 'react';

export interface SwitchProps {
  label: string; // required
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  label,
  checked = false,
  onChange,
  disabled = false,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const switchId = useId();

  const handleToggle = () => {
    if (disabled) return;
    onChange?.(!checked);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <label
      htmlFor={switchId}
      className={`w-switch ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--w-space-3)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
        fontFamily: 'var(--w-font-sans)',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className="w-switch__track"
        style={{
          width: 'var(--w-space-9)',
          height: 'var(--w-space-6)',
          borderRadius: 'var(--w-radius-full)',
          backgroundColor: checked ? 'var(--w-primary)' : 'var(--w-sunken)',
          border: 'var(--w-border-width) solid var(--w-line-strong)',
          padding: 'var(--w-space-1)',
          display: 'inline-flex',
          alignItems: 'center',
          boxSizing: 'border-box',
          cursor: disabled ? 'not-allowed' : 'pointer',
          position: 'relative',
          transition: 'background-color var(--w-dur-fast) var(--w-ease)',
        }}
      >
        <span
          className="w-switch__thumb"
          style={{
            width: 'var(--w-space-4)',
            height: 'var(--w-space-4)',
            borderRadius: 'var(--w-radius-full)',
            backgroundColor: checked ? 'var(--w-on-primary)' : 'var(--w-text-muted)',
            display: 'block',
            transition: 'transform var(--w-dur-fast) var(--w-ease), background-color var(--w-dur-fast) var(--w-ease)',
            transform: checked ? 'translateX(var(--w-space-4))' : 'translateX(0)',
          }}
        />
      </button>

      <span
        className="w-switch__label"
        style={{
          fontSize: 'var(--w-font-size-md)',
          lineHeight: 'var(--w-line-height-md)',
          color: 'var(--w-text)',
        }}
      >
        {label}
      </span>
    </label>
  );
};

Switch.displayName = 'Switch';
