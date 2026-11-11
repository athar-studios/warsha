// packages/ui/src/v3/composites/Sheet.tsx — Design System v3 Sheet (DS v3 §3.2)
// Side panel / drawer. Focus trap, Esc, return focus, layer-modal, scrim token.

import React from 'react';

import { IconX } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel?: string;
  side?: 'start' | 'end';
  width?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Sheet: React.FC<SheetProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  side = 'end',
  width = 'var(--w-rail-width)',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (open) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;

      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable && focusable.length > 0) {
        focusable[0].focus();
      } else {
        sheetRef.current?.focus();
      }
    } else if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus();
      previousActiveElementRef.current = null;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        if (!sheetRef.current) return;
        const focusable = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );

        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isEnd = side === 'end';

  return (
    <div
      className="w-sheet-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w-scrim)',
        zIndex: 'var(--w-layer-modal)',
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-sheet w-sheet--${side} ${className}`.trim()}
        style={{
          position: 'fixed',
          insetBlockStart: 0,
          insetBlockEnd: 0,
          insetInlineStart: isEnd ? undefined : 0,
          insetInlineEnd: isEnd ? 0 : undefined,
          width,
          maxWidth: '100%',
          backgroundColor: 'var(--w-surface)',
          borderInlineStart: isEnd ? 'var(--w-border-width) solid var(--w-line)' : undefined,
          borderInlineEnd: isEnd ? undefined : 'var(--w-border-width) solid var(--w-line)',
          boxShadow: 'var(--w-shadow-overlay)',
          color: 'var(--w-text)',
          fontFamily: 'var(--w-font-sans)',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          boxSizing: 'border-box',
          overflow: 'hidden',
          ...style,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBlock: 'var(--w-space-4)',
            paddingInline: 'var(--w-space-4)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
          }}
        >
          <div>
            {title && (
              <h2
                style={{
                  margin: 0,
                  fontSize: 'var(--w-font-size-md)',
                  lineHeight: 'var(--w-line-height-md)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                }}
              >
                {title}
              </h2>
            )}
            {description && (
              <div
                style={{
                  color: 'var(--w-text-muted)',
                  fontSize: 'var(--w-font-size-xs)',
                  marginTop: 'var(--w-space-1)',
                }}
              >
                {description}
              </div>
            )}
          </div>

          {closeLabel && (
            <IconButton
              icon={<IconX size={18} />}
              label={closeLabel}
              variant="ghost"
              size="sm"
              onClick={onClose}
            />
          )}
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingBlock: 'var(--w-space-4)',
            paddingInline: 'var(--w-space-4)',
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              paddingBlock: 'var(--w-space-3)',
              paddingInline: 'var(--w-space-4)',
              borderBlockStart: 'var(--w-border-width) solid var(--w-line)',
              backgroundColor: 'var(--w-sunken)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

Sheet.displayName = 'Sheet';
