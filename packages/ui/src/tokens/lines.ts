// @warsha/ui — line tokens: the bench's border shorthands (DS v2 §4.3).
//
// A hairline fastener is the same hairline in twenty components and two apps; writing it twenty times
// from primitives is how a system grows a second border colour. These eight shorthands are the only
// borders the bench draws, composed from the size and alias tokens so the theme still decides every
// colour and the cascade rule (DS v2 §4.1) still holds: each one references themed custom properties,
// so `tokens.css` declares it in *both* theme blocks with identical text.

import { cssVar, kebabCase } from './vars';

/** Every line the bench is allowed to draw, as the value `tokens.css` declares. */
export const lineTokens = {
  /** The hairline fastener between two plates. */
  rule: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
  /** A structural edge: a control's border, a meter's track. */
  edge: 'var(--warsha-size-rule) solid var(--warsha-bench-edge)',
  /** A hairline that must read as failure. */
  fail: 'var(--warsha-size-rule) solid var(--warsha-color-error)',
  /** The mark a selected row or the active tab draws on its start side (AA-safe yellow, §12). */
  signal: 'var(--warsha-size-edge) solid var(--warsha-signal-text)',
  /** The same edge, absent: the width stays, so selecting a row never moves its content. */
  quiet: 'var(--warsha-size-edge) solid transparent',
  /** The gate card's band, unlit. */
  band: 'var(--warsha-size-edge) solid var(--warsha-bench-edge)',
  /** The gate card's band, failed. */
  bandFail: 'var(--warsha-size-edge) solid var(--warsha-color-error)',
  /** The stamp's pressed-metal border. */
  inscribe: 'var(--warsha-size-inscribe) solid currentColor',
} as const;

/** The name of a line token. */
export type LineTokenName = keyof typeof lineTokens;

/** Every line token name, in declaration order. */
export const lineTokenNames = Object.keys(lineTokens) as LineTokenName[];

/** `--warsha-line-rule`, without the `var()` wrapper. */
export function lineVarName(name: LineTokenName): string {
  return `--warsha-line-${kebabCase(name)}`;
}

/** `var(--warsha-line-rule)`. This is what a component uses. */
export function lineVar(name: LineTokenName): string {
  return cssVar(`line-${kebabCase(name)}`);
}