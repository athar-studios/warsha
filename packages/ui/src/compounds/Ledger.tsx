// @warsha/ui — Ledger: the ruled list the bench is built from.
//
// §1.2 says the product's lists are ledgers, not lists: rows on a plate, fastened by a hairline each, no
// card grid. `Ledger` is the container (`<ul role="list">` — the explicit role is not decoration: Safari
// drops the list semantics from a `list-style: none` list, and a screen reader that hears "list, 6 items"
// is one that knows how many gates are waiting). `Ledger.Row` is a line, and a row that takes `onSelect`
// becomes a button so the keyboard reaches it without a second component.
//
// A row's content arrives as children: the direction's ledgers are shaped the same but say different
// things per screen (agents in Simple, lanes in Advanced, providers in settings), so the screen composes a
// `Lamp`, a `Meter` or a `Stamp` inside and the ledger never learns what those words mean. That is also
// why nothing here reads a catalog: `@warsha/ui` stays catalog-free (§6).
//
// One contrast rule, stated once: text on a row is `text`, never `text-muted`. A rail or a settings plate
// is recessed (`#f3f4f6` in light), and `text-muted` there measures 4.4:1 — under AA. §9 demotes `muted`
// and `text-muted` to non-text and raised surfaces, so hierarchy here comes from size and weight.

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, size, space } from '../tokens';

import {
  CONTROL_CLASS,
  cx,
  HOVER_RECESS_CLASS,
  MACHINE_SMALL,
  machineSkin,
  QUIET_EDGE,
  RULE_BORDER,
  SIGNAL_EDGE,
} from './internal';

export interface LedgerProps {
  children: React.ReactNode;
  /** The list's accessible name: "بوّابات بانتظارك" / "gates waiting on you". */
  label: string;
  /** Draw the ledger on a recessed plate instead of the page surface. */
  recessed?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export interface LedgerRowProps {
  children: React.ReactNode;
  /** The row that is the bench's current view. Draws the signal edge and `aria-current`. */
  selected?: boolean;
  /** Present makes the row a button. */
  onSelect?: () => void;
  /** Machine data at the row's end: a cost, a count, a timestamp — tabular, at the face its words allow. */
  meta?: React.ReactNode;
  /** A control that is not part of selecting the row: archive, retry, revoke. */
  actions?: React.ReactNode;
  /** A task-board row: done, running or todo. The glyph says it; the tone only tints it. */
  state?: 'done' | 'running' | 'todo';
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const ROW_STATE_GLYPH: Record<NonNullable<LedgerRowProps['state']>, string> = {
  done: '✓',
  running: '»',
  todo: '☐',
};

function LedgerRow({
  children,
  selected = false,
  onSelect,
  meta,
  actions,
  state,
  disabled = false,
  className = '',
  style,
}: LedgerRowProps) {
  const skin: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: space(3),
    inlineSize: '100%',
    minBlockSize: size('touch'),
    paddingInline: space(4),
    paddingBlock: space(3),
    textAlign: 'start',
    borderInlineStart: selected ? SIGNAL_EDGE : QUIET_EDGE,
    backgroundColor: selected ? colorVar('surface') : 'transparent',
    color: colorVar('text'),
    fontFamily: 'inherit',
    cursor: onSelect ? 'pointer' : 'default',
    flex: '1',
    minInlineSize: 0,
    // §10 at the phone widths: a row that cannot fit its name, its state glyph and its meta on
    // one line puts the meta under the name instead of shrinking the name to nothing.
    flexWrap: 'wrap',
    rowGap: space(1),
  };

  const content = (
    <>
      {state && (
        <span
          aria-hidden="true"
          style={{ ...MACHINE_SMALL, color: colorVar('text'), flex: 'none', fontWeight: fontWeight('bold') }}
        >
          {ROW_STATE_GLYPH[state]}
        </span>
      )}
      {/* `1 1 auto`, not `1`: a basis of 0 leaves the name at the mercy of whatever the nowrap meta
          leaves over, and B4 found project titles sitting in a 0×84 box on a phone. */}
      <span style={{ flex: '1 1 auto', minInlineSize: 0 }}>{children}</span>
      {meta && (
        <span
          style={{
            ...machineSkin(meta),
            fontSize: fontSize('xs'),
            color: colorVar('text'),
            flex: 'none',
          }}
        >
          {meta}
        </span>
      )}
    </>
  );

  return (
    <li
      className={cx('warsha-ledger-row', className)}
      data-selected={selected}
      data-state={state}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBlockEnd: RULE_BORDER,
        listStyle: 'none',
        minInlineSize: 0,
        ...style,
      }}
    >
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          // One source of truth for "this row is the bench's current view": the attribute draws the edge
          // and tells the a11y tree (§6).
          aria-current={selected ? 'true' : undefined}
          className={cx(CONTROL_CLASS, HOVER_RECESS_CLASS)}
          style={skin}
        >
          {content}
        </button>
      ) : (
        <div style={skin}>{content}</div>
      )}

      {/* Actions sit beside the row, never inside its button: a nested control is unreachable, and its
          click would bubble into selecting the row it is meant to leave alone. */}
      {actions && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space(2),
            paddingInlineEnd: space(4),
            flex: 'none',
          }}
        >
          {actions}
        </span>
      )}
    </li>
  );
}

function LedgerRoot({ children, label, recessed = false, className = '', style }: LedgerProps) {
  return (
    <ul
      role="list"
      aria-label={label}
      className={cx('warsha-ledger', className)}
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        borderBlockStart: RULE_BORDER,
        backgroundColor: recessed ? aliasVar('benchPlate') : 'transparent',
        minInlineSize: 0,
        ...style,
      }}
    >
      {children}
    </ul>
  );
}

/**
 * The ledger and its row. Parts are attached rather than exported separately (REDESIGN §6: explicit parts
 * with shared context), so `Ledger.Row` is only ever reachable inside a `Ledger`.
 */
export const Ledger = Object.assign(LedgerRoot, { Row: LedgerRow });
