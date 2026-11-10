// packages/ui/src/v3/composites/Transcript.tsx — Design System v3 Transcript (DS v3 §3.2)
// Terminal transcript viewer. Mono font, LTR direction, line numbers, copy action.

import React from 'react';

import { IconCheck, IconCopy, IconTerminal } from '../icons';
import { IconButton } from '../primitives/IconButton';

export interface TranscriptLine {
  id?: string;
  content: string;
  timestamp?: string;
  stream?: 'stdout' | 'stderr' | 'system';
}

export interface TranscriptProps {
  lines?: TranscriptLine[];
  text?: string;
  title?: string;
  showLineNumbers?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (text: string) => void;
  maxHeight?: string;
  autoScroll?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

const STREAM_COLORS: Record<'stdout' | 'stderr' | 'system', string> = {
  stdout: 'var(--w-text)',
  stderr: 'var(--w-danger)',
  system: 'var(--w-primary-text)',
};

export const Transcript: React.FC<TranscriptProps> = ({
  lines,
  text,
  title,
  showLineNumbers = true,
  copyLabel = '',
  copiedLabel = '',
  onCopy,
  maxHeight = 'var(--w-rail-width)',
  autoScroll = false,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [copied, setCopied] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const parsedLines = React.useMemo<TranscriptLine[]>(() => {
    if (lines) return lines;
    if (text) {
      return text.split(/\r?\n/).map((content, idx) => ({
        id: String(idx),
        content,
        stream: 'stdout',
      }));
    }
    return [];
  }, [lines, text]);

  const rawText = React.useMemo(() => {
    if (text) return text;
    return (lines ?? []).map((l) => l.content).join('\n');
  }, [lines, text]);

  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [parsedLines, autoScroll]);

  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(rawText).catch(() => {});
    }
    setCopied(true);
    onCopy?.(rawText);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      data-action={dataAction}
      data-testid={dataTestId}
      className={`w-transcript ${className}`.trim()}
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
      {(title || copyLabel) && (
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
            <IconTerminal size={16} aria-hidden="true" />
            {title && (
              <span
                style={{
                  fontSize: 'var(--w-font-size-xs)',
                  fontWeight: 'var(--w-font-weight-semibold)',
                  color: 'var(--w-text)',
                }}
              >
                {title}
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
              data-action="transcript.copy"
              data-testid="transcript-copy-btn"
            />
          )}
        </div>
      )}

      <div
        ref={scrollRef}
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
              const stream = line.stream ?? 'stdout';
              const color = STREAM_COLORS[stream];

              return (
                <tr key={line.id ?? idx} style={{ lineHeight: 'var(--w-line-height-sm)' }}>
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
                  {line.timestamp && (
                    <td
                      style={{
                        userSelect: 'none',
                        color: 'var(--w-text-faint)',
                        paddingInlineEnd: 'var(--w-space-2)',
                        verticalAlign: 'top',
                      }}
                    >
                      [{line.timestamp}]
                    </td>
                  )}
                  <td
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      color,
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

Transcript.displayName = 'Transcript';
