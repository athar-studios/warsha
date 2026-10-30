// @warsha/ui — typography tokens.
//
// Arabic-first, in both directions. The sans stack leads with IBM Plex Sans Arabic and falls back
// through other Arabic-capable faces before reaching the Latin display face, so Arabic copy never
// renders in a font that has no Arabic glyphs and Latin copy never renders in a fallback tofu box.
// Mono is reserved for code, diffs, logs and step output — never for UI copy (docs/UI.md).
//
// RTL-safe by construction: no token here carries a direction. Arabic must not be letter-spaced
// (it is a connected script), so no tracking token exists to apply by accident; alignment belongs
// to `textAlign: 'start'`/`'end'` at the call site, not to the type scale.

import { cssVar } from './vars';

/** Family tokens. Applied as `font-family: var(--warsha-font-sans)`. */
export const fontFamilies = {
  /** Arabic-first UI face. */
  sans: '"IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", "Inter", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  /** Code, diffs, logs, step output. */
  mono: '"IBM Plex Mono", "Cascadia Code", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
} as const;

/** The name of a family token. */
export type FontFamilyName = keyof typeof fontFamilies;

/** Every family token name, in declaration order. */
export const fontFamilyNames = Object.keys(fontFamilies) as FontFamilyName[];

/** The size scale, in rem so it follows the user's root font size. */
export const fontSizes = {
  xs: '0.75rem',
  sm: '0.875rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
} as const;

/** The name of a size token. */
export type FontSizeName = keyof typeof fontSizes;

/** Every size token name, in declaration order. */
export const fontSizeNames = Object.keys(fontSizes) as FontSizeName[];

/** Unitless line heights: they scale with the size token instead of fighting it. */
export const lineHeights = {
  /** Headings and single-line labels. */
  tight: '1.25',
  /** Dense UI text. */
  snug: '1.35',
  /** Body copy. */
  base: '1.5',
  /** Long-form reading (artifacts, markdown). */
  relaxed: '1.75',
} as const;

/** The name of a line-height token. */
export type LineHeightName = keyof typeof lineHeights;

/** Every line-height token name, in declaration order. */
export const lineHeightNames = Object.keys(lineHeights) as LineHeightName[];

/** Unitless weights, so a variable font picks the right axis. */
export const fontWeights = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** The name of a weight token. */
export type FontWeightName = keyof typeof fontWeights;

/** Every weight token name, in declaration order. */
export const fontWeightNames = Object.keys(fontWeights) as FontWeightName[];

/** `--warsha-font-sans` / `--warsha-font-mono`, without the `var()` wrapper. */
export function fontFamilyVarName(name: FontFamilyName): string {
  return `--warsha-font-${name}`;
}

/** `--warsha-font-size-<name>`, without the `var()` wrapper. */
export function fontSizeVarName(name: FontSizeName): string {
  return `--warsha-font-size-${name}`;
}

/** `--warsha-line-height-<name>`, without the `var()` wrapper. */
export function lineHeightVarName(name: LineHeightName): string {
  return `--warsha-line-height-${name}`;
}

/** `--warsha-font-weight-<name>`, without the `var()` wrapper. */
export function fontWeightVarName(name: FontWeightName): string {
  return `--warsha-font-weight-${name}`;
}

/** `var(--warsha-font-sans)`. */
export function fontFamily(name: FontFamilyName): string {
  return cssVar(`font-${name}`);
}

/** `var(--warsha-font-size-md)`. */
export function fontSize(name: FontSizeName): string {
  return cssVar(`font-size-${name}`);
}

/** `var(--warsha-line-height-base)`. */
export function lineHeight(name: LineHeightName): string {
  return cssVar(`line-height-${name}`);
}

/** `var(--warsha-font-weight-bold)`. */
export function fontWeight(name: FontWeightName): string {
  return cssVar(`font-weight-${name}`);
}
