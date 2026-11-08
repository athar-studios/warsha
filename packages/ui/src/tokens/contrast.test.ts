// @warsha/ui — measured contrast: the numbers REDESIGN §9 promises, computed instead of asserted.
//
// The direction locks its accessibility claims to measured pairs ("`text/bg` 17.0/17.7;
// `text-muted/surface` 4.83/7.11; `accent-ink/accent` 13.67"), and a claim copied into a comment is a claim
// nobody re-measures. This file computes WCAG 2.1's relative-luminance ratio (the formula in
// `bridge-io/audit/a11y.md` §5.1) over the *token layer's own values*, for both themes, and fails the build
// when a pair drops under the threshold its use needs: 4.5:1 for normal text, 3.0:1 for large text and for
// the non-text things that carry information (a focus ring, a meter fill, a stamp's border).
//
// Aliases are resolved through to a colour first (`aliasResolvesTo`), so the test measures what the bench
// paints — `signalText` in light really means `accentStrong`, and if an alias were ever repointed at
// `muted`, this is where it would be caught.
//
// Two documented exemptions, both the direction's own decisions rather than accidents:
//
//   * `muted` is demoted to non-text use (§9). At 2.54:1 on `surface` it cannot carry a word, and this file
//     asserts that no *text* pair in the table below uses it.
//   * `benchEdge` (the control border) sits at 1.47:1 on a light plate. A raw colour cannot be invented here
//     (§12), so a Warsha field is identified by its persistent `<label>`, its fill difference and the 2px
//     focus ring — all of which clear 3:1 — rather than by the border alone. Recorded in the report as the
//     one edge the token palette cannot strengthen.

import { describe, expect, it } from 'vitest';

import { aliasResolvesTo, aliasTokenNames, aliasTokens } from './aliases';
import { colorTokens } from './colors';
import { kebabCase } from './vars';

/** A hex string, as the token layer carries it: `#rrggbb`, or `#rrggbbaa` for the scrim (DS v2 §4.2). */
type Hex = string;

/** The alpha channel of a hex colour; 1 for the opaque `#rrggbb` form. */
function alphaOf(hex: Hex): number {
  const value = hex.replace('#', '');
  return value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
}

/**
 * Composite an `#rrggbbaa` colour over an opaque background, channel-wise (CSS source-over), and
 * return the opaque `#rrggbb` result. This is how the parser accepts the scrim: a translucent colour
 * has no luminance of its own, only the one it makes over the plate it covers.
 */
