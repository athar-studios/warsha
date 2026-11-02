// @warsha/ui — DiffView: the change set, proved rather than coloured.
//
// §6's rule for a diff is that the gutter glyph and the tone carry it together: an added line says `+`, a
// removed line says `−`, and the wash under an added line (`--warsha-diff-add-bg`, one alias, so no
// component invents green) is only the second channel. A reviewer with no colour vision, a reviewer on a
// black-and-white print and a reviewer reading the raw text all get the same answer.
//
// The container scrolls on the inline axis and never lets the page scroll (§10's overflow gate) — which is
// why it is a named region with `tabIndex`: a horizontally scrollable area a keyboard user cannot reach is
// content that does not exist for them. Code is LTR by nature, so every line is isolated with `dir="ltr"`
// and `translate="no"` inside an Arabic bench (§11: embedded LTR fragments never sit bare in a sentence).

import React from 'react';

import { aliasVar, colorVar, fontFamily, fontSize, fontWeight, radius, size, space } from '../tokens';

import { cx, MACHINE, RULE_BORDER } from './internal';

/** What a diff line is. `meta` is the `@@ hunk @@` header; `context` is unchanged code. */
export type DiffLineKind = 'add' | 'del' | 'context' | 'meta';

export interface DiffViewProps {
  children: React.ReactNode;
  /** The region's accessible name — usually the file: "الفرق في src/auth.ts" / "diff in src/auth.ts". */
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface DiffLineProps {
  children: React.ReactNode;
  kind?: DiffLineKind;
  /** The old line number, when the screen has one. Machine data, mono, never the only marker. */
  oldNumber?: number;
  /** The new line number, when the screen has one. */
  newNumber?: number;
  className?: string;
}

const GUTTER_GLYPH: Record<DiffLineKind, string> = {
  add: '+',
  del: '−',
  context: ' ',
  meta: '@',
};

/** The tone a line's gutter takes. `context` and `meta` stay quiet: only change is loud. */
function gutterColor(kind: DiffLineKind): string {
  switch (kind) {
    case 'add':
      return colorVar('success');
    case 'del':
      return colorVar('error');
    default:
      return colorVar('textMuted');
  }
}

function DiffLine({ children, kind = 'context', oldNumber, newNumber, className = '' }: DiffLineProps) {
  return (
    <div
      dir="ltr"
      translate="no"
      className={cx('warsha-diff-line', className)}
      data-kind={kind}
      style={{
        display: 'grid',
        // `[old][new][gutter][code]` — the numbers are a column each so two hunks compare, and the gutter
        // is the colour-free channel that says what the wash merely hints at.
        gridTemplateColumns: `${space(8)} ${space(8)} ${size('diffGutter')} minmax(0, 1fr)`,
        whiteSpace: 'pre',
        fontFamily: fontFamily('mono'),
        fontSize: fontSize('xs'),
        color: colorVar('text'),
        backgroundColor: kind === 'add' ? aliasVar('diffAddBg') : 'transparent',
      }}
    >
      <span style={{ ...NUMBER_CELL }}>{oldNumber ?? ''}</span>
      <span style={{ ...NUMBER_CELL }}>{newNumber ?? ''}</span>
      <span
        aria-hidden="true"
        style={{
          textAlign: 'center',
          color: gutterColor(kind),
          fontWeight: fontWeight('bold'),
          backgroundColor: aliasVar('benchPlate'),
          borderInlineEnd: RULE_BORDER,
          userSelect: 'none',
        }}
      >
        {GUTTER_GLYPH[kind]}
      </span>
      <span style={{ paddingInlineStart: space(2), minInlineSize: 0 }}>{children}</span>
    </div>
  );
}

const NUMBER_CELL: React.CSSProperties = {
  ...MACHINE,
  fontSize: fontSize('xs'),
  color: colorVar('textMuted'),
  textAlign: 'end',
  paddingInlineEnd: space(1),
  userSelect: 'none',
};

function DiffViewRoot({ children, label, className = '', style }: DiffViewProps) {
  return (
    <div
      role="region"
      aria-label={label}
      // A scroll region a keyboard cannot enter is a region whose content does not exist.
      tabIndex={0}
      className={cx('warsha-diff', className)}
      style={{
        border: RULE_BORDER,
        borderRadius: radius('sm'),
        backgroundColor: colorVar('surface'),
        overflowX: 'auto',
        minInlineSize: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The diff and its lines: `DiffView.Line` is only reachable inside a `DiffView`. */
export const DiffView = Object.assign(DiffViewRoot, { Line: DiffLine });
