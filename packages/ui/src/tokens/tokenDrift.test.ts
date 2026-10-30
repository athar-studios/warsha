// @warsha/ui — R6: token drift prevention (docs/ARCH_RULES.md R6).
//
// Two things are checked, and both fail the build:
//
//   1. No component in this package writes a design value. Colours, lengths, radii, shadows and
//      durations may only reach a component through a typed token helper (`colorVar`, `space`,
//      `radius`, `shadow`, `fontSize`, `fontWeight`, `duration`, `easing`), so a literal cannot
//      slip into the product and forget to follow the dark theme.
//   2. The TypeScript token layer and `tokens.css` declare exactly the same names with exactly the
//      same values — including which values the dark theme overrides. A token added to one half and
//      forgotten in the other fails here instead of rendering as `var()`-less nothing at runtime.
//
// The scanner is itself tested against a planted violation, the same way `scripts/check-arch.mjs
// --self-test` plants one per architecture rule: a rule that silently matches nothing proves
// nothing.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { colorTokenNames, colorTokens, colorVarName } from './colors';
import {
  durationNames,
  durationVarName,
  durations,
  easingNames,
  easingVarName,
  easings,
} from './motion';
import { radiusTokenNames, radiusTokens, radiusVarName } from './radius';
import { shadowTokenNames, shadowTokens, shadowVarName } from './shadow';
import { SPACING_STEPS, spacingTokens, spacingVarName } from './spacing';
import {
  fontFamilies,
  fontFamilyNames,
  fontFamilyVarName,
  fontSizeNames,
  fontSizeVarName,
  fontSizes,
  fontWeightNames,
  fontWeightVarName,
  fontWeights,
  lineHeightNames,
  lineHeightVarName,
  lineHeights,
} from './typography';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/ui/src` — the directory the component files live in. */
const UI_SRC = join(HERE, '..');

/** `packages/ui/src/tokens/tokens.css`. */
const TOKENS_CSS = join(HERE, 'tokens.css');

/** Files that render UI and must therefore be literal-free. */
function componentFiles(): string[] {
  const files = [join(UI_SRC, 'components.tsx')];
  for (const entry of readdirSync(join(UI_SRC, 'components'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;
    if (entry.name.includes('.stories.') || entry.name.includes('.test.')) continue;
    files.push(join(UI_SRC, 'components', entry.name));
  }
  return files;
}

/** Every story file, so "a component without a story" is a failing build too. */
function storyFiles(): string[] {
  return readdirSync(join(UI_SRC, 'components'))
    .filter((name) => name.endsWith('.stories.tsx'))
    .sort();
}

/** One line of a component that breaks R6. */
export interface Offence {
  /** 1-based line number in the scanned source. */
  readonly line: number;
  /** Lowercase phrase naming what was found, per the ARCH_RULES message format. */
  readonly offence: string;
}

/** Colours as hex or as a colour function. Keywords (`transparent`, `currentColor`) are fine. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;

/** Any absolute length. Percentages and unitless numbers are layout, not design values. */
const LENGTH_LITERAL = /\b\d*\.?\d+(?:px|rem|em|pt|vh|vw)\b/;

/** Physical direction properties: the one thing that silently breaks RTL. */
const PHYSICAL_PROPERTY =
  /\b(?:margin|padding)(?:Left|Right)\b|\bborder(?:Left|Right)(?:Width|Color|Style)?\b|\bborder(?:Top|Bottom)(?:Left|Right)Radius\b|\b(?:left|right)\s*:/;

/** A font stack written inline instead of naming a family token. */
const FONT_FAMILY_LITERAL = /fontFamily\s*:\s*(['"`])([^'"`]*)\1/;

/** Values that are CSS keywords rather than a choice of typeface. */
const CSS_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert']);

/** A token name written by hand instead of through a helper. */
const RAW_TOKEN_NAME = /--warsha-/;

/** The untyped escape hatch: correct only inside this token directory. */
const UNTYPED_HELPER = /\bcssVar\s*\(/;

/**
 * Blank out comments, keeping every line in place.
 *
 * A component may *describe* a value in prose ("half-steps of the 4px base") — that is documentation,
 * not a rendered value, and the scan is about what renders.
 */
function stripComments(source: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) => {
      return prefix + blank(match.slice(prefix.length));
    });
}

/**
 * Scan one component source for R6 violations.
 *
 * @param source the file contents
 * @returns every offending line, in file order
 */
export function scanForLiterals(source: string): Offence[] {
  const offences: Offence[] = [];

  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      const add = (offence: string) => offences.push({ line: index + 1, offence });

      const colour = line.match(COLOUR_LITERAL);
      if (colour) {
        add(
          `hardcoded colour \`${colour[0]}\` (use a colour token: colorVar('accent'), colorVar('text'), …)`
        );
      }

      const length = line.match(LENGTH_LITERAL);
      if (length) {
        add(
          `hardcoded length \`${length[0]}\` (use a spacing or radius token: space(4), radius('md'), …)`
        );
      }

      const physical = line.match(PHYSICAL_PROPERTY);
      if (physical) {
        add(`physical direction property \`${physical[0]}\` (use the logical property, RTL-safe)`);
      }

      const family = line.match(FONT_FAMILY_LITERAL);
      if (family && !CSS_KEYWORDS.has(family[2].trim())) {
        add(`hardcoded font family \`${family[2]}\` (use a family token: fontFamily('sans'), …)`);
      }

      const rawToken = line.match(RAW_TOKEN_NAME);
      if (rawToken) {
        add(`raw token name \`${rawToken[0]}…\` (call the typed token helper instead)`);
      }

      if (UNTYPED_HELPER.test(line)) {
        add('untyped `cssVar(` call (use the typed helper: colorVar, space, radius, shadow, …)');
      }
    });

  return offences;
}