export function compositeOver(hex: Hex, background: Hex): Hex {
  const value = hex.replace('#', '');
  const base = background.replace('#', '');
  const alpha = alphaOf(hex);
  const channels = [0, 2, 4].map((offset) => {
    const foreground = parseInt(value.slice(offset, offset + 2), 16);
    const backdrop = parseInt(base.slice(offset, offset + 2), 16);
    return Math.round(foreground * alpha + backdrop * (1 - alpha));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2.1 §relative luminance, on sRGB 8-bit channels. */
function luminance(hex: Hex): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const byte = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast ratio of a foreground against a background, always ≥ 1. */
export function contrast(foreground: Hex, background: Hex): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The kebab segment `tokens.css` writes back to the camelCase key the TypeScript layer carries. */
function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** One token's value for one theme, after following every alias to the colour it names. */
function paint(name: string, theme: 'light' | 'dark'): Hex {
  let value: Hex;
  if (name in aliasTokens) {
    const resolved = aliasResolvesTo(name as keyof typeof aliasTokens, theme);
    const colour = camelCase(resolved);
    // A derived alias (the signal wash) is a mix, not a second colour: measured against its own base.
    value =
      colour in colorTokens
        ? colorTokens[colour as keyof typeof colorTokens][theme]
        : colorTokens.accent[theme];
  } else if (name in colorTokens) {
    value = colorTokens[name as keyof typeof colorTokens][theme];
  } else {
    throw new Error(`contrast: '${name}' is not a colour token or an alias`);
  }
  // The scrim is the one translucent token: composite it over the page background it covers (§4.2).
  return alphaOf(value) < 1 ? compositeOver(value, colorTokens.bg[theme]) : value;
}

/** The kind of threshold a pair has to clear. */
type Use = 'text' | 'large-text' | 'non-text';

const THRESHOLD: Record<Use, number> = { text: 4.5, 'large-text': 3, 'non-text': 3 };

interface Pair {
  /** Why this pair exists in the bench, so a failure names the component it breaks. */
  readonly why: string;
  readonly foreground: string;
  readonly background: string;
  readonly use: Use;
}

/**
 * Every colour relationship the compounds actually paint, both themes, one table. A component that needs a
 * new pair adds it here first — that is the gate, not a reviewer's memory.
 */
const PAIRS: Pair[] = [
  { why: 'body text on the page', foreground: 'text', background: 'bg', use: 'text' },
  { why: 'body text on a raised plate', foreground: 'text', background: 'surface', use: 'text' },
  { why: 'body text on a recessed bench plate', foreground: 'text', background: 'benchPlate', use: 'text' },
  { why: 'rail row meta on a plate', foreground: 'text', background: 'benchPlate', use: 'text' },
  { why: 'secondary copy on a raised plate', foreground: 'textMuted', background: 'surface', use: 'text' },
  { why: 'secondary copy on the page', foreground: 'textMuted', background: 'bg', use: 'text' },
  // B4 added the pair below. The bench paints an unselected `ModeSwitch`/`Segmented` label, a stream line
  // and a `TerminalDock` hint on the recessed plate, and this table only ever carried `textMuted` on a
  // plate at the non-text threshold — so the token passed the gate while axe measured the painted word at
  // 4.39:1. A word on a plate is a text pair, whatever the plate is.
  { why: 'an unselected control-group label on a recessed plate', foreground: 'textMuted', background: 'benchPlate', use: 'text' },
  { why: 'the lit lamp carries ink, never white', foreground: 'signalInk', background: 'signal', use: 'text' },
  { why: 'the signal as text (rail edge, link, stage word)', foreground: 'signalText', background: 'bg', use: 'text' },
  { why: 'the signal as text on a raised plate', foreground: 'signalText', background: 'surface', use: 'text' },
  { why: 'an inverted chip: the page shows through the word', foreground: 'bg', background: 'text', use: 'text' },
  { why: 'a gate stamp, ok', foreground: 'lampOk', background: 'surface', use: 'text' },
  { why: 'a gate stamp, fail', foreground: 'lampFail', background: 'surface', use: 'text' },
  { why: 'a field error, the provider 401', foreground: 'error', background: 'surface', use: 'text' },
  { why: 'a passing probe reading', foreground: 'success', background: 'surface', use: 'text' },
  { why: 'a meter over its warning threshold', foreground: 'warning', background: 'surface', use: 'text' },
  { why: 'a diff gutter, added line', foreground: 'success', background: 'diffAddBg', use: 'non-text' },
  { why: 'a diff gutter, removed line', foreground: 'error', background: 'surface', use: 'non-text' },
  { why: 'the focus ring (AUDIT-1 §1.3)', foreground: 'focusRing', background: 'bg', use: 'non-text' },
  { why: 'the focus ring on a raised plate', foreground: 'focusRing', background: 'surface', use: 'non-text' },
  { why: 'a meter fill under its threshold', foreground: 'textMuted', background: 'benchPlate', use: 'non-text' },
  { why: 'a lit meter fill against its track', foreground: 'signalText', background: 'benchPlate', use: 'non-text' },
  { why: 'the selected row’s signal edge on a raised plate', foreground: 'signalText', background: 'surface', use: 'non-text' },
  { why: 'the gate card’s lit band against the page', foreground: 'signalText', background: 'bg', use: 'non-text' },
  // DS v2 §4.2: status ink on its own tint, and body text on every tint, in both themes. The tints are
  // the largest mixes that keep these pairs ≥ 4.5:1 (8% light measured 4.50 on warning — no margin).
  { why: 'a success pill’s ink on its tint', foreground: 'success', background: 'successTint', use: 'text' },
  { why: 'a warning pill’s ink on its tint', foreground: 'warning', background: 'warningTint', use: 'text' },
  { why: 'an error pill’s ink on its tint', foreground: 'error', background: 'errorTint', use: 'text' },
  { why: 'the lamp-as-text on an opaque lamp surface', foreground: 'signalText', background: 'accentTint', use: 'text' },
  { why: 'body text on a success tint', foreground: 'text', background: 'successTint', use: 'text' },
  { why: 'body text on a warning tint', foreground: 'text', background: 'warningTint', use: 'text' },
  { why: 'body text on an error tint', foreground: 'text', background: 'errorTint', use: 'text' },
  { why: 'body text on an accent tint', foreground: 'text', background: 'accentTint', use: 'text' },
  // The stream's gate wash is not in this table on purpose: it is emphasis beside a `☑` glyph and bold text,
  // not the channel that identifies the line, so it is not a 1.4.11 boundary. Same for the diff's added-line
  // wash, whose gutter `+` is the identifying mark.
];

const THEMES = ['light', 'dark'] as const;

describe('WCAG AA contrast of the token layer', () => {
  it('reproduces the ratios REDESIGN §9 measured', () => {
    // The direction's own numbers, re-derived: if a token value moves, this fails before a screen does.
    expect(contrast(paint('text', 'light'), paint('bg', 'light'))).toBeCloseTo(17.0, 1);
    expect(contrast(paint('text', 'dark'), paint('bg', 'dark'))).toBeCloseTo(17.7, 1);
    // `text-muted` on a raised plate was 4.83 when §9 was written. B4 re-pinned the light value to the next
    // step down the same grey ramp so the *recessed* plate clears 4.5:1 too (see the PAIRS note above), and
    // this is the number the token now measures. The dark value is unchanged, so its §9 ratio still holds.
    expect(contrast(paint('textMuted', 'light'), paint('surface', 'light'))).toBeCloseTo(7.56, 1);
    expect(contrast(paint('textMuted', 'dark'), paint('surface', 'dark'))).toBeCloseTo(7.11, 1);
    expect(contrast(paint('signalInk', 'light'), paint('signal', 'light'))).toBeCloseTo(13.67, 1);
  });

  it.each(THEMES)('keeps every pair the compounds paint readable in %s', (theme) => {
    const failures = PAIRS.filter((pair) => {
      const ratio = contrast(paint(pair.foreground, theme), paint(pair.background, theme));
      return ratio < THRESHOLD[pair.use];
    }).map((pair) => {
      const ratio = contrast(paint(pair.foreground, theme), paint(pair.background, theme));
      return `${pair.why} (${pair.foreground}/${pair.background}) = ${ratio.toFixed(2)}:1, needs ${
        THRESHOLD[pair.use]
      }:1`;
    });

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('demotes `muted` to non-text use, the way §9 requires', () => {
    for (const theme of THEMES) {
      const mutedOnSurface = contrast(paint('muted', theme), paint('surface', theme));
      const mutedOnPlate = contrast(paint('muted', theme), paint('benchPlate', theme));

      // `muted` is the idle lamp and the quietest glyph. If it ever clears 4.5:1 the palette changed and the
      // rule below has to change with it — so the rule is asserted, not assumed.
      expect(mutedOnSurface).toBeLessThan(4.5);
      expect(mutedOnPlate).toBeLessThan(4.5);

      // …and no text pair in the table names it.
      expect(PAIRS.filter((pair) => pair.use === 'text').some((pair) => pair.foreground === 'muted')).toBe(
        false
      );
    }
  });

  it('fixes the focus ring AUDIT-1 found broken', () => {
    // The desktop app's ring was bare `accent` on `bg`: 1.35:1, which is not a visible focus indicator.
    const broken = contrast(paint('accent', 'light'), paint('bg', 'light'));
    expect(broken).toBeLessThan(3);

    const fixed = contrast(paint('focusRing', 'light'), paint('bg', 'light'));
    // AUDIT-1 §1.3 reports 5.03:1 for this pair; recomputed from the locked token values it is 4.86:1. Either
    // way it clears 3:1 for a non-text indicator — and 4.5:1, so the same token is safe as text too. The
    // number is asserted at the value this file measures, not at the number a report remembered.
    expect(fixed).toBeGreaterThanOrEqual(4.8);
    expect(contrast(paint('focusRing', 'dark'), paint('bg', 'dark'))).toBeGreaterThanOrEqual(3);
  });

  it('resolves every alias to a real colour, and only through the palette', () => {
    for (const name of aliasTokenNames) {
      for (const theme of THEMES) {
        const resolved = aliasResolvesTo(name, theme);
        // Either a colour token's name, or the one derived value the direction allows.
        const isColourToken = camelCase(resolved) in colorTokens;
        const isWash = resolved.startsWith('color-mix(');
        expect(isColourToken || isWash, `${kebabCase(name)} → ${resolved}`).toBe(true);
      }
    }
  });

  it('never lets the yellow become a background wash', () => {
    // §1: yellow is a lamp, never decoration. The only surface tint in the system is the 12% wash, and it is
    // the same derived value in both themes.
    expect(aliasTokens.signalWash.light).toBe(aliasTokens.signalWash.dark);
    expect(aliasTokens.signalWash.light).toContain('12%');
    // The signal itself is a token, not a mix: a filled lamp, not a wash.
    expect(aliasResolvesTo('signal', 'light')).toBe('accent');
  });

  it('parses #rrggbbaa by compositing over the background (DS v2 §4.2)', () => {
    // Alpha 0x80 is 128/255: black at that alpha over white rounds to #7f7f7f, channel-wise.
    expect(compositeOver('#00000080', '#ffffff')).toBe('#7f7f7f');
    expect(compositeOver('#ffffffff', '#0e0e0e')).toBe('#ffffff');
    expect(compositeOver('#00000000', '#123456')).toBe('#123456');
    // The scrim is `bg` at 55% alpha, so over the page it reads as the page itself — frosts by day,
    // dims by night — and `paint` resolves it through the same composite.
    for (const theme of THEMES) {
      expect(paint('scrim', theme)).toBe(colorTokens.bg[theme]);
    }
  });

  it('keeps the scrim translucent and the tints opaque (DS v2 §4.2)', () => {
    for (const theme of THEMES) {
      const alpha = alphaOf(colorTokens.scrim[theme]);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
      // Tints are stored opaque so this file can measure them; a translucent tint would make every
      // pair above depend on whatever sits behind it.
      for (const tint of ['successTint', 'warningTint', 'errorTint', 'accentTint'] as const) {
        expect(alphaOf(colorTokens[tint][theme]), `${tint}/${theme}`).toBe(1);
      }
    }
  });
});
