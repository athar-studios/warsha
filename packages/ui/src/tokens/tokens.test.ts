// @warsha/ui — token helper tests.
//
// `tokenDrift.test.ts` owns the R6 contract (components hold no literals, CSS and TypeScript agree).
// This file covers the helpers themselves: the name a token renders as, and the one place the design
// system is allowed to compute a length (`space()`'s off-scale branch), which is what let the
// components migrate to tokens without moving a pixel.

import { describe, expect, it } from 'vitest';

import { aliasResolvesTo, aliasTokenNames, aliasValue, aliasVar, aliasVarName } from './aliases';
import { breakpointNames, breakpoints, maxWidth, MEDIA_PRELUDE_PX } from './breakpoints';
import {
  colorPalette,
  colorTokenNames,
  colorTokens,
  colorValue,
  colorVar,
  colorVarName,
} from './colors';
import {
  elevationVar,
  elevationVarName,
  layer,
  layerTokenNames,
  layerTokens,
  layerVarName,
} from './elevation';
import { lineTokenNames, lineTokens, lineVar, lineVarName } from './lines';
import { duration, durationNames, durationVarName, easing, easingVarName } from './motion';
import { radius, radiusVarName } from './radius';
import { shadow, shadowVarName } from './shadow';
import { size, sizeTokens, sizeVarName } from './sizes';
import {
  isSpacingStep,
  SPACING_BASE_PX,
  SPACING_STEPS,
  space,
  spaceVar,
  spacingTokens,
} from './spacing';
import {
  fontFamily,
  fontFamilyVarName,
  fontSize,
  fontSizeVarName,
  fontWeight,
  fontWeightVarName,
  lineHeight,
  lineHeightVarName,
  tracking,
  trackingTokenNames,
  trackingTokens,
  trackingVarName,
} from './typography';
import { kebabCase } from './vars';

describe('colour tokens', () => {
  it('renders a camelCase token as a kebab-case custom property', () => {
    expect(colorVar('accentInk')).toBe('var(--warsha-color-accent-ink)');
    expect(colorVarName('surfaceMuted')).toBe('--warsha-color-surface-muted');
    expect(kebabCase('surfaceMuted')).toBe('surface-muted');
  });

  it('keeps the Warsha accent identical in both themes, always with ink on top', () => {
    expect(colorTokens.accent.light).toBe('#FFD60A');
    expect(colorTokens.accent.dark).toBe('#FFD60A');
    expect(colorTokens.accentInk.light).toBe('#0e0e0e');
    expect(colorTokens.accentInk.dark).toBe('#0e0e0e');
    expect(colorTokens.bg.dark).toBe('#0e0e0e');
  });

  it('carries every required role', () => {
    for (const role of [
      'bg',
      'surface',
      'text',
      'border',
      'accent',
      'success',
      'warning',
      'error',
      'muted',
    ]) {
      expect(colorTokenNames).toContain(role);
    }
  });

  it('resolves a palette per theme, one value per token', () => {
    const light = colorPalette('light');
    const dark = colorPalette('dark');

    expect(Object.keys(light).sort()).toEqual([...colorTokenNames].sort());
    expect(Object.keys(dark).sort()).toEqual([...colorTokenNames].sort());
    expect(colorValue('text', 'light')).toBe(colorTokens.text.light);
    expect(dark.text).toBe(colorTokens.text.dark);
  });

  it('never names a physical direction', () => {
    for (const name of colorTokenNames) {
      expect(colorVarName(name)).not.toMatch(/-(?:left|right|-inline-start|-inline-end)$/);
    }
  });
});

