// @warsha/ui — bench sizes.
//
// The spacing scale (`./spacing.ts`) is a rhythm: 4px steps for padding, gaps and margins. This file
// is the other kind of length — the *physical* numbers the Bench & Signal direction names: a hairline
// fastener, a touch target, a rail, a prose measure. They are not rhythm, they are facts, and R6 says
// a fact a component needs must be a token (`tokenDrift.test.ts` fails a `px` literal in a component).
//
// Two of these are accessibility floors, not taste:
//
//   * `touch` (44px) — WCAG 2.1 AA target size, required by REDESIGN §9 for every interactive element;
//   * `inscribe` (2px) — the focus ring's width, and the stamp's pressed-metal border.
//
// `tokens.css` declares the same names in `:root`; the dark theme does not re-declare them (a rule is
// 1px on both plates), and `tokenDrift.test.ts` checks the light block against this file.

import { cssVar, kebabCase } from './vars';

/** Every size the bench is allowed to use, as the value `tokens.css` declares. */
export const sizeTokens = {
  /** Hairline fastener between plates: the bench's only border width. */
  rule: '1px',
  /** The signal edge on a selected row, the active tab underline, a banner's accent bar. */
  edge: '3px',
  /** Inscribed lines: the focus ring and the stamp's border. */
  inscribe: '2px',
  /** The touch minimum for an interactive element (WCAG 2.1 AA, REDESIGN §9). */
  touch: '44px',
  /** The floor a compact control may keep on a fine pointer, before `pointer: coarse` raises it. */
  touchCompact: '32px',
  /** A non-interactive meta chip's height. */
  chip: '24px',
  /** The gate bell's count badge. */
  badge: '20px',
  /** A state lamp's dot. */
  lamp: '10px',
  /** A thinking-dot's dot. */
  lampSmall: '6px',
  /** The hex nut in the topbar. */
  nut: '22px',
  /** The ghost nut in an empty state. */
  mark: '48px',
  /** A speaker's plate in the transcript. */
  avatar: '36px',
  /** The topbar. */
  topbar: '56px',
  /** The instrument strip. */
  strip: '36px',
  /** The start rail at the full bench. */
  rail: '264px',
  /** The start rail at 768px. */
  railCompact: '224px',
  /** The Simple-mode end panel. */
  panel: '300px',
  /** A diff line's gutter column: wide enough for `+`/`−` and never clipped. */
  diffGutter: '24px',
  /** A stream line's timestamp column (mono, tabular numerals, `HH:MM:SS.mmm`). */
  streamTime: '76px',
  /** Where the composer's textarea stops growing; beyond this the bench scrolls, not the page. */
  composerMax: '132px',
  /** The prose measure: REDESIGN §11 caps reading text at 68 characters. */
  measure: '68ch',
} as const;

/** The name of a size token. */
export type SizeTokenName = keyof typeof sizeTokens;

/** Every size token name, in declaration order. */
export const sizeTokenNames = Object.keys(sizeTokens) as SizeTokenName[];

/** `--warsha-size-touch`, without the `var()` wrapper. */
export function sizeVarName(name: SizeTokenName): string {
  return `--warsha-size-${kebabCase(name)}`;
}

/** `var(--warsha-size-touch)`. This is what a component uses. */
export function size(name: SizeTokenName): string {
  return cssVar(`size-${kebabCase(name)}`);
}
