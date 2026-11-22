// Design System v3 — Spacing Tokens (DESIGN_SYSTEM_V3.md §2.3)
// 4-based scale

export const spaceTokens = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '32px',
  8: '40px',
  9: '48px',
  10: '64px',
} as const;

export type SpaceStep = keyof typeof spaceTokens;
