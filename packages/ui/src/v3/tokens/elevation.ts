// Design System v3 — Elevation & Layer Tokens (DESIGN_SYSTEM_V3.md §2.4)

export const shadowTokens = {
  1: '0 1px 3px rgba(0, 0, 0, 0.08)',
  2: '0 4px 12px rgba(0, 0, 0, 0.12)',
  overlay: '0 12px 32px rgba(0, 0, 0, 0.20)',
} as const;

export const layerTokens = {
  base: 0,
  sticky: 10,
  dropdown: 100,
  overlay: 900,
  modal: 1000,
  toast: 1100,
} as const;

export type ShadowStep = keyof typeof shadowTokens;
export type LayerStep = keyof typeof layerTokens;
