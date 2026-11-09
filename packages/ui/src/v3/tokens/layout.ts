// Design System v3 — Layout & Density Tokens (DESIGN_SYSTEM_V3.md §2.3)

export const contentWidths = {
  narrow: '720px',
  normal: '1120px',
  wide: '1440px',
  nav: '264px',
  rail: '300px',
} as const;

export const controlHeights = {
  comfortable: '44px',
  compact: '32px',
} as const;

export const breakpoints = {
  sm: 640,
  md: 960,
  lg: 1280,
  xl: 1600,
} as const;

export type ContentWidthStep = keyof typeof contentWidths;
export type Density = 'comfortable' | 'compact';
export type BreakpointStep = keyof typeof breakpoints;
