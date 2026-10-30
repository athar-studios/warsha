// @warsha/ui — R6: token drift prevention (docs/ARCH_RULES.md R6).
//
// Three things are checked, and all of them fail the build:
//
//   1. No component in this package writes a design value. Colours, lengths, radii, shadows and
//      durations may only reach a component through a typed token helper (`colorVar`, `space`,
//      `radius`, `shadow`, `fontSize`, `fontWeight`, `duration`, `easing`), so a literal cannot
//      slip into the product and forget to follow the dark theme.
//   2. The TypeScript token layer and `tokens.css` declare exactly the same names with exactly the
//      same values — including which values the dark theme overrides. A token added to one half and
//      forgotten in the other fails here instead of rendering as `var()`-less nothing at runtime.
//   3. The two app sources (`apps/desktop/src/**`, `apps/remote/src/**`) carry no colour, spacing or
//      type literal either. Apps are not this package, so they consume tokens as CSS custom
//      properties (`var(--warsha-color-accent)`) rather than through the typed helpers — the helper
//      import is allowed, the literal is not.
//
// The scanners are themselves tested against a planted violation, the same way
// `scripts/check-arch.mjs --self-test` plants one per architecture rule: a rule that silently
// matches nothing proves nothing.

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

/** The repository root, four levels above `packages/ui/src/tokens`. */
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** The two app sources R6 reads, relative to the repository root. */
const APP_DIRECTORIES = ['apps/desktop/src', 'apps/remote/src'] as const;

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

/**
 * Every `.ts`/`.tsx` file the two apps render from, as repository-relative paths.
 *
 * Test files are excluded for the same reason this package's scanner skips them: an assertion may
 * name a rendered value, and what it asserts is the screen's output, not a design decision.
 */
export function appSourceFiles(): string[] {
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(relative);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      files.push(relative);
    }
  };

  for (const directory of APP_DIRECTORIES) walk(directory);
  return files.sort();
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

/** A spacing declaration, with the value it sets: only that value is the spacing decision. */
const SPACING_DECLARATION =
  /\b(?:(?:padding|margin)(?:Inline|Block|Top|Bottom|InlineStart|InlineEnd|BlockStart|BlockEnd)?|gap|rowGap|columnGap)\s*:\s*'([^']*)'/g;

/** A font-size declaration, with its value. */
const FONT_SIZE_DECLARATION = /\bfontSize\s*:\s*'([^']*)'/g;

/** A spacing value the 4px scale can express exactly, so leaving it as pixels is drift. */
const ON_SCALE_SPACING = /\b(?:4|8|12|16|24|32|48|64)px\b/;

/** A font size the type scale can express exactly. */
const ON_SCALE_FONT_SIZE =
  /\b(?:12|14|16|18|20|24|30)px\b|\b(?:0\.75|0\.875|1|1\.125|1\.25|1\.5|1\.875)rem\b/;

/** Type-scale tokens, so the message can name the one a size would become. */
const FONT_SIZE_TOKENS: Record<string, string> = {
  '12px': 'xs',
  '0.75rem': 'xs',
  '14px': 'sm',
  '0.875rem': 'sm',
  '16px': 'md',
  '1rem': 'md',
  '18px': 'lg',
  '1.125rem': 'lg',
  '20px': 'xl',
  '1.25rem': 'xl',
  '24px': '2xl',
  '1.5rem': '2xl',
  '30px': '3xl',
  '1.875rem': '3xl',
};

/** Spacing tokens, so the message can name the step a value would become. */
const SPACING_TOKENS: Record<string, string> = {
  '4px': '1',
  '8px': '2',
  '12px': '3',
  '16px': '4',
  '24px': '6',
  '32px': '8',
  '48px': '12',
  '64px': '16',
};

