// @warsha/ui — shadow tokens.
//
// One scale, theme-independent: the `[data-theme]` switch changes colour, not depth, so a card does
// not change its elevation when the owner flips to dark mode. Dark surfaces rely on the surface
// tokens (bg → surface) plus `--warsha-color-border` for the edge, which is why the darkest step
// stays a soft ambient shadow instead of an opaque black block.

import { cssVar } from './vars';

/** Every shadow the product allows. */
export const shadowTokens = {
  none: 'none',
  /** Hairline lift: chips, inline cards. */
  sm: '0 1px 2px rgba(0, 0, 0, 0.06)',
  /** The default card lift. */
  md: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
  /** Popovers, menus, floating panels. */
  lg: '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06)',
  /** Dialogs and modals. */
  xl: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
} as const;

/** The name of a shadow token. */
export type ShadowTokenName = keyof typeof shadowTokens;

/** Every shadow token name, in declaration order. */
export const shadowTokenNames = Object.keys(shadowTokens) as ShadowTokenName[];

/** `--warsha-shadow-<name>`, without the `var()` wrapper. */
export function shadowVarName(name: ShadowTokenName): string {
  return `--warsha-shadow-${name}`;
}

/** The token as a CSS value: `var(--warsha-shadow-md)`. */
export function shadow(name: ShadowTokenName): string {
  return cssVar(`shadow-${name}`);
}
