// @warsha/remote — the stylesheet's own guarantees (docs/design/REDESIGN.md §9, §10, §12).
//
// `index.css` is outside R6's scan (`docs/ARCH_RULES.md`: it reads `.ts`/`.tsx` only), so the four things
// that file is solely responsible for — logical properties, the phone's breakpoints, the token vocabulary
// and the direction's ban on gradients and glows — are policed here instead of in review. A CSS rule is
// the one place a physical `left` can silently break Arabic, and a stylesheet is the one place a `px`
// stops being a token.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'index.css'), 'utf8');
const CHROME = readFileSync(join(__dirname, 'chrome.tsx'), 'utf8');

describe('the stylesheet loads the design system', () => {
  it('imports the tokens once, so every var() it references resolves', () => {
    expect(CSS).toContain("@import '@warsha/ui/tokens/tokens.css'");
    // Imported once, at the top: a second import is a second copy of every custom property.
    expect(CSS.match(/@import/g)?.filter((entry) => entry === '@import')).toHaveLength(1);
  });

  it('names no colour of its own', () => {
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?)\s*\(/);
  });

  it('keeps the direction ban on gradients and glows', () => {
    expect(CSS).not.toMatch(/linear-gradient|radial-gradient|conic-gradient/);
    expect(CSS).not.toMatch(/filter:\s*(?:drop-shadow|blur)/);
    // The bench's only shadow is the gate card's, and `@warsha/ui` paints that one.
    expect(CSS).not.toMatch(/box-shadow:/);
  });
});

describe('the layout mirrors', () => {
  it('uses logical properties only', () => {
    for (const physical of [
      /\bmargin-left\b/,
      /\bmargin-right\b/,
      /\bpadding-left\b/,
      /\bpadding-right\b/,
      /\bborder-left\b/,
      /\bborder-right\b/,
      /(?:^|[\s{])left\s*:/m,
      /(?:^|[\s{])right\s*:/m,
      /\btext-align:\s*(?:left|right)\b/,
    ]) {
      expect(CSS, `a physical direction property matches ${physical}`).not.toMatch(physical);
    }

    // …and the logical ones are the ones actually used.
    expect(CSS).toMatch(/padding-inline:/);
    expect(CSS).toMatch(/border-inline-end:/);
    expect(CSS).toMatch(/inset-inline-start:/);
    expect(CSS).toMatch(/border-block-end:/);
    expect(CSS).toMatch(/inline-size:/);
  });

  it('reads the document direction for the Arabic line height', () => {
    expect(CSS).toMatch(/html\[dir='rtl'\]\s+body\s*\{[^}]*line-height:\s*var\(--warsha-line-height-relaxed\)/);
  });
});

describe('the breakpoints (§10)', () => {
  it('is mobile-first and states the three widths the phone, the tablet and the reference desktop need', () => {
    // 320/390 are the default rules, not a query: the narrow layout is the design, the wide ones are added.
    expect(CSS).toMatch(/@media \(max-width: 359px\)/);
    expect(CSS).toMatch(/@media \(min-width: 768px\)/);
    expect(CSS).toMatch(/@media \(min-width: 1024px\)/);
    expect(CSS).toMatch(/@media \(min-width: 1440px\)/);
  });

  it('gives the wide bench the 1100px document measure and the rails the token widths', () => {
    expect(CSS).toMatch(/max-inline-size:\s*1100px/);
    expect(CSS).toMatch(/inline-size:\s*var\(--warsha-size-rail\)/);
    expect(CSS).toMatch(/inline-size:\s*var\(--warsha-size-rail-compact\)/);
  });
});

describe('the accessibility floors (§9)', () => {
  it('draws one focus ring, from the theme’s own alias', () => {
    expect(CSS).toMatch(
      /:focus-visible\s*\{\s*outline:\s*var\(--warsha-size-inscribe\) solid var\(--warsha-focus-ring\)/
    );
    // The light-theme accent alone measured 1.35:1 and failed; the alias is the fix, and it must stay.
    expect(CSS).not.toMatch(/outline:[^;]*--warsha-color-accent\)/);
  });

  it('keeps every interactive floor at the touch token', () => {
    // Where a link is styled by this file, it asks for the 44px floor by token, not by number.
    expect(CSS).toMatch(/min-block-size:\s*var\(--warsha-size-touch\)/);
    // Where a control comes from `@warsha/ui`, it carries `.warsha-control` and `tokens.css` raises it
    // under `pointer: coarse` — the shell must not invent a second floor.
    expect(CSS).toMatch(/\.app-nav-item\s*\{/s);
    expect(CSS).not.toMatch(/min-block-size:\s*4[0-9]px/);
  });

  it('never lets a long machine value widen the page', () => {
    expect(CSS).toMatch(/overflow-x:\s*hidden/);
    expect(CSS).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('the phone nav keeps its words whole', () => {
  it('declares white-space: nowrap on the nav item, so a tab label cannot break mid-word', () => {
    // The property, not the rule: pull the declaration body of the base `.app-nav-item` rule and require
    // `white-space: nowrap` inside it. `overflow-wrap: anywhere` here would split `البوّابات` and leave an
    // orphan `ت` beside the lit lamp — so the base rule must pin the word to one line.
    const base = CSS.match(/\.app-nav-item\s*\{([^}]*)\}/);
    expect(base, 'the base `.app-nav-item` rule is missing').not.toBeNull();
    // Evaluate the declarations only: the block's own comment quotes the property it retired, and a
    // comment is not a declaration. Strip `/* … */` so the negative check reads the rules that ship.
    const body = base?.[1].replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).toMatch(/white-space:\s*nowrap\b/);
    // And it must not reintroduce the mid-word breaker it replaced.
    expect(body).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('sets the same nowrap inline on the label, so it holds however the item is rendered', () => {
    // The CSS rule guards the shipped class; the shell also writes `whiteSpace: 'nowrap'` on the label
    // itself (chrome.tsx), so the word survives even where the class is overridden or absent.
    expect(CHROME).toMatch(/whiteSpace:\s*'nowrap'/);
  });
});
