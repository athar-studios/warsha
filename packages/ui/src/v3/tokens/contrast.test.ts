// packages/ui/src/v3/tokens/contrast.test.ts — WCAG 2.x contrast verification (DS v3 §2.1)
// Every pair in DESIGN_SYSTEM_V3.md §2.1 must meet or exceed its required minimum.

import { describe, expect, it } from 'vitest';

import { darkColors, lightColors, type ThemeColors } from './color';

/** Relative luminance per WCAG 2.1 formula */
function luminance(hex: string): number {
  const clean = hex.replace('#', '').slice(0, 6);
  const rgb = clean.match(/../g)!.map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Contrast ratio between two colours */
function contrastRatio(hexA: string, hexB: string): number {
  const l1 = luminance(hexA);
  const l2 = luminance(hexB);
  const [bright, dark] = [l1, l2].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

interface ContrastCheck {
  fg: keyof ThemeColors;
  bg: keyof ThemeColors;
  min: number;
}

const CHECKS: ContrastCheck[] = [
  { fg: 'text', bg: 'bg', min: 4.5 },
  { fg: 'text', bg: 'surface', min: 4.5 },
  { fg: 'text', bg: 'sunken', min: 4.5 },
  { fg: 'textMuted', bg: 'bg', min: 4.5 },
  { fg: 'textMuted', bg: 'surface', min: 4.5 },
  { fg: 'textMuted', bg: 'sunken', min: 4.5 },
  { fg: 'textFaint', bg: 'surface', min: 3.0 },
  { fg: 'onPrimary', bg: 'primary', min: 4.5 },
  { fg: 'onPrimary', bg: 'primaryHover', min: 4.5 },
  { fg: 'text', bg: 'primarySoft', min: 4.5 },
  { fg: 'primaryText', bg: 'surface', min: 4.5 },
  { fg: 'primaryText', bg: 'bg', min: 4.5 },
  { fg: 'primaryText', bg: 'sunken', min: 4.5 },
  { fg: 'primaryText', bg: 'primarySoft', min: 4.5 },
  { fg: 'attention', bg: 'attentionSoft', min: 4.5 },
  { fg: 'attention', bg: 'surface', min: 4.5 },
  { fg: 'attention', bg: 'bg', min: 4.5 },
  { fg: 'success', bg: 'successSoft', min: 4.5 },
  { fg: 'danger', bg: 'dangerSoft', min: 4.5 },
  { fg: 'danger', bg: 'surface', min: 4.5 },
  { fg: 'info', bg: 'infoSoft', min: 4.5 },
  { fg: 'lineStrong', bg: 'surface', min: 3.0 },
  { fg: 'lineStrong', bg: 'bg', min: 3.0 },
  { fg: 'focus', bg: 'surface', min: 3.0 },
  { fg: 'focus', bg: 'bg', min: 3.0 },
];

describe('DESIGN_SYSTEM_V3 §2.1 Color Contrast', () => {
  describe('Light Theme Palette', () => {
    for (const check of CHECKS) {
      it(`light: ${String(check.fg)} on ${String(check.bg)} >= ${check.min}:1`, () => {
        const fgColor = lightColors[check.fg];
        const bgColor = lightColors[check.bg];
        const cr = contrastRatio(fgColor, bgColor);
        expect(cr).toBeGreaterThanOrEqual(check.min);
      });
    }
  });

  describe('Dark Theme Palette', () => {
    for (const check of CHECKS) {
      it(`dark: ${String(check.fg)} on ${String(check.bg)} >= ${check.min}:1`, () => {
        const fgColor = darkColors[check.fg];
        const bgColor = darkColors[check.bg];
        const cr = contrastRatio(fgColor, bgColor);
        expect(cr).toBeGreaterThanOrEqual(check.min);
      });
    }
  });
});
