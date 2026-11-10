// packages/ui/src/v3/composites/CopyField.tsx — Design System v3 CopyField (DS v3 §3.2)
// Field with text and copy button. Gives feedback/toast on copy.

import React from 'react';

import { IconCheck, IconCopy } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface CopyFieldProps {
  value: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (value: string) => void;
  readOnly?: boolean;
  ltr?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const CopyField: React.FC<CopyFieldProps> = ({
  value,
  label,
  copyLabel = '',
  copiedLabel = '',
  onCopy,
  readOnly = true,
  ltr = true,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopied(true);
    onCopy?.(value);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-copy-field ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w-space-1)',
        fontFamily: 'var(--w-font-sans)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 'var(--w-font-size-xs)',
            fontWeight: 'var(--w-font-weight-medium)',
            color: 'var(--w-text-muted)',
          }}
        >
          {label}
        </span>
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
        <input
          type="text"
          value={value}
          readOnly={readOnly}
          dir={ltr ? 'ltr' : undefined}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontFamily: ltr ? 'var(--w-font-mono)' : 'inherit',
            fontSize: 'var(--w-font-size-sm)',
            color: 'var(--w-text)',
            minWidth: 0,
          }}
          data-testid="copy-field-input"
        />

        {copyLabel && (
          <IconButton
            icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            label={copied && copiedLabel ? copiedLabel : copyLabel}
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            data-action="copyfield.copy"
            data-testid="copy-field-btn"
          />
        )}
      </div>
    </div>
  );
};

CopyField.displayName = 'CopyField';
