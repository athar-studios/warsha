// @warsha/ui — motion tokens.
//
// Short, symmetric and cheap: nothing in Warsha animates for longer than a quarter second, and the
// two curves are the only ones the product allows. `prefers-reduced-motion` is honoured at the
// stylesheet level (`tokens.css` zeroes the durations), so a component never has to ask — every
// transition written with these tokens collapses to an instant change for a user who asked for it.

import { cssVar } from './vars';

/** Duration tokens. */
export const durations = {
  /** Hover/press feedback. */
  fast: '120ms',
  /** The default: most state changes. */
  normal: '180ms',
  /** Panels, expanding rows. */
  slow: '240ms',
} as const;

/** The name of a duration token. */
export type DurationName = keyof typeof durations;

/** Easing tokens. */
export const easings = {
  /** Anything that both leaves and arrives. */
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  /** Something appearing: starts fast, settles. */
  entrance: 'cubic-bezier(0, 0, 0.2, 1)',
  /** Something leaving: starts slow, gets out of the way. */
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/** The name of an easing token. */
export type EasingName = keyof typeof easings;

/** Every duration token name, in declaration order. */
export const durationNames = Object.keys(durations) as DurationName[];

/** Every easing token name, in declaration order. */
export const easingNames = Object.keys(easings) as EasingName[];

/** `--warsha-duration-<name>`, without the `var()` wrapper. */
export function durationVarName(name: DurationName): string {
  return `--warsha-duration-${name}`;
}

/** `--warsha-ease-<name>`, without the `var()` wrapper. */
export function easingVarName(name: EasingName): string {
  return `--warsha-ease-${name}`;
}

/** `var(--warsha-duration-normal)`. */
export function duration(name: DurationName): string {
  return cssVar(`duration-${name}`);
}

/** `var(--warsha-ease-standard)`. */
export function easing(name: EasingName): string {
  return cssVar(`ease-${name}`);
}
