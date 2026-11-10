// packages/ui/src/v3/composites/KeyValue.tsx — Design System v3 KeyValue (DS v3 §3.2)
// Label-value pairs with optional copy action.

import React from 'react';

import { IconCheck, IconCopy } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface KeyValueProps {
  label: React.ReactNode;
  value: React.ReactNode;
  copyable?: boolean;
  rawCopyValue?: string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (val: string) => void;
  ltr?: boolean;
  direction?: 'row' | 'column';
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const KeyValue: React.FC<KeyValueProps> = ({
  label,
  value,
  copyable = false,
  rawCopyValue,
  copyLabel,
  copiedLabel,
  onCopy,
  ltr = false,
  direction = 'row',
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    const textToCopy =
      rawCopyValue ?? (typeof value === 'string' ? value : String(value ?? ''));
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).catch(() => {});
    }
    setCopied(true);
    onCopy?.(textToCopy);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const isRow = direction === 'row';

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-key-value w-key-value--${direction} ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: isRow ? 'row' : 'column',
        alignItems: isRow ? 'center' : 'flex-start',
        justifyContent: isRow ? 'space-between' : 'flex-start',
        gap: 'var(--w-space-2)',
        paddingBlock: 'var(--w-space-2)',
        paddingInline: 'var(--w-space-3)',
        fontSize: 'var(--w-font-size-sm)',
        lineHeight: 'var(--w-line-height-sm)',
        fontFamily: 'var(--w-font-sans)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span
        className="w-key-value__label"
        style={{
          color: 'var(--w-text-muted)',
          fontSize: 'var(--w-font-size-xs)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          minWidth: 0,
        }}
      >
        <span
          dir={ltr ? 'ltr' : undefined}
          className="w-key-value__value"
          style={{
            fontWeight: 'var(--w-font-weight-medium)',
            color: 'var(--w-text)',
            fontFamily: ltr ? 'var(--w-font-mono)' : 'inherit',
            wordBreak: 'break-all',
          }}
        >
          {value}
        </span>

        {copyable && copyLabel && (
          <IconButton
            icon={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            label={copied && copiedLabel ? copiedLabel : copyLabel}
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            data-action="keyvalue.copy"
          />
        )}
      </div>
    </div>
  );
};

KeyValue.displayName = 'KeyValue';
