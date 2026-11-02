// @warsha/ui — Stamp: the record a gate decision leaves on the bench.
//
// REDESIGN §1.4: an approved or rejected gate is a physical record, not a colour. The stamp is therefore
// text with a pressed-metal border (`2px solid currentColor`) and a slight tilt, and the tilt mirrors
// with the reading direction — that mirroring is one line of CSS keyed on `[dir]`, because a rotation is
// neither a logical property nor something a component should track in a prop.
//
// Two things the component deliberately does not do: it carries no letter-spacing (Arabic is a connected
// script and `typography.ts` refuses to offer a tracking token for it to be applied by accident), and it
// is never the only channel — the glyph and the caller's word say what `ok`/`fail` merely tints.

import React from 'react';

import { aliasVar, colorVar, fontSize, fontWeight, radius, space } from '../tokens';

import { INSCRIBE } from './internal';

export interface StampProps {
  /** The decision in the screen's own words: "موافق عليه" / "approved". */
  children: React.ReactNode;
  tone?: 'ok' | 'fail';
  /** Override the ✓/✗ glyph — a `changes_requested` stamp may want `↻`. */
  glyph?: string;
  className?: string;
  style?: React.CSSProperties;
}

const STAMP_GLYPH = { ok: '✓', fail: '✗' } as const;

export function Stamp({ children, tone = 'ok', glyph, className = '', style }: StampProps) {
  return (
    <span
      // `.warsha-stamp` is the tilt (`tokens.css`); the skin below is everything a token can name.
      className={`warsha-stamp${className ? ` ${className}` : ''}`}
      data-tone={tone}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(1),
        border: INSCRIBE,
        borderRadius: radius('sm'),
        paddingInline: space(2),
        paddingBlock: space(1),
        color: aliasVar(tone === 'ok' ? 'lampOk' : 'lampFail'),
        fontSize: fontSize('xs'),
        fontWeight: fontWeight('bold'),
        ...style,
      }}
    >
      <span aria-hidden="true">{glyph ?? STAMP_GLYPH[tone]}</span>
      <span style={{ color: colorVar('text') }}>{children}</span>
    </span>
  );
}
