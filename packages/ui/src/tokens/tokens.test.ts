// @warsha/ui — token helper tests.
//
// `tokenDrift.test.ts` owns the R6 contract (components hold no literals, CSS and TypeScript agree).
// This file covers the helpers themselves: the name a token renders as, and the one place the design
// system is allowed to compute a length (`space()`'s off-scale branch), which is what let the
// components migrate to tokens without moving a pixel.

import { describe, expect, it } from 'vitest';

import {
  colorPalette,
  colorTokenNames,
  colorTokens,
  colorValue,
  colorVar,
  colorVarName,
} from './colors';
import { duration, durationVarName, easing, easingVarName } from './motion';
import { radius, radiusVarName } from './radius';
import { shadow, shadowVarName } from './shadow';
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

  it('keeps the exact pixel value for an off-scale step', () => {
    // `Button`'s block paddings: 6px, 10px and 14px. Snapping them to the scale would move every
    // button, so the fallback is what makes the migration behaviour-preserving.
    expect(space(1.5)).toBe('6px');
    expect(space(2.5)).toBe('10px');
    expect(space(3.5)).toBe('14px');
    expect(space(5)).toBe('20px');
  });

  it('knows which steps are on the scale', () => {
    expect(isSpacingStep(4)).toBe(true);
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

  it('names the type scale without inventing a tracking token', () => {
    expect(fontFamily('sans')).toBe('var(--warsha-font-sans)');
    expect(fontFamily('mono')).toBe('var(--warsha-font-mono)');
    expect(fontFamilyVarName('sans')).toBe('--warsha-font-sans');
    expect(fontSize('md')).toBe('var(--warsha-font-size-md)');
    expect(fontSizeVarName('xs')).toBe('--warsha-font-size-xs');
    expect(lineHeight('base')).toBe('var(--warsha-line-height-base)');
    expect(lineHeightVarName('tight')).toBe('--warsha-line-height-tight');
    expect(fontWeight('bold')).toBe('var(--warsha-font-weight-bold)');
    expect(fontWeightVarName('medium')).toBe('--warsha-font-weight-medium');
    // Arabic is a connected script: a letter-spacing token would be a bug waiting to be applied.
    expect(fontSizeVarName('md')).not.toContain('tracking');
  });
});
