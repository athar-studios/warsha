// @warsha/ui — elevation and layer tokens (DS v2 §4.4).
//
// Plates, not cards: every plate sits at `elevation-plate` (no shadow), and the one lift that exists
// is for the two things allowed to interrupt — the gate card and dialogs. Both reference the shadow
// tokens, so they are declared in both theme blocks (the cascade rule, §4.1).
//
// Layers are the stacking order the apps already use, named once so a new overlay cannot invent a
// number between two known ones. They are unitless, declared in the light block only (a z-index is
// not a theme decision), and R6.7 polices unitless `zIndex` literals in this package.

import { cssVar } from './vars';

/** The two elevation steps: every plate, and the one permitted lift. */
export const elevationTokens = {
  /** Every plate: no shadow, surfaces are separated by rules and recess levels. */
  plate: 'var(--warsha-shadow-none)',
  /** The gate card and dialogs — nothing else. */
  lift: 'var(--warsha-shadow-md)',
} as const;

/** The name of an elevation token. */
export type ElevationTokenName = keyof typeof elevationTokens;

/** Every elevation token name, in declaration order. */
export const elevationTokenNames = Object.keys(elevationTokens) as ElevationTokenName[];

/** The stacking layers, at the values the apps use today so nothing re-stacks. */
export const layerTokens = {
  /** The composer's sticky bar, above the transcript. */
  raised: '2',
  /** A picker listbox over its trigger. */
  popover: '50',
  /** The remote sticky composer. */
  sticky: '90',
  /** Topbars. */
  chrome: '100',
  /** The gate bell's scrim. */
  scrim: '140',
  /** A popover sheet. */
  sheet: '150',
  /** Offline and alert banners. */
  banner: '200',
  /** Modal dialogs. */
  modal: '1000',
} as const;

/** The name of a layer token. */
export type LayerTokenName = keyof typeof layerTokens;

/** Every layer token name, in declaration order. */
export const layerTokenNames = Object.keys(layerTokens) as LayerTokenName[];

/** `--warsha-elevation-lift`, without the `var()` wrapper. */
export function elevationVarName(name: ElevationTokenName): string {
  return `--warsha-elevation-${name}`;
}

/** `var(--warsha-elevation-lift)`. */
export function elevationVar(name: ElevationTokenName): string {
  return cssVar(`elevation-${name}`);
}

/** `--warsha-layer-popover`, without the `var()` wrapper. */
export function layerVarName(name: LayerTokenName): string {
  return `--warsha-layer-${name}`;
}

/** `var(--warsha-layer-popover)`. This is what a component's `zIndex` uses. */
export function layer(name: LayerTokenName): string {
  return cssVar(`layer-${name}`);
}