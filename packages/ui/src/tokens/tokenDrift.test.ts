// @warsha/ui — R6: token drift prevention (docs/ARCH_RULES.md R6, DS v2 §4.6).
//
// Three things are checked, and all of them fail the build:
//
//   1. No component in this package writes a design value. Colours, lengths, radii, shadows and
//      durations may only reach a component through a typed token helper (`colorVar`, `aliasVar`,
//      `lineVar`, `elevationVar`, `layer`, `size`, `space`, `radius`, `shadow`, `fontSize`,
//      `fontWeight`, `duration`, `easing`), so a literal cannot slip into the product and forget to
//      follow the dark theme. R6.7 extends this to the unitless literals: `fontWeight: 600` and
//      `zIndex: 50` are design values too, and name `fontWeight('semibold')` / `layer('popover')`.
//   2. The TypeScript token layer and `tokens.css` declare exactly the same names with exactly the
//      same values — including which values the dark theme overrides. A token added to one half and
//      forgotten in the other fails here instead of rendering as `var()`-less nothing at runtime.
//      That covers the Bench & Signal families (aliases, sizes) and the DS v2 families (`lines.ts`,
//      `elevation.ts`); `breakpoints.ts` is explicitly exempt because a media query cannot read a
//      custom property.
//   3. The two app sources (`apps/desktop/src/**`, `apps/remote/src/**`) carry no colour, spacing or
//      type literal either. Apps are not this package, so they consume tokens as CSS custom
//      properties (`var(--warsha-color-accent)`) rather than through the typed helpers — the helper
//      import is allowed, the literal is not.
//
// R6 v2 adds the app ratchet (D3): R6.9 counts every `px`/`rem`/`em` length in the apps' `.ts/.tsx/.css`
// (tests and comments excluded) except inside an `@media` prelude whose value is in the breakpoint set,
// and R6.10 counts every literal `var()` fallback. The live count may not grow past `APP_LENGTH_BUDGET`,
// measured at this packet's base; `WARSHA_R6_APP_LENGTH_BUDGET` can only tighten it (`Math.min`). W5
// drives the apps to zero; INT-2 then pins the constant to zero.
//
// Two more things the redesign made worth policing: a raw colour may appear in `tokens.css` only
// inside the two theme blocks — R6.8 checks the selector list *exactly*, so `:root :focus-visible`
// cannot smuggle one — and every exported component — compound or part — has a story, since an
// unstories component is an unviewed one in a package whose review surface is Storybook.
//
// The scanners are themselves tested against a planted violation, the same way
// `scripts/check-arch.mjs --self-test` plants one per architecture rule: a rule that silently
// matches nothing proves nothing.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aliasTokenNames, aliasTokens, aliasVarName } from './aliases';
import { MEDIA_PRELUDE_PX } from './breakpoints';
import { colorTokenNames, colorTokens, colorVarName } from './colors';
import {
  elevationTokenNames,
  elevationTokens,
  elevationVarName,
  layerTokenNames,
  layerTokens,
  layerVarName,
} from './elevation';
import { lineTokenNames, lineTokens, lineVarName } from './lines';
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
import { sizeTokenNames, sizeTokens, sizeVarName } from './sizes';
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
  trackingTokenNames,
  trackingTokens,
  trackingVarName,
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

/**
 * The directories this package renders components from.
 *
 * `components.tsx` holds the four primitives the redesign keeps, `src/components/` holds their stories,
 * and `src/compounds/` holds the Bench & Signal inventory (REDESIGN §6) — a file per component family,
 * so `Ledger` and `Ledger.Row` are read together rather than found in a 2000-line file.
 */
const COMPOUND_DIRECTORY = join(UI_SRC, 'compounds');

