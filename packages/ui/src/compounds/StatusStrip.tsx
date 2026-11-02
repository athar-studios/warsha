// @warsha/ui — StatusStrip: the instrument panel under the topbar.
//
// §4: 36px, recessed, and it carries only what an owner glances at — the daemon lamp, the run id, the
// stage, the active counts, the budget. `StatusStrip.Item` is one of those readings, and an item may
// declare `hideNarrow`: below 768px the bench keeps the daemon and the budget and lets the rest go (§10's
// progressive disclosure). That disclosure is a `@media` rule in `tokens.css` keyed on the attribute this
// part sets, because a viewport is not a prop — the same reason the focus ring and the touch floor live
// in the stylesheet and nowhere else.
//
// The strip is a live region (`role="status"`, polite): it reports state, it does not interrupt. Two
// details that come from the direction rather than from habit: the mono run id carries `translate="no"` so
// no translation service mangles `prj_9f3a` inside an Arabic sentence (§11), and the strip's overflow is
// the inline axis, so a long reading scrolls inside the strip instead of widening the page (§10's
// overflow gate).

import React from 'react';

import { aliasVar, colorVar, fontFamily, fontSize, size, space } from '../tokens';

import { cx } from './internal';

export interface StatusStripProps {
  children: React.ReactNode;
  /** The region's accessible name: "شريط الحالة" / "status". */
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface StatusStripItemProps {
  children: React.ReactNode;
  /** Drop this reading below 768px. The daemon lamp and the budget meter never set it. */
  hideNarrow?: boolean;
  /** Machine data — an id, a cost, a count — is mono with tabular numerals (§11). */
  machine?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function StatusStripItem({
  children,
  hideNarrow = false,
  machine = false,
  className = '',
  style,
}: StatusStripItemProps) {
  return (
    // `.warsha-statusstrip-item` is `display: inline-flex` + the 4px gap: the item's own alignment is a
    // layout fact the stylesheet may state, while its *presence* is decided here.
    <span
      className={cx('warsha-statusstrip-item', className)}
      data-machine={machine || undefined}
      data-warsha-hide-narrow={hideNarrow ? 'true' : undefined}
      style={{
        color: colorVar('text'),
        fontFamily: machine ? fontFamily('mono') : undefined,
        fontVariantNumeric: machine ? 'tabular-nums' : undefined,
        minInlineSize: 0,
        flex: 'none',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function StatusStripRoot({ children, label, className = '', style }: StatusStripProps) {
  return (
    <div
      role="status"
      aria-label={label}
      // A scrollable region the keyboard cannot reach is an AA failure, not a design choice
      // (`scrollable-region-focusable`, found by axe at 320 on the phone). §10 chose the inline scroller
      // for the strip, so the strip is the thing that has to answer for it: one tab stop, and the owner
      // can read the rest of the bench without a mouse.
      tabIndex={0}
      className={cx('warsha-statusstrip', className)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space(3),
        paddingInline: space(3),
        blockSize: size('strip'),
        backgroundColor: aliasVar('benchPlate'),
        color: colorVar('text'),
        fontSize: fontSize('xs'),
        // The inline axis, so the strip scrolls inside itself rather than widening the page (§10).
        overflowX: 'auto',
        minInlineSize: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The instrument strip and its readings. `StatusStrip.Item` is only reachable inside a strip. */
export const StatusStrip = Object.assign(StatusStripRoot, { Item: StatusStripItem });
