// Design System v3 — Typography Tokens (DESIGN_SYSTEM_V3.md §2.2, OD-U2 = C)

export const fontFamilies = {
  sans: '"IBM Plex Sans Arabic", "Segoe UI", "Noto Sans Arabic", Tahoma, system-ui, sans-serif',
  mono: '"IBM Plex Mono", Consolas, ui-monospace, monospace',
} as const;

export const fontSizes = {
  xs: '12px',
  sm: '14px',
  md: '16px',
  lg: '18px',
  xl: '22px',
  '2xl': '28px',
  '3xl': '36px',
} as const;

export const lineHeights = {
  xs: '18px',
  sm: '22px',
  md: '26px',
  lg: '28px',
  xl: '32px',
  '2xl': '40px',
  '3xl': '48px',
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
