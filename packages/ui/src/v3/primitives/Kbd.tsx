// packages/ui/src/v3/primitives/Kbd.tsx — Design System v3 Keyboard key (DS v3 §3.1)
import React from 'react';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  'data-action'?: string;
  'data-testid'?: string;
}

export const Kbd: React.FC<KbdProps> = ({
  children,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  return (
    <kbd
      className={`w-kbd ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingBlock: 'var(--w-space-1)',
        paddingInline: 'var(--w-space-2)',
        backgroundColor: 'var(--w-sunken)',
        border: 'var(--w-border-width) solid var(--w-line-strong)',
        borderRadius: 'var(--w-radius-sm)',
        fontFamily: 'var(--w-font-mono)',
        fontSize: 'var(--w-font-size-xs)',
        lineHeight: 'var(--w-line-height-xs)',
        color: 'var(--w-text)',
        boxShadow: 'var(--w-shadow-1)',
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    >
      {children}
    </kbd>
  );
};

Kbd.displayName = 'Kbd';
