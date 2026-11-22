// packages/ui/src/v3/composites/DiffView.tsx — Design System v3 DiffView (DS v3 §3.2)
// Read-only diff viewer. Mono font, LTR direction, line numbers, copy action.

import React from 'react';

import { IconCheck, IconCopy } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffViewProps {
  diff?: string;
  lines?: DiffLine[];
  filename?: string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (diffText: string) => void;
  maxHeight?: string;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

export function parseUnifiedDiff(diffText: string): DiffLine[] {
  const rawLines = diffText.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'context', content: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({
        type: 'add',
        content: line.slice(1),
        newLineNumber: newLine++,
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({
        type: 'delete',
        content: line.slice(1),
        oldLineNumber: oldLine++,
      });
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      result.push({
        type: 'context',
        content,
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      });
    }
  }

  return result;
}

const LINE_STYLES: Record<
  DiffLine['type'],
  { bg: string; color: string; sign: string }
> = {
  add: {
    bg: 'var(--w-success-soft)',
    color: 'var(--w-success)',
    sign: '+',
  },
  delete: {
    bg: 'var(--w-danger-soft)',
    color: 'var(--w-danger)',
    sign: '-',
  },
  context: {
    bg: 'transparent',
    color: 'var(--w-text)',
    sign: ' ',
  },
};

export const DiffView: React.FC<DiffViewProps> = ({
  diff,
  lines,
  filename,
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

  const parsedLines = React.useMemo(() => {
    if (lines) return lines;
    if (diff) return parseUnifiedDiff(diff);
    return [];
  }, [diff, lines]);

  const rawDiffText = React.useMemo(() => {
    if (diff) return diff;
    return (lines ?? [])
      .map(
        (l) => `${l.type === 'add' ? '+' : l.type === 'delete' ? '-' : ' '}${l.content}`
      )
      .join('\n');
  }, [diff, lines]);

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(rawDiffText).catch(() => {});
    }
    setCopied(true);
    onCopy?.(rawDiffText);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-diff-view ${className}`.trim()}
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
      {(filename || copyLabel) && (
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

          {copyLabel && (
            <IconButton
              icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              label={copied && copiedLabel ? copiedLabel : copyLabel}
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              data-action="diffview.copy"
              data-testid="diff-view-copy-btn"
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
          paddingBlock: 'var(--w-space-2)',
          fontFamily: 'var(--w-font-mono)',
          fontSize: 'var(--w-font-size-sm)',
          lineHeight: 'var(--w-line-height-sm)',
        }}
      >
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
          }}
        >
          <tbody>
            {parsedLines.map((line, idx) => {
              const conf = LINE_STYLES[line.type];
              return (
                <tr
                  key={idx}
                  style={{
                    backgroundColor: conf.bg,
                    lineHeight: 'var(--w-line-height-sm)',
                  }}
                >
                  <td
                    aria-hidden="true"
                    style={{
                      userSelect: 'none',
                      color: 'var(--w-text-faint)',
                      textAlign: 'end',
                      paddingInline: 'var(--w-space-2)',
                      width: 'var(--w-space-6)',
                      verticalAlign: 'top',
                    }}
                  >
                    {line.oldLineNumber ?? ''}
                  </td>
                  <td
                    aria-hidden="true"
                    style={{
                      userSelect: 'none',
                      color: 'var(--w-text-faint)',
                      textAlign: 'end',
                      paddingInline: 'var(--w-space-2)',
                      width: 'var(--w-space-6)',
                      verticalAlign: 'top',
                    }}
                  >
                    {line.newLineNumber ?? ''}
                  </td>
                  <td
                    aria-hidden="true"
                    style={{
                      userSelect: 'none',
                      color: conf.color,
                      textAlign: 'center',
                      width: 'var(--w-space-4)',
                      fontWeight: 'var(--w-font-weight-bold)',
                      verticalAlign: 'top',
                    }}
                  >
                    {conf.sign}
                  </td>
                  <td
                    style={{
                      paddingInlineEnd: 'var(--w-space-3)',
                      color: conf.color,
                      whiteSpace: 'pre',
                      verticalAlign: 'top',
                      width: '100%',
                    }}
                  >
                    {line.content || ' '}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

DiffView.displayName = 'DiffView';
