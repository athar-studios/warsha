// @warsha/ui — Panel: one plate of the bench, with its header rule.
//
// REDESIGN §1.1: panels are plates, not cards. A plate is `surface` (or the recessed `bench-plate`) with
// a hairline fastener and a `md` radius; it gets a shadow only when it is the gate card, the one object
// allowed to interrupt the transcript. `Panel` is therefore the workhorse and `Card` stays dialog-level.
//
// The header is a ruled line the caller fills with its own title and actions, so the component owns the
// geometry (44px line, hairline under it, inline padding on the 4px rhythm) and never the words.

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, radius, size, space } from '../tokens';

import { cx, PROSE, RULE_BORDER } from './internal';

export interface PanelProps {
  children: React.ReactNode;
  /** The header's title. Omit it and the plate has no header line at all. */
  title?: React.ReactNode;
  /** Controls at the header's end: a copy button, a chip, a count. */
  actions?: React.ReactNode;
  /** A recessed plate — rails, instrument beds, the terminal dock. */
  recessed?: boolean;
  /** Constrain the body to the 68ch prose measure (§11). */
  prose?: boolean;
  /** An accessible name for the region, when the visible title is not one the screen wants announced. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Panel({
  children,
  title,
  actions,
  recessed = false,
  prose = false,
  label,
  className = '',
  style,
}: PanelProps) {
  return (
    <section
      aria-label={label}
      className={cx('warsha-panel', className)}
      style={{
        backgroundColor: recessed ? aliasVar('benchPlate') : colorVar('surface'),
        border: RULE_BORDER,
        borderRadius: radius('md'),
        minInlineSize: 0,
        ...style,
      }}
    >
      {title && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space(2),
            minBlockSize: size('touch'),
            paddingInline: space(4),
            borderBlockEnd: RULE_BORDER,
            color: colorVar('text'),
            fontSize: fontSize('sm'),
            fontWeight: fontWeight('semibold'),
          }}
        >
          <span style={{ minInlineSize: 0 }}>{title}</span>
          {actions && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: space(2), marginInlineStart: 'auto' }}>
              {actions}
            </span>
          )}
        </header>
      )}

      <div style={{ padding: space(4), minInlineSize: 0, ...(prose ? PROSE : {}) }}>{children}</div>
    </section>
  );
}
