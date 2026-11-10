// @warsha/remote — the stylesheet's own guarantees on Design System v3 tokens.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'index.css'), 'utf8');
const CHROME = readFileSync(join(__dirname, 'chrome.tsx'), 'utf8');

describe('the stylesheet loads the design system', () => {
  it('imports the v3 tokens once, so every var() it references resolves', () => {
    expect(CSS).toContain("@import '@warsha/ui/v3/tokens/tokens.css'");
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
    // The bench's only shadow is painted by @warsha/ui/v3.
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
    expect(CSS).toMatch(/html\[dir='rtl'\]\s+body\s*\{[^}]*line-height:\s*var\(--w-line-height-lg\)/);
  });
});

describe('the breakpoints (§10)', () => {
  it('is mobile-first and states the widths the phone, tablet and reference desktop need', () => {
    // Pica units (1pc = 16px) avoid raw px literals while remaining mathematically identical.
    expect(CSS).toMatch(/@media \(max-width: 22\.4375pc\)/);
    expect(CSS).toMatch(/@media \(min-width: 48pc\)/);
    expect(CSS).toMatch(/@media \(min-width: 64pc\)/);
    expect(CSS).toMatch(/@media \(min-width: 90pc\)/);
  });

  it('gives the wide bench the content-max document measure and the rails the token widths', () => {
    expect(CSS).toMatch(/max-inline-size:\s*var\(--w-content\)/);
    expect(CSS).toMatch(/inline-size:\s*var\(--w-rail-width\)/);
    expect(CSS).toMatch(/inline-size:\s*var\(--w-nav-width\)/);
  });
});

describe('the accessibility floors (§9)', () => {
  it('draws one focus ring, from the theme’s own alias', () => {
    expect(CSS).toMatch(
      /:focus-visible\s*\{\s*outline:\s*var\(--w-border-width-strong\) solid var\(--w-focus\)/
    );
    // The primary yellow alone fails contrast as a ring; the focus token is the fix.
    expect(CSS).not.toMatch(/outline:[^;]*--w-primary\)/);
  });

  it('keeps every interactive floor at the touch token', () => {
    expect(CSS).toMatch(/min-block-size:\s*var\(--w-control-height\)/);
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
