// @warsha/ui — spacing tokens.
//
// One 4px base unit. A token name is the *step*, not the pixel value: `--warsha-space-4` is the
// fourth step of the scale (16px), the same convention as Tailwind's `p-4`, so a designer reading a
// spec and an engineer reading a component mean the same number.
//
// Physical margins and paddings do not exist here. Everything that consumes a spacing token writes
// it to a *logical* property (`paddingInline`, `marginBlock`, `insetInlineStart`), which is what
// makes the same component correct in Arabic (RTL) and English (LTR) — AGENTS.md, M8.

import { cssVar } from './vars';

/** The base unit every spacing token is a multiple of. */
export const SPACING_BASE_PX = 4;

/** The steps the scale is built from. A value outside this set is not a spacing token. */
export const SPACING_STEPS = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;

/** A legal spacing step. */
export type SpacingStep = (typeof SPACING_STEPS)[number];

/** Step → pixel value (`4` → `16px`). The values `tokens.css` declares. */
export const spacingTokens: Record<SpacingStep, string> = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  12: '48px',
  16: '64px',
  24: '96px',
  32: '128px',
  48: '192px',
  64: '256px',
};

/** True when `value` is one of the scale steps. */
export function isSpacingStep(value: number): value is SpacingStep {
  return (SPACING_STEPS as readonly number[]).includes(value);
}

/** `--warsha-space-<step>`, without the `var()` wrapper. */
export function spacingVarName(step: SpacingStep): string {
  return `--warsha-space-${step}`;
}

/** The step as a CSS value: `var(--warsha-space-4)`. */
export function spaceVar(step: SpacingStep): string {
  return cssVar(`space-${step}`);
}

/**
 * The spacing value for a step multiplier.
 *
 * A component may only pass a scale step. The off-scale branch exists so the pre-token component
 * API (`Box`'s `p`/`m`, which take any number of 4px units) keeps its exact computed value instead
 * of silently snapping to the nearest token: `space(1.5)` is 6px today and 6px after the migration.
 * It is the only place in the design system that is allowed to compute a length, which is why the
 * R6 drift scan (see `tokenDrift.test.ts`) never sees a literal in a component.
 */
export function space(step: number): string {
  return isSpacingStep(step) ? spaceVar(step) : `${step * SPACING_BASE_PX}px`;
}
