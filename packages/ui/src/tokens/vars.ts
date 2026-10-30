// @warsha/ui — the one way to name a design token.
//
// Every token is a CSS custom property under a single prefix, so a component never writes a
// literal: it writes `cssVar('color-accent')`, which renders as `var(--warsha-color-accent)` and
// resolves to the light or dark value from `tokens.css` depending on `[data-theme]`.
//
// The `--warsha-` prefix is deliberately globally unique. Tokens are applied by importing
// `@warsha/ui/tokens/tokens.css` once, and a name that cannot collide is what makes that safe.

/** The prefix every Warsha custom property carries. */
export const TOKEN_PREFIX = '--warsha';

/** `cssVar('color-accent')` → `var(--warsha-color-accent)`. */
export function cssVar(name: string): string {
  return `var(${TOKEN_PREFIX}-${name})`;
}

/** camelCase token key → kebab-case CSS segment (`surfaceMuted` → `surface-muted`). */
export function kebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
