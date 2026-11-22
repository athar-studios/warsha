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
import {
  type FontSizeStep,
  fontFamilies,
  fontSizes,
  fontWeights,
  lineHeights,
  tracking,
} from './type';

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

  // R-UI-3 T1/D3-a: rem sizes (they follow the user's root font size) and unitless ratios (they carry
  // the ratio itself, so a nested size keeps the leading). The px figures in §2.2 are the 16px-root
  // equivalents, which is why no px is left in either token family.
  it('states every type step in rem and every line height as a unitless ratio', () => {
    for (const [step, size] of Object.entries(fontSizes)) {
      expect(size, `font size ${step} is rem`).toMatch(/^\d+(?:\.\d+)?rem$/);
    }

    for (const [step, leading] of Object.entries(lineHeights)) {
      expect(leading, `line height ${step} is unitless`).toMatch(/^\d+(?:\.\d+)?$/);
    }

    expect(css).not.toMatch(/--w-font-size-[a-z0-9]+:\s*[^;]*\dpx/);
    expect(css).not.toMatch(/--w-line-height-[a-z0-9]+:\s*[^;]*\dpx/);
  });

  it('keeps every body step at or above the 1.6 Arabic line-height rule and every title above its floor', () => {
    const floors: Record<string, number> = {
      xs: 1.6,
      sm: 1.6,
      md: 1.6,
      lg: 1.6,
      xl: 1.55,
      '2xl': 1.5,
      '3xl': 1.4,
    };

    for (const [step, floor] of Object.entries(floors)) {
      const leading = Number(lineHeights[step as FontSizeStep]);
      expect(Number.isFinite(leading), `line height ${step} parses as a number`).toBe(true);
      expect(leading, `line height ${step}`).toBeGreaterThanOrEqual(floor);
    }

    // At the default 16px root the body step is the §2.2 "14 / 22 = 1.571 is below the rule" fix.
    expect(parseFloat(fontSizes.sm) * 16).toBe(14);
    expect(Number(lineHeights.sm) * parseFloat(fontSizes.sm) * 16).toBeCloseTo(23.1, 5);
  });

  // A comment that contains `*/` closes itself early and leaves the rest of its sentence as CSS: postcss then
  // refuses the whole stylesheet and the app ships unstyled. This is the cheap guard for that (it caught a
  // `--w-dur-*/--w-ease` in the first draft of the D1 motion comment).
  it('is a well-formed stylesheet: comments close once and braces balance', () => {
    const opens = (TOKENS_CSS.match(/\/\*/g) ?? []).length;
    const closes = (TOKENS_CSS.match(/\*\//g) ?? []).length;
    expect(closes, 'every comment closes exactly once').toBe(opens);

    const stripped = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect((stripped.match(/{/g) ?? []).length).toBe((stripped.match(/}/g) ?? []).length);
  });

  it('includes RTL mirror transform for directional icons', () => {
    expect(css).toContain('[dir="rtl"] .w-icon--mirror');
    expect(css).toContain('transform: scaleX(-1)');
  });
});