/** A colour written as a CSS keyword instead of a role token (`transparent` and co. are fine). */
const NAMED_COLOUR =
  /(['"`])(?:white|black|silver|gray|grey|red|maroon|yellow|olive|lime|green|aqua|teal|blue|navy|fuchsia|purple)\1/i;

/** A font stack written inline instead of naming a family token. */
const INLINE_FONT_STACK = /fontFamily\s*:\s*(['"`])([^'"`]*)\1/;

/** Font-family values that are CSS keywords or a token reference rather than a choice of typeface. */
function isFamilyKeywordOrToken(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return CSS_KEYWORDS.has(trimmed) || trimmed.includes('var(--warsha-');
}

/**
 * Scan one app source for R6 violations.
 *
 * Apps are not this package: they have no typed helpers, so a design value reaches the screen as a
 * `var(--warsha-…)` custom property. That reference is exactly what is allowed; a literal standing
 * in for one is what fails. Off-scale values are deliberately not offences — the migration brief
 * says to leave a value that the token scale cannot express rather than force it, so flagging those
 * would make the rule lie about what the tree can fix.
 *
 * @param source the file contents
 * @returns every offending line, in file order
 */
export function scanAppForLiterals(source: string): Offence[] {
  const offences: Offence[] = [];

  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      const add = (offence: string) => offences.push({ line: index + 1, offence });

      const colour = line.match(COLOUR_LITERAL);
      if (colour) {
        add(
          `hardcoded colour \`${colour[0]}\` (use a token reference: 'var(--warsha-color-accent)', …)`
        );
      }

      const named = line.match(NAMED_COLOUR);
      if (named) {
        add(
          `hardcoded colour \`${named[0].slice(1, -1)}\` (use a token reference: 'var(--warsha-color-surface)', …)`
        );
      }

      // Only the value of a spacing declaration counts: `borderRadius` on the same line is a radius
      // decision, and the components in this package may set one there.
      for (const declaration of line.matchAll(SPACING_DECLARATION)) {
        const spacing = declaration[1].match(ON_SCALE_SPACING);
        if (!spacing) continue;
        const step = SPACING_TOKENS[spacing[0]];
        add(
          `hardcoded spacing \`${spacing[0]}\` (use \`var(--warsha-space-${step})\`; a value off the 4px scale may stay a pixel)`
        );
      }

      for (const declaration of line.matchAll(FONT_SIZE_DECLARATION)) {
        const size = declaration[1].match(ON_SCALE_FONT_SIZE);
        if (!size) continue;
        const token = FONT_SIZE_TOKENS[size[0]];
        add(`hardcoded font size \`${size[0]}\` (use \`var(--warsha-font-size-${token})\`)`);
      }

      const stack = line.match(INLINE_FONT_STACK);
      if (stack && !isFamilyKeywordOrToken(stack[2])) {
        add(
          `hardcoded font family \`${stack[2]}\` (use \`var(--warsha-font-sans)\` or \`var(--warsha-font-mono)\`)`
        );
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

describe('R6 app drift', () => {
  it('reads both app sources, so the rule cannot pass by scanning nothing', () => {
    const files = appSourceFiles();

    expect(files).toContain('apps/desktop/src/App.tsx');
    expect(files).toContain('apps/remote/src/App.tsx');
    expect(files.filter((file) => file.startsWith('apps/desktop/src/')).length).toBeGreaterThan(20);
    expect(files.filter((file) => file.startsWith('apps/remote/src/')).length).toBeGreaterThan(0);
    // A test file asserts what renders; it is not a design decision, and this package's own
    // scanner skips them for the same reason.
    expect(files.some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
  });

  it('finds no colour, spacing or type literal in either app', () => {
    const offenders: string[] = [];
    for (const file of appSourceFiles()) {
      for (const { line, offence } of scanAppForLiterals(readFileSync(join(REPO_ROOT, file), 'utf8'))) {
        offenders.push(`R6: ${file}:${line} ${offence}`);
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('catches a planted violation of every app rule', () => {
    const planted = [
      "backgroundColor: '#2563eb',",
      "color: 'white',",
      "padding: '16px',",
      "gap: '8px',",
      "fontSize: '0.875rem',",
      "fontFamily: 'Inter, sans-serif',",
    ].join('\n');

    const offences = scanAppForLiterals(planted).map((entry) => entry.offence);

    expect(offences).toHaveLength(6);
    expect(offences[0]).toContain('hardcoded colour `#2563eb`');
    expect(offences[1]).toContain('hardcoded colour `white`');
    expect(offences[2]).toContain('hardcoded spacing `16px`');
    expect(offences[2]).toContain('var(--warsha-space-4)');
    expect(offences[3]).toContain('hardcoded spacing `8px`');
    expect(offences[4]).toContain('hardcoded font size `0.875rem`');
    expect(offences[4]).toContain('var(--warsha-font-size-sm)');
    expect(offences[5]).toContain('hardcoded font family `Inter, sans-serif`');
  });

  it('accepts a token reference, a keyword, and a value the scale cannot express', () => {
    expect(
      scanAppForLiterals(
        [
          "backgroundColor: 'var(--warsha-color-surface)',",
          "padding: 'var(--warsha-space-4)',",
          "fontSize: 'var(--warsha-font-size-sm)',",
          "fontFamily: 'var(--warsha-font-mono)',",
          "border: '1px solid var(--warsha-color-border)',",
          "color: 'transparent',",
          "fontFamily: 'inherit',",
          // Off the 4px scale and off the type scale: the brief says leave these, not force them.
          "gap: '18px',",
          "marginTop: '40px',",
          "fontSize: '0.8125rem',",
        ].join('\n')
      )
    ).toEqual([]);
  });

  it('does not scan comments as if they rendered', () => {
    expect(
      scanAppForLiterals([
        '// the accent is #FFD60A on #0E0E0E',
        '/* padding: 16px used to live here */',
      ].join('\n'))
    ).toEqual([]);
  });
});
