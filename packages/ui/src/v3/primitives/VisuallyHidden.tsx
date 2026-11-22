// packages/ui/src/v3/primitives/VisuallyHidden.tsx — Design System v3 VisuallyHidden (DS v3 §3.1)
import React from 'react';

export interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export const VisuallyHidden: React.FC<VisuallyHiddenProps> = ({
  children,
  style,
  ...rest
}) => {
  return (
    <span
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        padding: 0,
        margin: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        border: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
};

VisuallyHidden.displayName = 'VisuallyHidden';
