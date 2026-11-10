// packages/ui/src/v3/composites/CodeView.tsx — Design System v3 CodeView (DS v3 §3.2)
// Read-only code viewer. Mono font, LTR direction, line numbers, copy action.

import React from 'react';

import { IconCheck, IconCopy } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface CodeViewProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (code: string) => void;
  maxHeight?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export const CodeView: React.FC<CodeViewProps> = ({
  code,
  language,
  filename,
  showLineNumbers = true,
  copyLabel = '',
  copiedLabel = '',
  onCopy,
  maxHeight,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [copied, setCopied] = React.useState(false);

  const lines = React.useMemo(() => code.split(/\r?\n/), [code]);

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopied(true);
    onCopy?.(code);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-code-view ${className}`.trim()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--w-radius-md)',
        border: 'var(--w-border-width) solid var(--w-line)',
        backgroundColor: 'var(--w-sunken)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {(filename || language || copyLabel) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBlock: 'var(--w-space-2)',
            paddingInline: 'var(--w-space-4)',
            backgroundColor: 'var(--w-surface)',
            borderBlockEnd: 'var(--w-border-width) solid var(--w-line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w-space-2)' }}>
            {filename && (
              <span
                dir="ltr"
                style={{
                  fontFamily: 'var(--w-font-mono)',
                  fontSize: 'var(--w-font-size-xs)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  color: 'var(--w-text)',
                }}
              >
                {filename}
              </span>
            )}
            {language && (
              <span
                style={{
                  fontSize: 'var(--w-font-size-xs)',
                  color: 'var(--w-text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                {language}
              </span>
            )}
          </div>

          {copyLabel && (
            <IconButton
              icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              label={copied && copiedLabel ? copiedLabel : copyLabel}
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              data-action="codeview.copy"
              data-testid="code-view-copy-btn"
            />
          )}
        </div>
      )}

      <div
        dir="ltr"
        style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight,
          paddingBlock: 'var(--w-space-3)',
          paddingInline: 'var(--w-space-4)',
          fontFamily: 'var(--w-font-mono)',
          fontSize: 'var(--w-font-size-sm)',
          lineHeight: 'var(--w-line-height-sm)',
          color: 'var(--w-text)',
        }}
      >
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
          }}
        >
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} style={{ lineHeight: 'var(--w-line-height-sm)' }}>
                {showLineNumbers && (
                  <td
                    aria-hidden="true"
                    style={{
                      userSelect: 'none',
                      color: 'var(--w-text-faint)',
                      textAlign: 'end',
                      paddingInlineEnd: 'var(--w-space-3)',
                      width: 'var(--w-space-8)',
                      verticalAlign: 'top',
                    }}
                  >
                    {idx + 1}
                  </td>
                )}
                <td
                  style={{
                    whiteSpace: 'pre',
                    verticalAlign: 'top',
                  }}
                >
                  {line || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

CodeView.displayName = 'CodeView';
