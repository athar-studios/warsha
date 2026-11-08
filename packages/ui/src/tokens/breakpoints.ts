// @warsha/ui — breakpoints (DS v2 §4.5), TypeScript only.
//
// CSS `@media` preludes cannot read custom properties, so these values are deliberately *not* in
// `tokens.css` (R6.P exempts this module from CSS parity). Stylesheet preludes keep literals,
// restricted to the set derived here — `359, 767, 768, 1023, 1024, 1440` px — which R6.9 exempts
// from the app length ratchet. JS `matchMedia` callers import this module instead of writing a
// query literal.

/** The four named viewport steps, in pixels. */
export const breakpoints = {
  /** The phone floor. */
  narrow: 360,
  /** Where the rail compacts and the strip sheds readings. */
  tablet: 768,
  /** Where the Simple-mode end panel earns its place. */
  desktop: 1024,
  /** The reference desktop. */
  wide: 1440,
} as const;

/** The name of a breakpoint. */
export type BreakpointName = keyof typeof breakpoints;

/** Every breakpoint name, in declaration order. */
export const breakpointNames = Object.keys(breakpoints) as BreakpointName[];

/** The last pixel *below* a breakpoint: `maxWidth('tablet')` is 767, for a `max-width` prelude. */
export function maxWidth(bp: BreakpointName): number {
  return breakpoints[bp] - 1;
}

/**
 * The px values a CSS `@media` prelude may carry (R6.9's exemption set):
 * `narrow−1, tablet−1, tablet, desktop−1, desktop, wide`.
 */
export const MEDIA_PRELUDE_PX: readonly number[] = [
  maxWidth('narrow'),
  maxWidth('tablet'),
  breakpoints.tablet,
  maxWidth('desktop'),
  breakpoints.desktop,
  breakpoints.wide,
];