describe('spacing tokens', () => {
  it('is a 4px scale', () => {
    // DS v2 §4.5: the scale is the sixteen steps below — the thirteen B1 steps plus the half-steps
    // 0.5/1.5/2.5, each still exactly step × 4px.
    expect(SPACING_STEPS).toHaveLength(16);
    for (const step of SPACING_STEPS) {
      expect(spacingTokens[step]).toBe(`${step * SPACING_BASE_PX}px`);
    }
    expect(spacingTokens[4]).toBe('16px');
    expect(spacingTokens[0]).toBe('0px');
  });

  it('returns the token for an on-scale step', () => {
    expect(space(0)).toBe('var(--warsha-space-0)');
    expect(space(4)).toBe('var(--warsha-space-4)');
    expect(spaceVar(6)).toBe('var(--warsha-space-6)');
  });

  it('names a half-step with a dash, not a dot (DS v2 §4.5)', () => {
    // The half-steps are planned tokens, not off-scale fallbacks: `Button`'s 6px/10px block paddings
    // resolve to these names with the same pixels.
    expect(space(0.5)).toBe('var(--warsha-space-0-5)');
    expect(space(1.5)).toBe('var(--warsha-space-1-5)');
    expect(space(2.5)).toBe('var(--warsha-space-2-5)');
    expect(spacingTokens[0.5]).toBe('2px');
    expect(spacingTokens[1.5]).toBe('6px');
    expect(spacingTokens[2.5]).toBe('10px');
  });

  it('keeps the exact pixel value for an off-scale step', () => {
    // `Button`'s lg block padding (14px) and any `Box` multiplier off the scale: snapping them would
    // move pixels, so the fallback is what makes the migration behaviour-preserving.
    expect(space(3.5)).toBe('14px');
    expect(space(5)).toBe('20px');
  });

  it('knows which steps are on the scale', () => {
    expect(isSpacingStep(4)).toBe(true);
    expect(isSpacingStep(1.5)).toBe(true);
    expect(isSpacingStep(5)).toBe(false);
  });
});

describe('radius, shadow, motion and type tokens', () => {
  it('names every family of token with its own prefix', () => {
    expect(radius('md')).toBe('var(--warsha-radius-md)');
    expect(radiusVarName('xl')).toBe('--warsha-radius-xl');
    expect(shadow('md')).toBe('var(--warsha-shadow-md)');
    expect(shadowVarName('lg')).toBe('--warsha-shadow-lg');
    expect(duration('normal')).toBe('var(--warsha-duration-normal)');
    expect(durationVarName('fast')).toBe('--warsha-duration-fast');
    expect(easing('standard')).toBe('var(--warsha-ease-standard)');
    expect(easingVarName('exit')).toBe('--warsha-ease-exit');
  });

  it('names the type scale with exactly one tracking token, `code`', () => {
    expect(fontFamily('sans')).toBe('var(--warsha-font-sans)');
    expect(fontFamily('mono')).toBe('var(--warsha-font-mono)');
    expect(fontFamilyVarName('sans')).toBe('--warsha-font-sans');
    expect(fontSize('md')).toBe('var(--warsha-font-size-md)');
    expect(fontSizeVarName('xs')).toBe('--warsha-font-size-xs');
    expect(lineHeight('base')).toBe('var(--warsha-line-height-base)');
    expect(lineHeightVarName('tight')).toBe('--warsha-line-height-tight');
    expect(fontWeight('bold')).toBe('var(--warsha-font-weight-bold)');
    expect(fontWeightVarName('medium')).toBe('--warsha-font-weight-medium');
    // DS v2 §2.3 (planned spec change): Arabic is a connected script, so the scale carries exactly
    // one tracking token — `code`, for mono pairing/verification codes only. A second one would be
    // an invitation to track prose.
    expect(trackingTokenNames).toEqual(['code']);
    expect(trackingTokens.code).toBe('0.2em');
    expect(tracking('code')).toBe('var(--warsha-tracking-code)');
    expect(trackingVarName('code')).toBe('--warsha-tracking-code');
  });
});

