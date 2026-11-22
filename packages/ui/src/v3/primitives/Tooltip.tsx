// packages/ui/src/v3/primitives/Tooltip.tsx — Design System v3 Tooltip (DS v3 §3.1)
// Visible on hover + focus with 400ms delay; Esc closes; text-only content.

import React, { useEffect, useId, useRef, useState } from 'react';

export interface TooltipProps {
  content: string;
  children: React.ReactElement;
  delayMs?: number;
  className?: string;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  delayMs = 400,
  className = '',
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), delayMs);
  };

  const hide = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        hide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open]);

  const child = React.cloneElement(children, {
    'aria-describedby': open ? tooltipId : children.props['aria-describedby'],
    onMouseEnter: (e: React.MouseEvent) => {
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <span
      className={`w-tooltip-wrapper ${className}`.trim()}
      style={{ display: 'inline-flex', position: 'relative' }}
      data-action={dataAction}
      data-testid={dataTestId}
    >
      {child}
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="w-tooltip"
          style={{
            position: 'absolute',
            insetBlockEnd: 'calc(100% + var(--w-space-2))',
            insetInlineStart: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--w-text)',
            color: 'var(--w-surface)',
            paddingBlock: 'var(--w-space-1)',
            paddingInline: 'var(--w-space-2)',
            borderRadius: 'var(--w-radius-sm)',
            fontSize: 'var(--w-font-size-xs)',
            lineHeight: 'var(--w-line-height-xs)',
            whiteSpace: 'nowrap',
            zIndex: 'var(--w-layer-toast)',
            pointerEvents: 'none',
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
};

Tooltip.displayName = 'Tooltip';