/** One top-level rule of a stylesheet. */
interface CssBlock {
  readonly selector: string;
  readonly declarations: Map<string, string>;
}

/** Top-level (not inside `@media`) rules, with their custom-property declarations. */
function parseCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const stack: string[] = [];
  let buffer = '';

  for (const char of css) {
    if (char === '{') {
      stack.push(buffer.trim());
      buffer = '';
      continue;
    }
    if (char === '}') {
      const selector = stack.pop() ?? '';
      // `stack.length === 0` after the pop means this rule is top-level, so a `@media` wrapper is
      // skipped together with its contents.
      if (stack.length === 0 && selector !== '' && !selector.startsWith('@')) {
        blocks.push({ selector, declarations: parseDeclarations(buffer) });
      }
      buffer = '';
      continue;
    }
    buffer += char;
  }

  return blocks;
}

/** `--warsha-*: value;` pairs of one block. */
function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--warsha-[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

/** Hex letter case and font-stack quoting are not drift; everything else is. */
function normalise(value: string): string {
  return value.replace(/["']/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every token name the TypeScript layer declares. */
function declaredByTypeScript(): Set<string> {
  const names = new Set<string>();
  for (const name of colorTokenNames) names.add(colorVarName(name));
  for (const step of SPACING_STEPS) names.add(spacingVarName(step));
  for (const name of radiusTokenNames) names.add(radiusVarName(name));
  for (const name of shadowTokenNames) names.add(shadowVarName(name));
  for (const name of fontFamilyNames) names.add(fontFamilyVarName(name));
  for (const name of fontSizeNames) names.add(fontSizeVarName(name));
  for (const name of lineHeightNames) names.add(lineHeightVarName(name));
  for (const name of fontWeightNames) names.add(fontWeightVarName(name));
  for (const name of durationNames) names.add(durationVarName(name));
  for (const name of easingNames) names.add(easingVarName(name));
  return names;
}

describe('R6 token drift', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const blocks = parseCssBlocks(css);
  const lightBlock = blocks.find((block) => block.selector.includes(':root'));
  const darkBlock = blocks.find((block) => block.selector.includes("[data-theme='dark']"));

  /** One declaration, compared the way a reader compares it: hex case and quoting do not count. */
  function declared(block: CssBlock | undefined, name: string): string | undefined {
    const value = block?.declarations.get(name);
    return value === undefined ? undefined : normalise(value);
  }

  it('finds no literal design value in a component', () => {
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      const relative = file.slice(UI_SRC.length + 1).replace(/\\/g, '/');
      for (const { line, offence } of scanForLiterals(readFileSync(file, 'utf8'))) {
        offenders.push(`R6: packages/ui/src/${relative}:${line} ${offence}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('gives every exported component a story', () => {
    const source = readFileSync(join(UI_SRC, 'components.tsx'), 'utf8');
    const exported = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]).sort();
    const stories = storyFiles().map((name) => name.replace('.stories.tsx', ''));

    // The story set may carry foundations entries (`Tokens`) that no component exports; the reverse
    // is what fails: a component without a story.
    expect(stories.filter((name) => exported.includes(name)).sort()).toEqual(exported);
  });

  it('catches a planted violation of every rule', () => {
    const planted = [
      "backgroundColor: '#2563eb',",
      "padding: '12px',",
      'marginLeft: auto,',
      "fontFamily: 'Inter, sans-serif',",
      "border: '1px solid var(--warsha-color-border)',",
      "color: cssVar('color-accent'),",
    ].join('\n');

    const offences = scanForLiterals(planted).map((entry) => entry.offence);

    expect(offences.some((entry) => entry.startsWith('hardcoded colour'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('hardcoded length'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('physical direction'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('hardcoded font family'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('raw token name'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('untyped `cssVar('))).toBe(true);
  });

  it('accepts a component that only uses helpers', () => {
    expect(
      scanForLiterals("backgroundColor: colorVar('accent'), paddingInline: space(4),")
    ).toEqual([]);
  });

  it('does not scan comments as if they rendered', () => {
    expect(
      scanForLiterals('// half-steps of the 4px base\n/* #FFD60A lives in tokens.css */')
    ).toEqual([]);
  });

  it('declares light and dark colour blocks', () => {
    expect(lightBlock).toBeDefined();
    expect(darkBlock).toBeDefined();
  });

  it('declares exactly the token names the TypeScript layer declares', () => {
    const declaredNames = new Set(blocks.flatMap((block) => [...block.declarations.keys()]));
    // The reduced-motion block re-declares the duration tokens inside `@media`; it is skipped above,
    // so the two sets are directly comparable.
    expect([...declaredNames].sort()).toEqual([...declaredByTypeScript()].sort());
  });

  it('gives every colour token the light value the TypeScript layer carries', () => {
    for (const name of colorTokenNames) {
      expect(declared(lightBlock, colorVarName(name)), colorVarName(name)).toBe(
        normalise(colorTokens[name].light)
      );
    }
  });

  it('gives every colour token the dark value the TypeScript layer carries', () => {
    for (const name of colorTokenNames) {
      expect(declared(darkBlock, colorVarName(name)), colorVarName(name)).toBe(
        normalise(colorTokens[name].dark)
      );
    }
  });

  it('gives the spacing scale the values the TypeScript layer carries', () => {
    for (const step of SPACING_STEPS) {
      expect(declared(lightBlock, spacingVarName(step)), spacingVarName(step)).toBe(
        spacingTokens[step]
      );
    }
  });

  it('gives the radius, shadow and motion scales the values the TypeScript layer carries', () => {
    for (const name of radiusTokenNames) {
      expect(declared(lightBlock, radiusVarName(name)), radiusVarName(name)).toBe(
        radiusTokens[name]
      );
    }
    for (const name of shadowTokenNames) {
      expect(declared(lightBlock, shadowVarName(name)), shadowVarName(name)).toBe(
        shadowTokens[name]
      );
    }
    for (const name of durationNames) {
      expect(declared(lightBlock, durationVarName(name)), durationVarName(name)).toBe(
        durations[name]
      );
    }
    for (const name of easingNames) {
      expect(declared(lightBlock, easingVarName(name)), easingVarName(name)).toBe(easings[name]);
    }
  });

  it('gives the type scale the values the TypeScript layer carries', () => {
    for (const name of fontFamilyNames) {
      expect(declared(lightBlock, fontFamilyVarName(name)), fontFamilyVarName(name)).toBe(
        normalise(fontFamilies[name])
      );
    }
    for (const name of fontSizeNames) {
      expect(declared(lightBlock, fontSizeVarName(name)), fontSizeVarName(name)).toBe(
        fontSizes[name]
      );
    }
    for (const name of lineHeightNames) {
      expect(declared(lightBlock, lineHeightVarName(name)), lineHeightVarName(name)).toBe(
        lineHeights[name]
      );
    }
    for (const name of fontWeightNames) {
      expect(declared(lightBlock, fontWeightVarName(name)), fontWeightVarName(name)).toBe(
        fontWeights[name]
      );
    }
  });
});
