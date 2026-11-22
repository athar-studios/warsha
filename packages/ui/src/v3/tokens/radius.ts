// Design System v3 — Radius Tokens (DESIGN_SYSTEM_V3.md §2.3)

export const radiusTokens = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  full: '9999px',
} as const;

export type RadiusStep = keyof typeof radiusTokens;
