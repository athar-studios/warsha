// @warsha/ui — colour tokens.
//
// One accent for the whole product: Warsha yellow `#FFD60A` on ink `#0E0E0E`. Every other colour is
// a neutral or a semantic state, so a screen cannot invent a second brand colour by accident.
//
// `colorTokens` is the source of truth for both themes; `tokens.css` mirrors it (and
// `tokenDrift.test.ts` fails the build if the two ever disagree). Components must not read the hex
// values — they read `colorVar('accent')` and let `[data-theme]` pick the light or dark value.

import { cssVar, kebabCase } from './vars';

/** The two themes Warsha ships. Selected with `data-theme` on a container (or `<html>`). */
export type ThemeMode = 'light' | 'dark';

/** The attribute `tokens.css` switches on. */
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * Every colour token, with its light and dark value.
 *
 * Role names, not colour names: `text`/`surface`/`border` describe what the value is for, so a
 * component keeps working when the palette changes.
 */
export const colorTokens = {
  /** Page background. */
  bg: { light: '#fafafa', dark: '#0e0e0e' },
  /** Raised surface: cards, panels, menus. */
  surface: { light: '#ffffff', dark: '#171717' },
  /** Recessed surface: table headers, inactive tiles, input fills. */
  surfaceMuted: { light: '#f3f4f6', dark: '#1f1f1f' },
  /** Primary text. */
  text: { light: '#111827', dark: '#f5f5f5' },
  /** Secondary text: captions, hints, metadata. */
  textMuted: { light: '#6b7280', dark: '#a3a3a3' },
  /** Hairline borders and dividers. */
  border: { light: '#e5e7eb', dark: '#2e2e2e' },
  /** Borders that must be seen: inputs, dashed empty states, focused rings. */
  borderStrong: { light: '#d1d5db', dark: '#404040' },
  /** Warsha accent. Identical in both themes: it is the brand. */
  accent: { light: '#FFD60A', dark: '#FFD60A' },
  /** Text and icons drawn on top of the accent. Always ink, never white. */
  accentInk: { light: '#0e0e0e', dark: '#0e0e0e' },
  /**
   * The accent as *foreground* (links, active labels). The brand yellow is unreadable on a light
   * surface, so light mode uses a dark gold of the same hue and dark mode keeps the brand value.
   */
  accentStrong: { light: '#8a6a00', dark: '#FFD60A' },
  /** Success / passing / approved. */
  success: { light: '#1a7f37', dark: '#3fb950' },
  /** Warning / pending / needs attention. */
  warning: { light: '#b45309', dark: '#d29922' },
  /** Error / failing / blocked. */
  error: { light: '#b42318', dark: '#f85149' },
  /** Disabled text, empty-state glyphs, the quietest readable foreground. */
  muted: { light: '#9ca3af', dark: '#737373' },
} as const;

/** The name of a colour token. */
export type ColorTokenName = keyof typeof colorTokens;

/** Every colour token name, in declaration order. */
export const colorTokenNames = Object.keys(colorTokens) as ColorTokenName[];

/** `--warsha-color-<token>` for each token, without the `var()` wrapper. */
export function colorVarName(name: ColorTokenName): string {
  return `--warsha-color-${kebabCase(name)}`;
}

/** The token as a CSS value: `var(--warsha-color-text)`. This is what a component uses. */
export function colorVar(name: ColorTokenName): string {
  return cssVar(`color-${kebabCase(name)}`);
}

/** The raw value for one theme, for canvas/SVG/storybook code that cannot resolve a `var()`. */
export function colorValue(name: ColorTokenName, theme: ThemeMode): string {
  return colorTokens[name][theme];
}

/** The whole palette for one theme. */
export function colorPalette(theme: ThemeMode): Record<ColorTokenName, string> {
  const palette = {} as Record<ColorTokenName, string>;
  for (const name of colorTokenNames) {
    palette[name] = colorTokens[name][theme];
  }
  return palette;
}
