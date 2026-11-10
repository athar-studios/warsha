// packages/ui/src/v3/tokens/tokens.test.ts — Parity test: TS tokens == CSS tokens
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { darkColors, lightColors } from './color';
import { layerTokens, shadowTokens } from './elevation';
import { contentWidths, controlHeights } from './layout';
import { motionTokens } from './motion';
import { radiusTokens } from './radius';
import { spaceTokens } from './space';
import { fontFamilies, fontSizes, fontWeights, lineHeights, tracking } from './type';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS = fs.readFileSync(path.join(HERE, 'tokens.css'), 'utf8');

function cleanCss(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
}

describe('Design System v3 Token Parity (TS <-> CSS)', () => {
  const css = cleanCss(TOKENS_CSS);

  it('declares all light theme color tokens', () => {
    const cssNameMap: Record<string, string> = {
      lineStrong: 'line-strong',
      textMuted: 'text-muted',
      textFaint: 'text-faint',
      primaryHover: 'primary-hover',
      onPrimary: 'on-primary',
      primarySoft: 'primary-soft',
      primaryText: 'primary-text',
      attentionSoft: 'attention-soft',
      successSoft: 'success-soft',
      dangerSoft: 'danger-soft',
      infoSoft: 'info-soft',
    };

    for (const [key, value] of Object.entries(lightColors)) {
      const varName = `--w-${cssNameMap[key] ?? key}`;
      expect(css.toLowerCase()).toContain(`${varName}: ${value.toLowerCase()}`);
    }
  });

  it('declares all dark theme color tokens', () => {
    const cssNameMap: Record<string, string> = {
      lineStrong: 'line-strong',
      textMuted: 'text-muted',
      textFaint: 'text-faint',
      primaryHover: 'primary-hover',
      onPrimary: 'on-primary',
      primarySoft: 'primary-soft',
      primaryText: 'primary-text',
      attentionSoft: 'attention-soft',
      successSoft: 'success-soft',
      dangerSoft: 'danger-soft',
      infoSoft: 'info-soft',
    };

    for (const [key, value] of Object.entries(darkColors)) {
      const varName = `--w-${cssNameMap[key] ?? key}`;
      expect(css.toLowerCase()).toContain(`${varName}: ${value.toLowerCase()}`);
    }
  });

  it('declares typography tokens matching TS', () => {
    expect(css).toContain(`--w-font-sans: ${fontFamilies.sans}`);
    expect(css).toContain(`--w-font-mono: ${fontFamilies.mono}`);

    for (const [step, size] of Object.entries(fontSizes)) {
      expect(css).toContain(`--w-font-size-${step}: ${size}`);
    }

    for (const [step, lh] of Object.entries(lineHeights)) {
      expect(css).toContain(`--w-line-height-${step}: ${lh}`);
    }

    for (const [step, weight] of Object.entries(fontWeights)) {
      expect(css).toContain(`--w-font-weight-${step}: ${weight}`);
    }

    expect(css).toContain(`--w-tracking-code: ${tracking.code}`);
  });

  it('declares spacing tokens 1-10 matching TS', () => {
    for (const [step, val] of Object.entries(spaceTokens)) {
      expect(css).toContain(`--w-space-${step}: ${val}`);
    }
  });

  it('declares radius tokens matching TS', () => {
    for (const [step, val] of Object.entries(radiusTokens)) {
      expect(css).toContain(`--w-radius-${step}: ${val}`);
    }
  });

  it('declares elevation and layer tokens matching TS', () => {
    for (const [step, val] of Object.entries(shadowTokens)) {
      expect(css).toContain(`--w-shadow-${step}: ${val}`);
    }

    for (const [step, val] of Object.entries(layerTokens)) {
      expect(css).toContain(`--w-layer-${step}: ${val}`);
    }
  });

  it('declares motion tokens matching TS', () => {
    expect(css).toContain(`--w-dur-fast: ${motionTokens.durFast}`);
    expect(css).toContain(`--w-dur: ${motionTokens.dur}`);
    expect(css).toContain(`--w-dur-slow: ${motionTokens.durSlow}`);
    expect(css).toContain(`--w-ease: ${motionTokens.ease}`);
  });

  it('declares layout tokens and density defaults', () => {
    expect(css).toContain(`--w-content-narrow: ${contentWidths.narrow}`);
    expect(css).toContain(`--w-content: ${contentWidths.normal}`);
    expect(css).toContain(`--w-content-wide: ${contentWidths.wide}`);
    expect(css).toContain(`--w-nav-width: ${contentWidths.nav}`);
    expect(css).toContain(`--w-rail-width: ${contentWidths.rail}`);
    expect(css).toContain(`--w-control-height: ${controlHeights.comfortable}`);
  });

  it('switches density to compact on [data-density="compact"]', () => {
    expect(css).toContain('[data-density="compact"]');
    expect(css).toContain(`--w-control-height: ${controlHeights.compact}`);
    expect(css).toContain('--w-table-text-size: var(--w-font-size-sm)');
    expect(css).toContain('--w-table-line-height: var(--w-line-height-sm)');
  });

  it('collapses motion under prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('--w-dur-fast: 0ms');
    expect(css).toContain('--w-dur: 0ms');
    expect(css).toContain('--w-dur-slow: 0ms');
  });

  it('includes RTL mirror transform for directional icons', () => {
    expect(css).toContain('[dir="rtl"] .w-icon--mirror');
    expect(css).toContain('transform: scaleX(-1)');
  });
});
