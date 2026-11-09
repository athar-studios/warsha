// Design System v3 — Motion Tokens (DESIGN_SYSTEM_V3.md §2.4)

export const motionTokens = {
  durFast: '120ms',
  dur: '200ms',
  durSlow: '320ms',
  ease: 'cubic-bezier(.2, .8, .2, 1)',
} as const;

export type MotionStep = keyof typeof motionTokens;
