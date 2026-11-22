// Design System v3 — Typography Tokens (DESIGN_SYSTEM_V3.md §2.2, OD-U2 = A)

export const fontFamilies = {
  sans: '"IBM Plex Sans Arabic", "Segoe UI", "Noto Sans Arabic", Tahoma, system-ui, sans-serif',
  mono: '"IBM Plex Mono", Consolas, ui-monospace, monospace',
} as const;

// Sizes are rem (they follow the user's root font size, not the px of a screenshot) and line heights are
// unitless ratios (they inherit as a ratio, so a nested size keeps the same leading). The pixel figures in
// DESIGN_SYSTEM_V3 §2.2 are the 16px-root equivalents of these values.
export const fontSizes = {
  xs: '0.75rem',
  sm: '0.875rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.375rem',
  '2xl': '1.75rem',
  '3xl': '2.25rem',
} as const;

// R-UI-3 D3-a: every body step (xs–lg) is ≥ 1.6 — the §2.2 Arabic rule — and the titles keep their
// §2.2 weights with ratios (xl 1.55 · 2xl 1.5 · 3xl 1.4) that clear a two-line vocalised sample
// (D3-d proves it; the ratio is not a taste call).
export const lineHeights = {
  xs: '1.6',
  sm: '1.65',
  md: '1.6',
  lg: '1.6',
  xl: '1.55',
  '2xl': '1.5',
  '3xl': '1.4',
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const tracking = {
  code: '0.01em',
} as const;

export type FontSizeStep = keyof typeof fontSizes;
export type FontWeightStep = keyof typeof fontWeights;