// The two families the redesign added (docs/design/REDESIGN.md §12). `tokenDrift.test.ts` proves the CSS
// half declares them; this proves the *helpers* are named the way a component will reach for them — which is
// the difference between `aliasVar('signalText')` and a screen writing `var(--warsha-signal-text)` by hand.
describe('semantic aliases', () => {
  it('names each alias by its meaning, in kebab-case, under the one prefix', () => {
    expect(aliasVar('signal')).toBe('var(--warsha-signal)');
    expect(aliasVar('signalInk')).toBe('var(--warsha-signal-ink)');
    expect(aliasVarName('benchPlate')).toBe('--warsha-bench-plate');
    expect(aliasVarName('lampWorking')).toBe('--warsha-lamp-working');
    expect(aliasVarName('diffAddBg')).toBe('--warsha-diff-add-bg');
    expect(aliasVarName('focusRing')).toBe('--warsha-focus-ring');
  });

  it('keeps every alias one hop from a colour token and never a raw value', () => {
    for (const name of aliasTokenNames) {
      for (const theme of ['light', 'dark'] as const) {
        const value = aliasValue(name, theme);
        // Either `var(--warsha-color-…)` or the single derived mix the direction allows.
        expect(value.startsWith('var(--warsha-color-') || value.startsWith('color-mix('), `${name}/${theme}`).toBe(
          true
        );
        // No alias is allowed to smuggle a hex past the palette (R6's whole point, from the other side).
        expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      }
    }
  });

  it('carries the night shift: three aliases change token with the theme, and they are the visible ones', () => {
    // The lamp-as-mark, the yellow-as-text and the focus ring are the three places a light plate and a dark
    // one cannot share a token and stay AA-readable (§9, §12).
    expect(aliasValue('signalText', 'light')).toBe('var(--warsha-color-accent-strong)');
    expect(aliasValue('signalText', 'dark')).toBe('var(--warsha-color-accent)');
    expect(aliasValue('lampWorking', 'light')).toBe('var(--warsha-color-accent-strong)');
    expect(aliasValue('lampWorking', 'dark')).toBe('var(--warsha-color-accent)');
    expect(aliasValue('focusRing', 'light')).toBe('var(--warsha-color-accent-strong)');
    expect(aliasValue('focusRing', 'dark')).toBe('var(--warsha-color-accent)');

    // The signal itself is the brand, identical in both themes — the direction's §1.6 claim, in a value.
    expect(aliasValue('signal', 'light')).toBe(aliasValue('signal', 'dark'));
  });

  it('resolves an alias down to the colour token it names', () => {
    expect(aliasResolvesTo('signal', 'dark')).toBe('accent');
    expect(aliasResolvesTo('benchPlate', 'light')).toBe('surface-muted');
    expect(aliasResolvesTo('lampFail', 'light')).toBe('error');
    expect(aliasResolvesTo('signalWash', 'light')).toContain('color-mix(');
  });
});

describe('bench sizes', () => {
  it('names a length as a token, so a component never writes a pixel', () => {
    expect(size('touch')).toBe('var(--warsha-size-touch)');
    expect(sizeVarName('touchCompact')).toBe('--warsha-size-touch-compact');
    expect(sizeVarName('diffGutter')).toBe('--warsha-size-diff-gutter');
    expect(sizeVarName('railCompact')).toBe('--warsha-size-rail-compact');
    expect(sizeVarName('streamTime')).toBe('--warsha-size-stream-time');
    expect(size('measure')).toBe('var(--warsha-size-measure)');
  });

  it('holds the two accessibility facts the compounds depend on', () => {
    // 44px is WCAG's target minimum as REDESIGN §9 adopts it; 2px is the ring's width and the stamp's border.
    expect(sizeTokens.touch).toBe('44px');
    expect(sizeTokens.inscribe).toBe('2px');
    // The hairline and the edge are the only two structural widths the bench knows.
    expect(sizeTokens.rule).toBe('1px');
    expect(sizeTokens.edge).toBe('3px');
    // The measure is the prose cap §11 states in characters, not in pixels.
    expect(sizeTokens.measure).toBe('68ch');
  });

  it('carries the geometry §4 names, so a rail is one number everywhere', () => {
    expect(sizeTokens.rail).toBe('264px');
    expect(sizeTokens.panel).toBe('300px');
    expect(sizeTokens.topbar).toBe('56px');
    expect(sizeTokens.strip).toBe('36px');
  });

  it('gives the two loops a duration token of their own, zeroed with the rest under reduced motion', () => {
    // §8: the component asks for a duration; `tokens.css` decides that a user who asked for calm gets none.
    expect(duration('breathe')).toBe('var(--warsha-duration-breathe)');
    expect(duration('shimmer')).toBe('var(--warsha-duration-shimmer)');
    expect(durationNames).toContain('breathe');
    expect(durationNames).toContain('shimmer');
  });
});

