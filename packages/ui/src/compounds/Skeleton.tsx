// @warsha/ui — Skeleton: the bench while it waits for something.
//
// §7's loading rule has two halves, and this component is built to make both unavoidable: the shape is
// allowed to shimmer (only under `prefers-reduced-motion: no-preference`, in `tokens.css`, never here),
// and *the reason is always in the a11y tree* — so `label` is a required prop, rendered visibly as a
// `role="status"` line rather than hidden away. A long load names what is waited for ("جارٍ تحميل
// النتائج" / "loading artifacts") because a bar that says nothing is decoration.
//
// The bars are `aria-hidden`: they are rectangles, and the status line is the announcement.

import React from 'react';

import { aliasVar, colorVar, fontSize, radius, space } from '../tokens';

import { cx, VISUALLY_HIDDEN } from './internal';

export interface SkeletonProps {
  /** What is loading. Mandatory: a skeleton without a name is a shrug. */
  label: React.ReactNode;
  /** How many lines to draw. */
  lines?: number;
  /** `line` reads as text, `block` as a card, `row` as a ledger line. */
  variant?: 'line' | 'block' | 'row';
  /** Hide the visible status line and keep only the announcement. */
  quiet?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const BAR_SIZE = {
  line: space(2),
  block: space(16),
  row: space(8),
} as const;

export function Skeleton({ label, lines = 3, variant = 'line', quiet = false, className = '', style }: SkeletonProps) {
  const bars = Array.from({ length: Math.max(1, lines) }, (_unused, index) => index);

  return (
    <div className={cx('warsha-skeleton-group', className)} style={{ display: 'grid', gap: space(2), ...style }}>
      <div aria-hidden="true" style={{ display: 'grid', gap: space(2) }}>
        {bars.map((index) => (
          <span
            // `.warsha-skeleton` carries the gradient and the loop (§8); this is its shape.
            className="warsha-skeleton"
            // A waiting row is still a row: the last line of any stack is shorter, so the shape reads
            // as content rather than as a grey wall.
            data-warsha-skeleton={variant}
            key={index}
            style={{
              display: 'block',
              blockSize: BAR_SIZE[variant],
              inlineSize: index === bars.length - 1 && bars.length > 1 ? space(24) : '100%',
              borderRadius: radius('sm'),
              backgroundColor: aliasVar('benchPlate'),
            }}
          />
        ))}
      </div>

      <span
        role="status"
        aria-live="polite"
        style={{
          ...(quiet ? VISUALLY_HIDDEN : {}),
          color: colorVar('textMuted'),
          fontSize: fontSize('xs'),
        }}
      >
        {label}
      </span>
    </div>
  );
}