/** The files that *are* the component catalog: primitives, compounds, one file per family. */
function componentSources(): string[] {
  const files = [join(UI_SRC, 'components.tsx')];
  for (const entry of readdirSync(join(UI_SRC, 'components'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;
    if (entry.name.includes('.stories.') || entry.name.includes('.test.')) continue;
    files.push(join(UI_SRC, 'components', entry.name));
  }
  for (const entry of readdirSync(COMPOUND_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
    // The barrel only re-exports. `internal.ts` IS scanned (R6.8): it composes the tokens every
    // compound shares, so a literal there would reach twenty components at once. It owes no story —
    // nothing in it renders on its own, and it exports no PascalCase component.
    if (entry.name === 'index.ts' || entry.name.includes('.stories.')) continue;
    files.push(join(COMPOUND_DIRECTORY, entry.name));
  }
  return files.sort();
}

/**
 * Files that render UI and must therefore be literal-free.
 *
 * `storySupport.tsx` is on the list because a story shell is still a rendered surface: if it wrote a
 * hex, every story would inherit the drift. It is not on the component list, because it is not a
 * component.
 */
function componentFiles(): string[] {
  return [...componentSources(), join(UI_SRC, 'storySupport.tsx')];
}

/** Every story file, so "a component without a story" is a failing build too. */
function storyFiles(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(UI_SRC, 'components'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.stories.tsx')) {
      files.push(entry.name.replace('.stories.tsx', ''));
    }
  }
  for (const entry of readdirSync(join(UI_SRC, 'compounds'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.stories.tsx')) {
      files.push(entry.name.replace('.stories.tsx', ''));
    }
  }
  return files.sort();
}

/**
 * Every component name this package exports.
 *
 * Both declaration forms count: `export function Lamp` and `export const Meter` (a compound attaches
 * its parts with `Object.assign`, so the parts travel under the root's name and are not a second
 * export). A `LAMP_STATES`-style constant is not a component and the PascalCase-with-no-underscore
 * shape is what tells them apart. The barrel files are skipped — they only re-export.
 */
function exportedComponents(): string[] {
  const names = new Set<string>();
  for (const file of componentSources()) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/export (?:function|const|class) ([A-Z][A-Za-z0-9]*)\b/g)) {
      // A component is PascalCase — it carries lowercase letters. An all-caps name is a shared
      // constant (`MACHINE`, `PLATE`, `FIELD` in internal.ts), not a renderable thing that owes a story.
      if (!/[a-z]/.test(match[1])) continue;
      names.add(match[1]);
    }
  }
  return [...names].sort();
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

/** R6.7: a unitless weight or layer is still a design value — name the token instead. */
const UNITLESS_WEIGHT_OR_LAYER = /\b(?:fontWeight|zIndex)\s*:\s*\d+\b/;

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

      const unitless = line.match(UNITLESS_WEIGHT_OR_LAYER);
      if (unitless) {
        add(
          `unitless design literal \`${unitless[0]}\` (use fontWeight('semibold') or layer('popover'), R6.7)`
        );
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
  /** The rule's own text, so a scan can see what a *value* says and not only what it names. */
  readonly body: string;
  /** The 1-based line the rule's body starts on, so an offence can be reported. */
  readonly startLine: number;
}

/** Top-level (not inside `@media`) rules, with their custom-property declarations. */
function parseCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const stack: string[] = [];
  const lineStack: number[] = [];
  let buffer = '';
  let line = 1;

  for (const char of css) {
    if (char === '\n') line += 1;

    if (char === '{') {
      stack.push(buffer.trim());
      lineStack.push(line);
      buffer = '';
      continue;
    }
    if (char === '}') {
      const selector = stack.pop() ?? '';
      const startLine = lineStack.pop() ?? line;
      // `stack.length === 0` after the pop means this rule is top-level, so a `@media` wrapper is
      // skipped together with its contents.
      if (stack.length === 0 && selector !== '' && !selector.startsWith('@')) {
        blocks.push({ selector, declarations: parseDeclarations(buffer), body: buffer, startLine });
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

/**
 * R6.8: the only selector lists that may carry a raw colour. Compared exactly (whitespace
 * normalised), so `:root :focus-visible` — which merely *contains* `:root` — is scanned like any
 * other rule instead of inheriting the theme blocks' exemption.
 */
const RAW_COLOUR_SELECTORS = new Set([":root, [data-theme='light']", "[data-theme='dark']"]);

/** Every raw colour declared outside the two exact theme blocks, as report lines. */
export function scanCssRawColours(css: string): Offence[] {
  const offences: Offence[] = [];
  for (const block of parseCssBlocks(stripComments(css))) {
    const selector = block.selector.replace(/\s+/g, ' ').trim();
    if (RAW_COLOUR_SELECTORS.has(selector)) continue;
    const found = block.body.match(COLOUR_LITERAL);
    if (found) {
      offences.push({
        line: block.startLine,
        offence: `raw colour \`${found[0]}\` in \`${block.selector}\` (only the two theme blocks may declare one, R6.8)`,
      });
    }
  }
  return offences;
}

/** Every token name the TypeScript layer declares. `breakpoints.ts` is exempt (TS only, §4.5). */
function declaredByTypeScript(): Set<string> {
  const names = new Set<string>();
  for (const name of colorTokenNames) names.add(colorVarName(name));
  for (const name of aliasTokenNames) names.add(aliasVarName(name));
  for (const name of lineTokenNames) names.add(lineVarName(name));
  for (const name of elevationTokenNames) names.add(elevationVarName(name));
  for (const name of layerTokenNames) names.add(layerVarName(name));
  for (const step of SPACING_STEPS) names.add(spacingVarName(step));
  for (const name of sizeTokenNames) names.add(sizeVarName(name));
  for (const name of radiusTokenNames) names.add(radiusVarName(name));
  for (const name of shadowTokenNames) names.add(shadowVarName(name));
  for (const name of fontFamilyNames) names.add(fontFamilyVarName(name));
  for (const name of fontSizeNames) names.add(fontSizeVarName(name));
  for (const name of lineHeightNames) names.add(lineHeightVarName(name));
  for (const name of fontWeightNames) names.add(fontWeightVarName(name));
  for (const name of trackingTokenNames) names.add(trackingVarName(name));
  for (const name of durationNames) names.add(durationVarName(name));
  for (const name of easingNames) names.add(easingVarName(name));
  return names;
}

describe('R6 token drift', () => {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  // Comments are prose: they name tokens ("`--warsha-focus-ring` is the AUDIT-1 fix") without declaring
  // them. Parsing them as CSS would both invent declarations and bury selectors inside a comment block.
  const blocks = parseCssBlocks(stripComments(css));
  /** The theme blocks are the ones carrying declarations; `:root :focus-visible` also names `:root`. */
  const withTokenCount = (selectorTest: (selector: string) => boolean) =>
    blocks.find((block) => selectorTest(block.selector) && block.declarations.size > 0);
  const lightBlock = withTokenCount((selector) => selector.includes(':root'));
  const darkBlock = withTokenCount((selector) => selector.includes("[data-theme='dark']"));

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
    const exported = exportedComponents();
    const stories = storyFiles().map((name) => name.replace('.stories.tsx', ''));

    // There has to be something to check: a barrel that exports nothing would pass by being empty.
    expect(exported.length).toBeGreaterThanOrEqual(20);

    // A story file covers its own component *and its parts*: `Ledger.stories.tsx` is where
    // `Ledger.Row` is demonstrated, because a part without its compound is not a renderable thing.
    const covered = (name: string) =>
      stories.some(
        (story) => name === story || (name.startsWith(story) && /^[A-Z]/.test(name.slice(story.length)))
      );
    expect(exported.filter((name) => !covered(name))).toEqual([]);

    // The reverse is deliberate: the story set carries foundations entries (`Tokens`) that no
    // component exports, and those are a review surface rather than a component.
    expect(stories).toContain('Tokens');
  });

  it('keeps every raw colour inside the two exact theme blocks (REDESIGN §12, R6.8)', () => {
    const offenders = scanCssRawColours(css).map(
      ({ line, offence }) => `R6: packages/ui/src/tokens/tokens.css:${line} ${offence}`
    );
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('R6.8 fires on a raw colour under :root :focus-visible and stays clean on the theme blocks', () => {
    // The loophole this closes: a selector that merely *contains* `:root` used to inherit the
    // theme blocks' exemption, so a focus rule could hard-code the ring colour.
    const planted = ":root :focus-visible { outline: 2px solid #ff0000; }";
    const fired = scanCssRawColours(planted);
    expect(fired).toHaveLength(1);
    expect(fired[0].offence).toContain('#ff0000');
    expect(fired[0].offence).toContain(':root :focus-visible');

    const clean = [
      ":root, [data-theme='light'] { --warsha-color-accent: #ffd60a; }",
      "[data-theme='dark'] { --warsha-color-bg: #0e0e0e; }",
      ':root :focus-visible { outline: var(--warsha-size-inscribe) solid var(--warsha-focus-ring); }',
    ].join('\n');
    expect(scanCssRawColours(clean)).toEqual([]);
  });

  it('gives every semantic alias the light and dark value the TypeScript layer carries', () => {
    for (const name of aliasTokenNames) {
      const varName = aliasVarName(name);
      expect(declared(lightBlock, varName), varName).toBe(normalise(aliasTokens[name].light));
      expect(declared(darkBlock, varName), varName).toBe(normalise(aliasTokens[name].dark));
    }
  });

  it('resolves every alias to a token that exists, in both themes', () => {
    const colourVarNames = new Set(colorTokenNames.map(colorVarName));
    for (const name of aliasTokenNames) {
      for (const theme of ['light', 'dark'] as const) {
        for (const reference of aliasTokens[name][theme].matchAll(/var\((--warsha-[\w-]+)\)/g)) {
          expect(colourVarNames.has(reference[1]), `${name} (${theme}) → ${reference[1]}`).toBe(true);
        }
      }
    }
  });

  it('names the focus ring and the signal, because the direction depends on them', () => {
    // REDESIGN §9/§12: the ring is `accent-strong` on light (5.03:1 on `bg`) and `accent` on dark; the
    // lamp is the accent with ink on it. If either flips, the AUDIT-1 defect is back.
    const ref = (name: keyof typeof colorTokens) => `var(${colorVarName(name)})`;
    expect(aliasTokens.focusRing.light).toBe(ref('accentStrong'));
    expect(aliasTokens.focusRing.dark).toBe(ref('accent'));
    expect(aliasTokens.signal.light).toBe(ref('accent'));
    expect(aliasTokens.signalInk.light).toBe(ref('accentInk'));
    expect(aliasTokens.signalText.light).toBe(ref('accentStrong'));
    expect(aliasTokens.signalText.dark).toBe(ref('accent'));
    expect(aliasTokens.lampWorking.light).toBe(ref('accentStrong'));
    expect(aliasTokens.lampWorking.dark).toBe(ref('accent'));
    expect(aliasTokens.lampWaiting.light).toBe(ref('accent'));
  });

  it('gives the bench sizes the values the TypeScript layer carries', () => {
    for (const name of sizeTokenNames) {
      expect(declared(lightBlock, sizeVarName(name)), sizeVarName(name)).toBe(
        normalise(sizeTokens[name])
      );
    }
    // The two accessibility floors are the reason this family exists; a typo here is a silent WCAG
    // failure, so it is pinned by value as well as by drift.
    expect(sizeTokens.touch).toBe('44px');
    expect(sizeTokens.inscribe).toBe('2px');
    expect(sizeTokens.rule).toBe('1px');
  });

  it('declares every line in both theme blocks with identical text (cascade rule, §4.1)', () => {
    // A line references themed custom properties; declared only on :root it would freeze the light
    // colours into a dark subtree themed on an inner element (Storybook's decorator does exactly that).
    for (const name of lineTokenNames) {
      const varName = lineVarName(name);
      expect(declared(lightBlock, varName), varName).toBe(normalise(lineTokens[name]));
      expect(declared(darkBlock, varName), varName).toBe(normalise(lineTokens[name]));
    }
  });

  it('declares both elevations in both theme blocks, and the layers once, unitless (§4.4)', () => {
    for (const name of elevationTokenNames) {
      const varName = elevationVarName(name);
      expect(declared(lightBlock, varName), varName).toBe(normalise(elevationTokens[name]));
      expect(declared(darkBlock, varName), varName).toBe(normalise(elevationTokens[name]));
    }
    for (const name of layerTokenNames) {
      const varName = layerVarName(name);
      expect(declared(lightBlock, varName), varName).toBe(layerTokens[name]);
      expect(layerTokens[name]).toMatch(/^\d+$/);
      // A layer is not a theme decision: the dark block must not re-declare it.
      expect(declared(darkBlock, varName), varName).toBeUndefined();
    }
  });

  it('keeps breakpoints out of the stylesheet (TS only, §4.5)', () => {
    // A media query cannot read a custom property, so a `--warsha-breakpoint-*` declaration would be
    // a token nothing can consume. The name-set parity test above already excludes the module; this
    // pins the exemption from the CSS side.
    const declaredNames = blocks.flatMap((block) => [...block.declarations.keys()]);
    expect(declaredNames.filter((name) => name.includes('breakpoint'))).toEqual([]);
  });

  it('gives the loop durations the values the TypeScript layer carries', () => {
    // A lamp breathes and a skeleton shimmers with these, and `tokens.css` zeroes them with the rest.
    expect(declared(lightBlock, durationVarName('breathe')), 'breathe').toBe(durations.breathe);
    expect(declared(lightBlock, durationVarName('shimmer')), 'shimmer').toBe(durations.shimmer);
  });

  it('declares the one global focus rule, in the ring token, not in a colour', () => {
    const focusRules = blocks.filter((block) => block.selector.includes(':focus-visible'));
    expect(focusRules).toHaveLength(1);
    const focusRule = focusRules[0];
    // Scoped under `:root` so it outranks the app-level rings AUDIT-1 §1.3 found, at equal specificity.
    expect(focusRule.selector).toContain(':root');
    expect(focusRule.body).toContain('var(--warsha-focus-ring)');
    expect(focusRule.body).toContain('outline-offset');
  });

  it('keeps permitted motion inside the stylesheet and out of the components (§8)', () => {
    const animations = blocks
      .filter((block) => block.body.includes('animation'))
      .map((block) => block.selector);
    expect(animations).toEqual([]);

    const cssWithoutComments = stripComments(css);
    expect(cssWithoutComments).toContain('@keyframes warsha-lamp-breathe');
    expect(cssWithoutComments).toContain('@keyframes warsha-skeleton-slide');
    expect(cssWithoutComments).toContain('prefers-reduced-motion: no-preference');
    // Nothing that moves is allowed to be decorative: these are the only three loops in the file.
    expect(cssWithoutComments.match(/animation:/g) ?? []).toHaveLength(3);
  });

  it('catches a planted violation of every rule', () => {
    const planted = [
      "backgroundColor: '#2563eb',",
      "padding: '12px',",
      'marginLeft: auto,',
      "fontFamily: 'Inter, sans-serif',",
      "border: '1px solid var(--warsha-color-border)',",
      "color: cssVar('color-accent'),",
      'fontWeight: 600,',
      'zIndex: 50,',
    ].join('\n');

    const offences = scanForLiterals(planted).map((entry) => entry.offence);

    expect(offences.some((entry) => entry.startsWith('hardcoded colour'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('hardcoded length'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('physical direction'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('hardcoded font family'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('raw token name'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('untyped `cssVar('))).toBe(true);
    // R6.7: the unitless pair is a design value too.
    expect(offences.some((entry) => entry.startsWith('unitless design literal `fontWeight: 600`'))).toBe(true);
    expect(offences.some((entry) => entry.startsWith('unitless design literal `zIndex: 50`'))).toBe(true);
  });

  it('accepts a component that only uses helpers', () => {
    expect(
      scanForLiterals(
        "backgroundColor: colorVar('accent'), paddingInline: space(4), fontWeight: fontWeight('semibold'), zIndex: layer('popover'),"
      )
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
    for (const name of trackingTokenNames) {
      expect(declared(lightBlock, trackingVarName(name)), trackingVarName(name)).toBe(
        trackingTokens[name]
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

/**
 * Every `.ts`/`.tsx`/`.css` file the two apps render from, for the R6.9/R6.10 ratchet.
 *
 * Wider than `appSourceFiles()` in one axis: the ratchet reads stylesheets too, because R6's original
 * app scan never read `.css` and that is where the unpolicied lengths accumulated (DS v2 §0). Test
 * files stay excluded — an assertion names a rendered value, it is not a design decision.
 */
export function appRatchetFiles(): string[] {
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(relative);
        continue;
      }
      if (!/\.(ts|tsx|css)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      files.push(relative);
    }
  };

  for (const directory of APP_DIRECTORIES) walk(directory);
  return files.sort();
}

/** R6.9: every absolute length the ratchet counts. Percentages and unitless numbers are layout. */
const APP_LENGTH = /\b\d*\.?\d+(?:px|rem|em)\b/g;

/** An `@media` prelude: the one place a px literal is allowed, and only at a breakpoint value. */
const MEDIA_PRELUDE = /@media[^{]*/g;

/** R6.10: a `var()` reference with a fallback. A fallback that is itself a `var()` is not a literal. */
const VAR_FALLBACK = /var\(\s*--warsha-[\w-]+\s*,\s*([^)]*)\)/g;

/** True when a prelude length is one of the breakpoint px values (`breakpoints.ts` derives the set). */
function isMediaPreludeExempt(literal: string): boolean {
  if (!literal.endsWith('px')) return false;
  return MEDIA_PRELUDE_PX.includes(Number(literal.slice(0, -2)));
}

/**
 * Scan one app source for the ratchet offences (R6.9 lengths + R6.10 literal `var()` fallbacks).
 *
 * Counting is one offence per literal occurrence, with one deliberate deduplication: a length inside
 * a literal fallback (`var(--warsha-size-inscribe, 4px)`) is counted once, as the R6.10 offence — the
 * fallback is the defect, and the `4px` is part of it, not a second decision. Comments never render;
 * an `@media` prelude may keep the breakpoint literals because a media query cannot read a custom
 * property (§4.5). A non-breakpoint value in a prelude is an offence like any other.
 */
export function scanAppLengths(source: string): Offence[] {
  const offences: Offence[] = [];
  let text = stripComments(source);

  const lineAt = (index: number): number => text.slice(0, index).split('\n').length;

  text = text.replace(VAR_FALLBACK, (match, fallback: string, offset: number) => {
    if (fallback.trim().startsWith('var(')) return match;
    offences.push({
      line: lineAt(offset),
      offence: `literal var() fallback \`${match}\` (the token is always defined; drop the fallback, R6.10)`,
    });
    // Blank the whole reference so the fallback's own length is not counted a second time.
    return match.replace(/[^\n]/g, ' ');
  });

  text = text.replace(MEDIA_PRELUDE, (prelude) =>
    prelude.replace(APP_LENGTH, (literal) =>
      isMediaPreludeExempt(literal) ? ' '.repeat(literal.length) : literal
    )
  );

  for (const match of text.matchAll(APP_LENGTH)) {
    offences.push({
      line: lineAt(match.index ?? 0),
      offence: `hardcoded length \`${match[0]}\` (use a --warsha-size-* / --warsha-space-* token, R6.9)`,
    });
  }

  return offences.sort((a, b) => a.line - b.line);
}

describe('R6 app length ratchet (R6.9/R6.10)', () => {
  /**
   * The live offence count measured at W3's base (0772d502002562505c6438ae712abca7a7328d84):
   * 142 R6.9 lengths + 3 R6.10 literal fallbacks. The full list is in the packet report. W5 drives
   * the apps to zero against `WARSHA_R6_APP_LENGTH_BUDGET=0`; INT-2 then pins this constant to 0.
   * The env var can only tighten the budget, never raise it (D3).
   */
  const APP_LENGTH_BUDGET = 145;

  it('holds the live app length count to the ratchet budget', () => {
    const offences: string[] = [];
    for (const file of appRatchetFiles()) {
      for (const { line, offence } of scanAppLengths(readFileSync(join(REPO_ROOT, file), 'utf8'))) {
        offences.push(`R6: ${file}:${line} ${offence}`);
      }
    }
    const envBudget = Number(process.env.WARSHA_R6_APP_LENGTH_BUDGET);
    const budget = Number.isFinite(envBudget) ? Math.min(APP_LENGTH_BUDGET, envBudget) : APP_LENGTH_BUDGET;
    expect(offences.length, offences.join('\n')).toBeLessThanOrEqual(budget);
  });

  it('reads both app sources including stylesheets, so the rule cannot pass by scanning nothing', () => {
    const files = appRatchetFiles();
    expect(files).toContain('apps/desktop/src/index.css');
    expect(files).toContain('apps/remote/src/index.css');
    expect(files.some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
    expect(files.filter((file) => file.endsWith('.css')).length).toBeGreaterThanOrEqual(2);
  });

  it('R6.9 fires on a planted length and stays clean on tokens', () => {
    const planted = ["padding: '16px',", "fontSize: '0.875rem',", "letterSpacing: '0.2em',"].join('\n');
    const offences = scanAppLengths(planted);
    expect(offences).toHaveLength(3);
    expect(offences[0].offence).toContain('hardcoded length `16px`');
    expect(offences[1].offence).toContain('hardcoded length `0.875rem`');
    expect(offences[2].offence).toContain('hardcoded length `0.2em`');

    expect(
      scanAppLengths("padding: 'var(--warsha-space-4)', maxWidth: 'var(--warsha-size-plate-max)',")
    ).toEqual([]);
  });

  it('R6.9 exempts breakpoint @media preludes and fires on any other prelude value', () => {
    // The exemption set is exactly {359, 767, 768, 1023, 1024, 1440}px (§4.5).
    for (const px of [359, 767, 768, 1023, 1024, 1440]) {
      expect(scanAppLengths(`@media (max-width: ${px}px) { .x { display: none; } }`), `${px}`).toEqual([]);
    }
    // A non-breakpoint prelude value must fire…
    const planted = scanAppLengths('@media (max-width: 800px) { .x { display: none; } }');
    expect(planted).toHaveLength(1);
    expect(planted[0].offence).toContain('hardcoded length `800px`');
    // …and a length in a declaration inside an exempt prelude is still an offence.
    const inside = scanAppLengths('@media (max-width: 767px) { .x { padding: 4px; } }');
    expect(inside).toHaveLength(1);
    expect(inside[0].offence).toContain('hardcoded length `4px`');
    // A rem/em value in a prelude is not a breakpoint literal either.
    expect(scanAppLengths('@media (max-width: 48rem) { .x { display: none; } }')).toHaveLength(1);
  });

  it('R6.10 fires on a literal fallback, once, and accepts a token reference', () => {
    const planted = scanAppLengths("padding: 'var(--warsha-space-4, 16px)',");
    expect(planted).toHaveLength(1);
    expect(planted[0].offence).toContain('literal var() fallback');
    expect(planted[0].offence).toContain('var(--warsha-space-4, 16px)');

    const colour = scanAppLengths("color: 'var(--warsha-color-text, #111827)',");
    expect(colour).toHaveLength(1);
    expect(colour[0].offence).toContain('R6.10');

    expect(
      scanAppLengths("color: 'var(--warsha-color-text)', padding: 'var(--warsha-x, var(--warsha-y))',")
    ).toEqual([]);
  });

  it('does not scan comments as if they rendered', () => {
    expect(
      scanAppLengths(['// padding: 16px used to live here', '/* @media (max-width: 800px) */'].join('\n'))
    ).toEqual([]);
  });
});
