// packages/ui/src/v3/primitives/Divider.tsx — Design System v3 Divider (DS v3 §3.1)
import React from 'react';

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  orientation?: 'horizontal' | 'vertical';
  'data-action'?: string;
  'data-testid'?: string;
}

export const Divider: React.FC<DividerProps> = ({
  orientation = 'horizontal',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
  ...rest
}) => {
  const isVertical = orientation === 'vertical';

  return (
    <hr
      role="separator"
      aria-orientation={orientation}
      className={`w-divider w-divider--${orientation} ${className}`.trim()}
      style={{
        border: 'none',
        backgroundColor: 'var(--w-line)',
        margin: 0,
        ...(isVertical
          ? {
              width: 'var(--w-border-width)',
              height: '100%',
              display: 'inline-block',
            }
          : {
              width: '100%',
              height: 'var(--w-border-width)',
              display: 'block',
            }),
        ...style,
      }}
      data-action={dataAction}
      data-testid={dataTestId}
      {...rest}
    />
  );
};

Divider.displayName = 'Divider';
