// @warsha/ui — semantic aliases: the Bench & Signal layer over the colour tokens.
//
// The direction (`docs/design/REDESIGN.md` §12) introduces *no new raw colours*. Every value here
// resolves to a token in `./colors.ts`, so the alias layer changes what a component is allowed to
// *say*, not what it is allowed to *be*: a component writes `aliasVar('signal')` ("this is the lamp")
// instead of `colorVar('accent')` ("this is yellow"), and the theme decides which yellow that is.
//
// Why aliases are worth a second module:
//
//   * the signal lamp is not one colour but three roles — the lit surface (`signal`), the ink that
//     sits on it (`signalInk`) and the AA-safe yellow-as-text (`signalText`, which is the dark gold
//     on light and the brand yellow on dark);
//   * the bench is not "a background" but a plate, a rule and an edge (`benchPlate`, `benchRule`,
//     `benchEdge`), which is what keeps a hairline fastener from being re-picked per component;
//   * a lamp's state is a name, not a colour (`lampIdle` … `lampFail`), so adding a sixth state later
//     is one alias plus one CSS line;
//   * `focusRing` is the AUDIT-1 fix: the outline is the only place where the *theme* decides which
//     accent is visible (`accentStrong` on light — 5.03:1 against `bg` — `accent` on dark), so a
//     component can no longer pick the 1.35:1 light-yellow ring by accident.
//
// `tokens.css` declares the same names in the `:root` and `[data-theme='dark']` blocks;
// `tokenDrift.test.ts` fails if the two halves disagree (R6).

import type { ThemeMode } from './colors';
import { cssVar, kebabCase } from './vars';

/** The colour token an alias resolves to, named the way `tokens.css` names it. */
function colorRef(name: string): string {
  return `var(--warsha-color-${name})`;
}

/**
 * The signal wash: the one place the lamp tints a surface instead of filling it (a gate line in the
 * event stream, the current stage in the pipeline). Derived from the signal by `color-mix`, so it is
 * still not a new colour, and defined once so no component invents its own percentage.
 */
const SIGNAL_WASH = 'color-mix(in srgb, var(--warsha-color-accent) 12%, transparent)';

/** Every semantic alias, with the token it resolves to in each theme. */
export const aliasTokens = {
  /** The lamp itself: "this needs the owner's hand". Never decoration, never a background wash. */
  signal: { light: colorRef('accent'), dark: colorRef('accent') },
  /** Ink drawn on the signal — always `accentInk`, never white (13.67:1 in both themes). */
  signalInk: { light: colorRef('accent-ink'), dark: colorRef('accent-ink') },
  /**
   * The signal as *foreground*: the AA-safe yellow-as-text per theme.
   *
   * It has two jobs, and the direction's colour rule is what links them. As text it is the only yellow
   * readable on a light plate; as a **mark** — a selected row's edge, a tab's underline, a gate card's band,
   * a meter fill against its track — it is what `signal` cannot be, because raw `#ffd60a` against a light
   * surface measures 1.41:1 and WCAG 1.4.11 asks 3:1 of anything that identifies a state. So: the lamp as a
   * *fill carrying ink* is `signal` (its ink clears 13.67:1), and the lamp as a *mark on a surface* is
   * `signalText`.
   */
  signalText: { light: colorRef('accent-strong'), dark: colorRef('accent') },
  /** The signal at 12% — gate lines and the current pipeline stage only. */
  signalWash: { light: SIGNAL_WASH, dark: SIGNAL_WASH },
  /** The recessed work surface: rails, instrument beds, the terminal dock. */
  benchPlate: { light: colorRef('surface-muted'), dark: colorRef('surface-muted') },
  /** The hairline fastener between plates. */
  benchRule: { light: colorRef('border'), dark: colorRef('border') },
  /** Structural edges: control borders and meter tracks. */
  benchEdge: { light: colorRef('border-strong'), dark: colorRef('border-strong') },
  /** Agent/run state: nothing to report. Non-text only (the word beside it carries the state). */
  lampIdle: { light: colorRef('muted'), dark: colorRef('muted') },
  /** A lane is moving. Dark gold on light so the dot reads against a plate. */
  lampWorking: { light: colorRef('accent-strong'), dark: colorRef('accent') },
  /** The lane is waiting on the owner — the lit lamp. */
  lampWaiting: { light: colorRef('accent'), dark: colorRef('accent') },
  /** Passing / approved. */
  lampOk: { light: colorRef('success'), dark: colorRef('success') },
  /** Failing / blocked. */
  lampFail: { light: colorRef('error'), dark: colorRef('error') },
  /** The added-line wash in a diff; the `+` gutter glyph carries the meaning. */
  diffAddBg: { light: colorRef('surface-muted'), dark: colorRef('surface-muted') },
  /** The focus ring, per theme (AUDIT-1 §1.3). */
  focusRing: { light: colorRef('accent-strong'), dark: colorRef('accent') },
} as const;

/** The name of a semantic alias. */
export type AliasTokenName = keyof typeof aliasTokens;

/** Every alias name, in declaration order. */
export const aliasTokenNames = Object.keys(aliasTokens) as AliasTokenName[];

/** `--warsha-signal`, `--warsha-bench-plate`, … — without the `var()` wrapper. */
export function aliasVarName(name: AliasTokenName): string {
  return `--warsha-${kebabCase(name)}`;
}

/** The alias as a CSS value: `var(--warsha-signal)`. This is what a component uses. */
export function aliasVar(name: AliasTokenName): string {
  return cssVar(kebabCase(name));
}

/**
 * The alias's own resolution for one theme, for code that cannot resolve a `var()` chain (canvas,
 * SVG fills, a story that must print the token's target). Note this is *one* hop: the result is
 * itself a `var(--warsha-color-…)` reference, never a hex.
 */
export function aliasValue(name: AliasTokenName, theme: ThemeMode): string {
  return aliasTokens[name][theme];
}

/** The colour token an alias ultimately means, or the alias string itself when it is a mix. */
export function aliasResolvesTo(name: AliasTokenName, theme: ThemeMode): string {
  const value = aliasValue(name, theme);
  const match = value.match(/^var\(--warsha-color-([\w-]+)\)$/);
  return match ? match[1] : value;
}
