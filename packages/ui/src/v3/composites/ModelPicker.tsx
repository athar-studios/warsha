// packages/ui/src/v3/composites/ModelPicker.tsx — Design System v3 ModelPicker (DS v3 §3.2)
// Data-driven model picker. Options provided strictly by caller.
// Empty options triggers onAddModel. Displays provider, label, and id in LTR.

import React from 'react';

import { IconChevron, IconPlus } from '../icons';
import { Button } from '../primitives/Button';

export interface ModelOption {
  id: string;
  label: string;
  providerLabel?: string;
}

export interface ModelPickerProps {
  options: ModelOption[];
  value?: string;
  onChange?: (id: string) => void;
  onAddModel?: () => void;
  addModelLabel?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  options = [],
  value,
  onChange,
  onAddModel,
  addModelLabel = '',
  emptyLabel = '',
  ariaLabel,
  disabled = false,
  disabledReason,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (options.length === 0) {
    return (
      <div
        data-action={dataAction}
        data-testid={dataTestId}
        className={`w-model-picker w-model-picker--empty ${className}`.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          ...style,
        }}
      >
        {emptyLabel && (
          <span
            style={{
              fontSize: 'var(--w-font-size-sm)',
              color: 'var(--w-text-muted)',
            }}
          >
            {emptyLabel}
          </span>
        )}
        {onAddModel && addModelLabel && (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconPlus size={16} />}
            onClick={onAddModel}
            disabled={disabled}
            disabledReason={disabledReason}
            data-action="models.add"
            data-testid="model-picker-add-btn"
          >
            {addModelLabel}
          </Button>
        )}
      </div>
    );
  }

  const selectedOption = options.find((opt) => opt.id === value) ?? options[0];

  return (
    <div
      ref={containerRef}
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-model-picker ${className}`.trim()}
      style={{
        position: 'relative',
        display: 'inline-block',
        ...style,
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled || Boolean(disabledReason)}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          minHeight: 'var(--w-control-height)',
          paddingBlock: 'var(--w-space-1)',
          paddingInline: 'var(--w-space-3)',
          borderRadius: 'var(--w-radius-sm)',
          border: 'var(--w-border-width) solid var(--w-line-strong)',
          backgroundColor: 'var(--w-surface)',
          color: 'var(--w-text)',
          cursor: disabled || disabledReason ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--w-font-sans)',
          fontSize: 'var(--w-font-size-sm)',
          fontWeight: 'var(--w-font-weight-medium)',
        }}
        data-testid="model-picker-trigger"
      >
        {selectedOption?.providerLabel && (
          <span
            style={{
              fontSize: 'var(--w-font-size-xs)',
              color: 'var(--w-text-muted)',
              backgroundColor: 'var(--w-sunken)',
              paddingBlock: 'var(--w-space-1)',
              paddingInline: 'var(--w-space-2)',
              borderRadius: 'var(--w-radius-sm)',
            }}
          >
            {selectedOption.providerLabel}
          </span>
        )}

        <span>{selectedOption?.label}</span>

        <span
          dir="ltr"
          style={{
            fontFamily: 'var(--w-font-mono)',
            fontSize: 'var(--w-font-size-xs)',
            color: 'var(--w-text-faint)',
          }}
        >
          ({selectedOption?.id})
        </span>

        <IconChevron
          size={16}
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--w-dur-fast) var(--w-ease)',
          }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="w-model-picker__menu"
          style={{
            position: 'absolute',
            insetBlockStart: '100%',
            insetInlineStart: 0,
            marginTop: 'var(--w-space-1)',
            minWidth: 'var(--w-rail-width)',
            backgroundColor: 'var(--w-surface)',
            border: 'var(--w-border-width) solid var(--w-line)',
            borderRadius: 'var(--w-radius-md)',
            boxShadow: 'var(--w-shadow-2)',
            zIndex: 'var(--w-layer-dropdown)',
            padding: 'var(--w-space-1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--w-space-1)',
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.id === (value ?? selectedOption?.id);
            return (
              <button
                key={opt.id}
                role="option"
                type="button"
                aria-selected={isSelected}
                onClick={() => {
                  onChange?.(opt.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--w-space-2)',
                  paddingBlock: 'var(--w-space-2)',
                  paddingInline: 'var(--w-space-3)',
                  borderRadius: 'var(--w-radius-sm)',
                  border: 'none',
                  backgroundColor: isSelected
                    ? 'var(--w-primary-soft)'
                    : 'transparent',
                  color: isSelected ? 'var(--w-primary-text)' : 'var(--w-text)',
                  cursor: 'pointer',
                  textAlign: 'start',
                  fontFamily: 'var(--w-font-sans)',
                  fontSize: 'var(--w-font-size-sm)',
                  fontWeight: isSelected
                    ? 'var(--w-font-weight-semibold)'
                    : 'var(--w-font-weight-regular)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
                  {opt.providerLabel && (
                    <span
                      style={{
                        fontSize: 'var(--w-font-size-xs)',
                        color: 'var(--w-text-muted)',
                      }}
                    >
                      {opt.providerLabel}
                    </span>
                  )}
                  <span>{opt.label}</span>
                </div>

                <span
                  dir="ltr"
                  style={{
                    fontFamily: 'var(--w-font-mono)',
                    fontSize: 'var(--w-font-size-xs)',
                    color: 'var(--w-text-faint)',
                  }}
                >
                  {opt.id}
                </span>
              </button>
            );
          })}

          {onAddModel && addModelLabel && (
            <div
              style={{
                borderBlockStart: 'var(--w-border-width) solid var(--w-line)',
                paddingBlockStart: 'var(--w-space-1)',
                marginTop: 'var(--w-space-1)',
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                icon={<IconPlus size={16} />}
                onClick={() => {
                  onAddModel();
                  setOpen(false);
                }}
                style={{ width: '100%', justifyContent: 'flex-start' }}
                data-action="models.add"
              >
                {addModelLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

ModelPicker.displayName = 'ModelPicker';
