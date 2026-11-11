// packages/ui/src/v3/composites/Dialog.tsx — Design System v3 Dialog (DS v3 §3.2)
// Confirmation and modal dialogs. Focus trap, Esc, return focus, layer-modal, scrim token.

import React from 'react';

import { IconX } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  closeLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  closeLabel,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (open) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;

      // Focus first focusable element inside dialog or the dialog container
      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements && focusableElements.length > 0) {
        focusableElements[0].focus();
      } else {
        dialogRef.current?.focus();
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
        if (!dialogRef.current) return;
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
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

  return (
    <div
      className="w-dialog-scrim"
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--w-space-4)',
        boxSizing: 'border-box',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-dialog ${className}`.trim()}
        style={{
          backgroundColor: 'var(--w-surface)',
          border: 'var(--w-border-width) solid var(--w-line)',
          borderRadius: 'var(--w-radius-lg)',
          boxShadow: 'var(--w-shadow-overlay)',
          color: 'var(--w-text)',
          fontFamily: 'var(--w-font-sans)',
          width: '100%',
          maxWidth: 'var(--w-content-narrow)',
          outline: 'none',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          ...style,
        }}
      >
        {(title || closeLabel) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBlock: 'var(--w-space-4)',
              paddingInline: 'var(--w-space-5)',
              borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
            }}
          >
            <div>
              {title && (
                <h2
                  style={{
                    margin: 0,
                    fontSize: 'var(--w-font-size-lg)',
                    lineHeight: 'var(--w-line-height-lg)',
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
                    fontSize: 'var(--w-font-size-sm)',
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
        )}

        <div
          style={{
            paddingBlock: 'var(--w-space-5)',
            paddingInline: 'var(--w-space-5)',
            overflowY: 'auto',
          }}
        >
          {children}
        </div>

        {actions && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 'var(--w-space-3)',
              paddingBlock: 'var(--w-space-4)',
              paddingInline: 'var(--w-space-5)',
              borderBlockStart: 'var(--w-border-width) solid var(--w-line)',
              backgroundColor: 'var(--w-sunken)',
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

Dialog.displayName = 'Dialog';
