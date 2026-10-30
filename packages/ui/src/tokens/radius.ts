// @warsha/ui — radius tokens.
//
// `md` is the button radius and `xl` the card radius, so the two most common shapes in the product
// are named here rather than repeated per component.

import { cssVar } from './vars';

/** Every radius the product allows. */
export const radiusTokens = {
  none: '0px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const;

/** The name of a radius token. */
export type RadiusTokenName = keyof typeof radiusTokens;

/** Every radius token name, in declaration order. */
export const radiusTokenNames = Object.keys(radiusTokens) as RadiusTokenName[];

/** `--warsha-radius-<name>`, without the `var()` wrapper. */
export function radiusVarName(name: RadiusTokenName): string {
  return `--warsha-radius-${name}`;
}

/** The token as a CSS value: `var(--warsha-radius-md)`. */
export function radius(name: RadiusTokenName): string {
  return cssVar(`radius-${name}`);
}
