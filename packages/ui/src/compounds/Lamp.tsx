// @warsha/ui — Lamp: the state of a lane, an agent or the daemon, as the bench reads it.
//
// The direction's one rule about colour (REDESIGN §1): a lit lamp means "this needs the owner's hand",
// and nothing else is allowed to mean that. So the lamp is a *name* (`state`) that resolves to an alias
// (`--warsha-lamp-waiting`) and the alias resolves to the colour the theme picked. A component cannot
// light a lamp by choosing yellow; it can only say the state is waiting.
//
// The dot is never the only channel (WCAG 1.4.1, REDESIGN §9): the mandatory text child is the state
// word the screen passed in, and the mono glyph beside it is a second, colour-free channel. `working`
// breathes — and only because `tokens.css` gates that animation on `prefers-reduced-motion:
// no-preference` (§8); the component itself has no motion logic, no duration of its own and no media
// query.

import React from 'react';

import { aliasVar, colorVar, fontFamily, fontSize, fontWeight, radius, size, space } from '../tokens';
import type { AliasTokenName } from '../tokens';

/** The states a lamp knows. `waiting` is the lit one: the owner's queue. */
export type LampState = 'idle' | 'working' | 'waiting' | 'ok' | 'fail';

/** Every state, in the order the bench lists them. */
export const LAMP_STATES: readonly LampState[] = ['idle', 'working', 'waiting', 'ok', 'fail'];

/**
 * The colour-free channel beside the dot (§9: lamp + word + glyph). These are punctuation, not copy, so
 * they need no catalog and read the same in Arabic and English.
 */
const LAMP_GLYPH: Record<LampState, string> = {
  idle: '·',
  working: '»',
  waiting: '!',
  ok: '✓',
  fail: '✗',
};

/** The alias each state lights. */
const LAMP_ALIAS: Record<LampState, AliasTokenName> = {
  idle: 'lampIdle',
  working: 'lampWorking',
  waiting: 'lampWaiting',
  ok: 'lampOk',
  fail: 'lampFail',
};

export interface LampProps {
  /** The state word — "قيد الانتظار" / "waiting on you". Required: a dot alone is not accessible. */
  children: React.ReactNode;
  state?: LampState;
  /** The label's step: `xs` in an instrument strip, `sm` in a rail row. */
  size?: 'xs' | 'sm';
  /** Override the colour-free glyph (a screen may want `☑` for a gated lane). */
  glyph?: string;
  /** Drop the glyph and rely on the dot plus the word. */
  bare?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Lamp({
  children,
  state = 'idle',
  size: textSize = 'sm',
  glyph,
  bare = false,
  className = '',
  style,
}: LampProps) {
  const dot = (
    <span
      aria-hidden="true"
      className={state === 'working' ? 'warsha-lamp-working' : undefined}
      data-warsha-lamp={state}
      style={{
        inlineSize: size('lamp'),
        blockSize: size('lamp'),
        borderRadius: radius('full'),
        flex: 'none',
        backgroundColor: aliasVar(LAMP_ALIAS[state]),
      }}
    />
  );

  return (
    <span
      className={`warsha-lamp${className ? ` ${className}` : ''}`}
      data-state={state}
      // The dot and the glyph are hidden from assistive technology; the word is the name. A screen
      // reader hears "waiting on you", not "ten pixel circle, exclamation mark, waiting on you".
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: space(2),
        color: colorVar('text'),
        fontSize: fontSize(textSize),
        minInlineSize: 0,
        ...style,
      }}
    >
      {dot}
      {!bare && (
        <span
          aria-hidden="true"
          style={{
            fontFamily: fontFamily('mono'),
            fontWeight: fontWeight('bold'),
            color: colorVar('textMuted'),
          }}
        >
          {glyph ?? LAMP_GLYPH[state]}
        </span>
      )}
      <span style={{ minInlineSize: 0 }}>{children}</span>
    </span>
  );
}
