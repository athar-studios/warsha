// packages/ui/src/v3/composites/QrCode.tsx — Design System v3 QrCode (DS v3 §3.2)
// Pairing QR code. Renders deterministic SVG matrix, displays code, copy gives feedback.

import React from 'react';

import { IconCheck, IconCopy } from '../icons';
import { Button } from '../primitives/Button';

export interface QrCodeProps {
  value: string;
  label?: string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (code: string) => void;
  className?: string;
  style?: React.CSSProperties;
  'data-action'?: string;
  'data-testid'?: string;
}

// Generate a 21x21 deterministic QR-like matrix for pairing codes
function generateQrMatrix(input: string): boolean[][] {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  // Helper: draw finder pattern at (r, c)
  function drawFinder(r: number, c: number) {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        if (
          i === 0 ||
          i === 6 ||
          j === 0 ||
          j === 6 ||
          (i >= 2 && i <= 4 && j >= 2 && j <= 4)
        ) {
          matrix[r + i][c + j] = true;
        }
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(0, 14);
  drawFinder(14, 0);

  // Timing patterns
  for (let i = 8; i < 13; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Hash input string to fill data cells
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Skip finder zones
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= 13;
      const inBottomLeft = r >= 13 && c < 8;
      const inTiming = r === 6 || c === 6;

      if (!inTopLeft && !inTopRight && !inBottomLeft && !inTiming) {
        hash = (hash * 1103515245 + 12345) & 0x7fffffff;
        matrix[r][c] = (hash % 3) === 0;
      }
    }
  }

  return matrix;
}

export const QrCode: React.FC<QrCodeProps> = ({
  value,
  label,
  copyLabel = '',
  copiedLabel = '',
  onCopy,
  className = '',
  style,
  'data-action': dataAction,
  'data-testid': dataTestId,
}) => {
  const [copied, setCopied] = React.useState(false);
  const matrix = React.useMemo(() => generateQrMatrix(value), [value]);

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
      className={`w-qrcode ${className}`.trim()}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--w-space-3)',
        padding: 'var(--w-space-4)',
        borderRadius: 'var(--w-radius-lg)',
        border: 'var(--w-border-width) solid var(--w-line)',
        backgroundColor: 'var(--w-surface)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 'var(--w-font-size-sm)',
            fontWeight: 'var(--w-font-weight-medium)',
            color: 'var(--w-text)',
            textAlign: 'center',
          }}
        >
          {label}
        </span>
      )}

      <div
        style={{
          padding: 'var(--w-space-2)',
          backgroundColor: 'var(--w-surface)',
          borderRadius: 'var(--w-radius-sm)',
          border: 'var(--w-border-width) solid var(--w-line)',
          display: 'inline-flex',
        }}
      >
        <svg
          viewBox="0 0 21 21"
          width="180"
          height="180"
          role="img"
          aria-label={label ?? value}
          style={{ display: 'block' }}
        >
          <rect width="21" height="21" fill="var(--w-surface)" />
          {matrix.map((row, r) =>
            row.map((filled, c) =>
              filled ? (
                <rect
                  key={`${r}-${c}`}
                  x={c}
                  y={r}
                  width="1"
                  height="1"
                  fill="var(--w-text)"
                />
              ) : null
            )
          )}
        </svg>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--w-space-2)',
          width: '100%',
        }}
      >
        <span
          dir="ltr"
          style={{
            fontFamily: 'var(--w-font-mono)',
            fontSize: 'var(--w-font-size-sm)',
            fontWeight: 'var(--w-font-weight-semibold)',
            color: 'var(--w-text-muted)',
            letterSpacing: '0',
          }}
        >
          {value}
        </span>

        {copyLabel && (
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            onClick={handleCopy}
            data-action="qrcode.copy"
            data-testid="qrcode-copy-btn"
          >
            {copied && copiedLabel ? copiedLabel : copyLabel}
          </Button>
        )}
      </div>
    </div>
  );
};

QrCode.displayName = 'QrCode';
