// @warsha/ui — RailRow: one ruled row of the start rail — an agent, a lane, a project, a provider.
//
// REDESIGN §1.2: ledgers, not lists. One row, one lamp, one name, one state word. The row *is* a button,
// so Tab reaches it, Enter and Space select it, and the touch floor is the row's own 44px rather than a
// wrapper's promise. The selected row gets the signal edge on its inline-start side, drawn with
// `border-inline-start` (§11: logical only, so Arabic mirrors it without a code path) — and an unselected
// row keeps a transparent edge of the same width, so selecting never moves the name.
//
// Text hierarchy is contrast and size, never a colour tint on a plate: the meta line here is `text`, not
// `text-muted`, because the rail sits on the recessed plate where muted is 4.4:1 and fails AA (§9 demotes
// `muted` to non-text use, and this is text).

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, size, space } from '../tokens';

import {
  CONTROL_CLASS,
  cx,
  HOVER_PLATE_CLASS,
  machineSkinSmall,
  QUIET_EDGE,
  RAIL_HEAD,
  RULE_BORDER,
  SIGNAL_EDGE,
} from './internal';

export interface RailRowProps {
  /** The row's name: an agent, a lane, a project. */
  children: React.ReactNode;
  /** One word under the name — "المنسّق" / "orchestrator". Simple mode's plain-language role. */
  sublabel?: React.ReactNode;
  /** The right-hand column: a cost, a count, a timestamp. Machine data, so it renders mono. */
  meta?: React.ReactNode;
  /** A `Lamp` node, or anything else the row leads with. */
  leading?: React.ReactNode;
  selected?: boolean;
  /** Present makes the row a button; absent leaves it a ruled line. */
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function RailRow({
  children,
  sublabel,
  meta,
  leading,
  selected = false,
  onSelect,
  disabled = false,
  className = '',
  style,
}: RailRowProps) {
  const body = (
    <>
      {leading}
      {/* B4 §10: the name is the row's own content, so its flex basis is *auto*, not 0. With `flex: 1`
          the label could be starved to zero width by a nowrap meta beside it — a project name drawn in
          a box 0px wide is text nobody can read, and the clip/box audits failed on it. A row that does
          not fit now wraps its meta to a second line (§10: "ledger rows collapse to two lines"). */}
      <span style={{ flex: '1 1 auto', minInlineSize: 0 }}>
        <span style={{ color: colorVar('text'), fontSize: fontSize('sm'), fontWeight: fontWeight('medium') }}>
          {children}
        </span>
        {sublabel && (
          <span style={{ display: 'block', color: colorVar('text'), fontSize: fontSize('xs') }}>
            {sublabel}
          </span>
        )}
      </span>
      {meta && (
        <span style={{ ...machineSkinSmall(meta), color: colorVar('text'), flex: 'none', whiteSpace: 'nowrap' }}>
          {meta}
        </span>
      )}
    </>
  );

  const skin: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: space(3),
    inlineSize: '100%',
    minBlockSize: size('touch'),
    paddingInline: space(4),
    paddingBlock: space(2),
    textAlign: 'start',
    borderBlockStart: RULE_BORDER,
    borderInlineStart: selected ? SIGNAL_EDGE : QUIET_EDGE,
    borderInlineEnd: 'none',
    borderBlockEnd: 'none',
    backgroundColor: selected ? colorVar('surface') : 'transparent',
    color: colorVar('text'),
    cursor: onSelect ? 'pointer' : 'default',
    fontFamily: 'inherit',
    minInlineSize: 0,
    ...style,
  };

  if (!onSelect) {
    return (
      <div className={cx('warsha-rail-row', className)} data-selected={selected} style={skin}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      // `aria-current` is what both says "this row is the one the bench is showing" and draws the edge:
      // the direction wants one source of truth for a selected ledger row (§6).
      aria-current={selected ? 'true' : undefined}
      className={cx('warsha-rail-row', CONTROL_CLASS, HOVER_PLATE_CLASS, className)}
      data-selected={selected}
      style={skin}
    >
      {body}
    </button>
  );
}

/** The small label above a rail ledger: "الفريق" / "Team". Section heads, not controls. */
export function RailHead({ children }: { children: React.ReactNode }) {
  return (
    <span
      // The head is `RAIL_HEAD` itself: the §11 rule that a rail head carries no tracking lives in one
      // object, so a future tweak cannot miss this call site.
      style={{ display: 'block', ...RAIL_HEAD }}
    >
      {children}
    </span>
  );
}

/** A rail: the recessed plate the ledger of rows sits on (§4's start rail). */
export function Rail({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <nav
      aria-label={label}
      className="warsha-rail"
      style={{
        backgroundColor: aliasVar('benchPlate'),
        borderInlineEnd: RULE_BORDER,
        paddingBlock: space(3),
        minInlineSize: 0,
      }}
    >
      {children}
    </nav>
  );
}