// R-UI-3 D1-f: the guard. Every rule that declares motion — an `animation:` or a `transform:` — must have a
// counterpart inside the `prefers-reduced-motion: reduce` block that neutralises it. A new animation or a new
// transform added anywhere in this stylesheet without that counterpart fails here, before it ships.
describe('motion has a reduced-motion counterpart (R-UI-3 D1-f)', () => {
  interface CssRule {
    selector: string;
    body: string;
    inKeyframes: boolean;
    inReducedMotion: boolean;
  }

  function matchingBrace(css: string, open: number): number {
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    throw new Error('unbalanced braces in tokens.css');
  }

  function collect(
    css: string,
    context: { inKeyframes: boolean; inReducedMotion: boolean },
    out: CssRule[]
  ): void {
    let cursor = 0;
    while (cursor < css.length) {
      const open = css.indexOf('{', cursor);
      if (open === -1) return;
      const selector = css.slice(cursor, open).trim();
      const close = matchingBrace(css, open);
      const body = css.slice(open + 1, close);

      if (/^@(?:-webkit-)?keyframes/.test(selector)) {
        // The keyframes are the animation itself; the rule that names them is what needs a counterpart.
      } else if (selector.startsWith('@media')) {
        collect(
          body,
          {
            ...context,
            inReducedMotion: context.inReducedMotion || selector.includes('prefers-reduced-motion'),
          },
          out
        );
      } else if (selector.startsWith('@')) {
        collect(body, context, out);
      } else {
        out.push({ selector, body, ...context });
      }

      cursor = close + 1;
    }
  }

  const rules = (() => {
    const collected: CssRule[] = [];
    collect(cleanCss(TOKENS_CSS), { inKeyframes: false, inReducedMotion: false }, collected);
    return collected;
  })();

  const reducedRules = rules.filter((rule) => rule.inReducedMotion);
  const reducedSelectors = (declaration: string): string[] =>
    reducedRules
      .filter((rule) => new RegExp(`(?:^|;)\\s*${declaration}\\s*:\\s*none`).test(rule.body))
      .flatMap((rule) => rule.selector.split(',').map((part) => part.trim()));

  // `[dir="rtl"] .w-icon--mirror` is a static direction mirror, not motion: it predates D1 and never animates.
  const STATIC_ALLOWLIST = ['[dir="rtl"] .w-icon--mirror'];

  it('neutralises every animation and transform rule outside the reduce block', () => {
    const animated: string[] = [];
    const transformed: string[] = [];

    for (const rule of rules) {
      if (rule.inReducedMotion) continue;
      if (/(?:^|;)\s*animation\s*:/.test(rule.body)) animated.push(rule.selector);
      if (/(?:^|;)\s*transform\s*:/.test(rule.body)) transformed.push(rule.selector);
    }

    // The two one-shot entrances and the stepper marker are declared here; the three loops are declared
    // inline by Spinner/Skeleton/ProgressBar, so their selectors are asserted by name below.
    expect(animated).toEqual(
      expect.arrayContaining(['.w-sheet', '.w-sheet-scrim', ".w-stepper__bar[data-state='done']"])
    );

    const animationCoverage = reducedSelectors('animation');
    for (const selector of animated) {
      expect(
        animationCoverage,
        `${selector} has an animation but no reduced-motion counterpart`
      ).toContain(selector);
    }

    // The loops live in the components' inline `animation:` strings; the stylesheet still has to name them
    // to win over the inline style under reduce.
    for (const loop of ['.w-spinner svg', '.w-skeleton', '.w-progress-bar__fill']) {
      expect(
        animationCoverage,
        `${loop} has an inline loop but no reduced-motion counterpart`
      ).toContain(loop);
    }

    const transformCoverage = reducedSelectors('transform');
    const motionTransforms = transformed.filter((selector) => !STATIC_ALLOWLIST.includes(selector));
    // The only transform declared outside a keyframe is the press state (D1-c); the sheet slide and the
    // stepper's scale-in live inside their keyframes, which are neutralised through the rules that name them.
    expect(motionTransforms).toEqual(['.w-button:active:not(:disabled)']);
    for (const selector of motionTransforms) {
      expect(
        transformCoverage,
        `${selector} transforms but has no reduced-motion counterpart`
      ).toContain(selector);
    }

    // The allowlist stays honest: the mirror is still a static transform, and it is still not animated.
    expect(transformed).toContain('[dir="rtl"] .w-icon--mirror');
  });
});

// R-UI-3 T6: the animations the components name by string have to exist, or the spinner, the shimmer and the
// indeterminate bar are inert (W7) and the Sheet and the stepper marker never move.
describe('the named animations exist (R-UI-3 T6)', () => {
  it('declares w-spin, w-pulse, w-progress-indeterminate, w-sheet-in and w-step-done', () => {
    const css = cleanCss(TOKENS_CSS);
    for (const name of [
      'w-spin',
      'w-pulse',
      'w-progress-indeterminate',
      'w-sheet-in',
      'w-step-done',
    ]) {
      expect(css, `${name} is declared in tokens.css`).toContain(`@keyframes ${name}`);
    }
  });

  it('mirrors inline-axis motion through --w-inline-sign instead of left/right', () => {
    const css = cleanCss(TOKENS_CSS);
    expect(css).toContain('--w-inline-sign: 1');
    expect(css).toContain('--w-inline-sign: -1');
    expect(css).toMatch(/translateX\(calc\([^)]*var\(--w-inline-sign\)/);
  });
});