// The DS v2 families (§4.3–§4.5). `tokenDrift.test.ts` proves the CSS half declares them; this proves
// the helpers render the names a component reaches for, and that the values are the spec's values.
describe('line tokens', () => {
  it('names each border shorthand under the one prefix', () => {
    expect(lineVar('rule')).toBe('var(--warsha-line-rule)');
    expect(lineVarName('bandFail')).toBe('--warsha-line-band-fail');
    expect(lineVar('inscribe')).toBe('var(--warsha-line-inscribe)');
    expect(lineTokenNames).toHaveLength(8);
  });

  it('composes every line from size and colour tokens, never a literal', () => {
    for (const name of lineTokenNames) {
      expect(lineTokens[name]).not.toMatch(/#[0-9a-fA-F]{3,8}|\b\d+(?:px|rem|em)\b/);
    }
    expect(lineTokens.rule).toBe('var(--warsha-size-rule) solid var(--warsha-bench-rule)');
    expect(lineTokens.signal).toBe('var(--warsha-size-edge) solid var(--warsha-signal-text)');
    expect(lineTokens.quiet).toBe('var(--warsha-size-edge) solid transparent');
    expect(lineTokens.inscribe).toBe('var(--warsha-size-inscribe) solid currentColor');
  });
});

describe('elevation and layer tokens', () => {
  it('names the two elevations and the eight layers', () => {
    expect(elevationVar('plate')).toBe('var(--warsha-elevation-plate)');
    expect(elevationVarName('lift')).toBe('--warsha-elevation-lift');
    expect(layer('raised')).toBe('var(--warsha-layer-raised)');
    expect(layerVarName('popover')).toBe('--warsha-layer-popover');
    expect(layerTokenNames).toHaveLength(8);
  });

  it('holds the stacking order at the values the apps use today (DS v2 §4.4)', () => {
    // Pixel-neutral: a layer token that moved a number would re-stack the bench.
    expect(layerTokens).toEqual({
      raised: '2',
      popover: '50',
      sticky: '90',
      chrome: '100',
      scrim: '140',
      sheet: '150',
      banner: '200',
      modal: '1000',
    });
  });
});

describe('layout sizes and breakpoints (DS v2 §4.5)', () => {
  it('names the layout family pixel-identically to the literals it replaces', () => {
    expect(size('benchOffset')).toBe('var(--warsha-size-bench-offset)');
    expect(sizeVarName('plateMax')).toBe('--warsha-size-plate-max');
    expect(sizeTokens.benchOffset).toBe('80px');
    expect(sizeTokens.plateMax).toBe('900px');
    expect(sizeTokens.ledgerMax).toBe('1000px');
    expect(sizeTokens.contentMax).toBe('1100px');
    expect(sizeTokens.contentWide).toBe('1400px');
    expect(sizeTokens.dialog).toBe('32rem');
    expect(sizeTokens.dialogWide).toBe('34rem');
    expect(sizeTokens.notice).toBe('480px');
    expect(sizeTokens.formNarrow).toBe('420px');
    expect(sizeTokens.wizard).toBe('26rem');
    expect(sizeTokens.qr).toBe('160px');
    expect(sizeTokens.previewMin).toBe('320px');
    expect(sizeTokens.pane).toBe('400px');
    expect(sizeTokens.fieldMin).toBe('12rem');
    expect(sizeTokens.labelCol).toBe('7rem');
    expect(sizeTokens.measureCompact).toBe('9rem');
    expect(sizeTokens.picker).toBe('13rem');
    expect(sizeTokens.pickerWide).toBe('15rem');
    expect(sizeTokens.inputMin).toBe('140px');
    expect(sizeTokens.popover).toBe('360px');
    expect(sizeTokens.popoverBlock).toBe('520px');
    expect(sizeTokens.sheetBlock).toBe('420px');
    expect(sizeTokens.stripItem).toBe('240px');
  });

  it('derives the media-prelude exemption set from the breakpoints', () => {
    expect(breakpointNames).toEqual(['narrow', 'tablet', 'desktop', 'wide']);
    expect(breakpoints).toEqual({ narrow: 360, tablet: 768, desktop: 1024, wide: 1440 });
    expect(maxWidth('tablet')).toBe(767);
    expect(maxWidth('desktop')).toBe(1023);
    expect([...MEDIA_PRELUDE_PX].sort((a, b) => a - b)).toEqual([359, 767, 768, 1023, 1024, 1440]);
  });
});
