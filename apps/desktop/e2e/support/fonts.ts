// e2e — proof that a screenshot was taken with the design's real fonts.
//
// `docs/design/REDESIGN.md` §11 makes the split semantic: IBM Plex Sans Arabic carries prose and
// labels, IBM Plex Mono carries machine data. §14 records that the B1 mockups could not prove it,
// because the capture host had no Plex installed and the screenshots rendered through the token
// stack's fallbacks. A baseline taken that way is a picture of the wrong metrics, which makes every
// other assertion in this suite worth less than it looks.
//
// This module settles it in the browser instead of in prose. Chromium answers
// `CSS.getPlatformFontsForNode` over CDP with the face it *actually used* to lay the text out — not
// the declared stack — so the claim becomes "the pixels on this page were drawn with IBM Plex".
//
// The two jobs are separated on purpose:
//
//   * **selection** is by declaration: the element whose computed `font-family` asks for the sans
//     stack is the prose probe, and the one that asks for the mono stack is the machine-data probe;
//   * **verification** is by usage: chromium's own platform-font report has to name Plex for both.
//
// A canvas measurement runs alongside as the metrics cross-check: an installed family measures
// differently from a name nothing resolves to, so equal widths mean the request fell through and the
// "real metrics" claim would be false.
//
// The capture host has the families installed system-wide from the official OFL sources (see
// `bridge-io/audit/visual.md`). Nothing here is vendored into the app: the shipped bundle carries no
// font bytes, so `THIRD_PARTY_NOTICES.md` needs no font row.
import type { Page } from '@playwright/test';

/** The two families the design system names, in the roles §11 gives them. */
export const SANS_FAMILY = 'IBM Plex Sans Arabic';
export const MONO_FAMILY = 'IBM Plex Mono';

/** The attribute the probes are marked with, removed again before the page is measured. */
const PROBE_ATTRIBUTE = 'data-warsha-font-probe';

/** Which of the two roles a probed box is expected to be drawn with. */
export type FontRole = 'sans' | 'mono';

/** One font chromium reported using for one probe. */
export interface UsedFont {
  family: string;
  glyphs: number;
}

/** One probe's result. */
export interface FontProbeResult {
  role: FontRole;
  /** The marked selector, or the screen root when nothing on this screen declared the role. */
  matched: string;
  /** The text that was measured, so a failure names the words rather than the pixel. */
  text: string;
  fonts: UsedFont[];
  /** The face §11 requires was among the ones chromium drew with. */
  usedDesignFace: boolean;
  /** No element on this screen declares that stack, so there is nothing to verify. */
  absent: boolean;
}

/** What the font pass found on one page. */
export interface FontAudit {
  probes: FontProbeResult[];
  /** The problems: a probe that drew with a fallback, or a page with no prose at all. */
  problems: string[];
  /** Glyph-coverage notes: a run Plex is not expected to carry. Reported, never gating. */
  notes: string[];
  /** The canvas cross-check: the width of one probe string per family. */
  metrics: Record<string, number>;
}

/**
 * Families that mean "Plex was not there".
 *
 * These are the names further down `--warsha-font-sans` / `--warsha-font-mono` (`Noto Sans Arabic`,
 * `Segoe UI`, `Inter`, `Cascadia Code`, `SFMono-Regular`, `Menlo`, `Consolas`) plus the faces a Linux
 * box substitutes when none of those exist either (`DejaVu*`, `Liberation*`, `Ubuntu`, `FreeSans`). A
 * page drawn with any of them is drawn with fallback metrics.
 */
const FALLBACK_FAMILIES = [
  'Noto Sans Arabic',
  'Segoe UI',
  'Inter',
  'Cascadia Code',
  'SFMono-Regular',
  'Menlo',
  'Consolas',
  'DejaVu',
  'Liberation',
  'Ubuntu',
  'FreeSans',
];

/** The probe string the canvas cross-check measures: Latin and Arabic, so both scripts weigh in. */
const METRICS_PROBE = 'Warsha ٢ runs — 0123456789';

/** What the page-side marking step reports: which selectors got marked, and why not if they did not. */
interface MarkedProbes {
  sans: MarkedProbe | null;
  mono: MarkedProbe | null;
}

/** One marked probe: the selector the harness can now ask chromium about, and the text it carries. */
interface MarkedProbe {
  selector: string;
  /** The first characters of the run, so a failure names the words that fell back. */
  text: string;
}

/**
 * Mark one prose element and one machine-data element per screen.
 *
 * `CSS.getPlatformFontsForNode` answers for the text an element lays out itself, not for its subtree,
 * so the probe needs a leaf. Which leaf is found by declaration: the first visible element whose
 * computed stack leads with the family being asked about. The marking is one attribute on two
 * elements; it carries no style, and it is removed before anything else is measured.
 *
 * Everything this needs — the attribute name included — arrives as an argument, because Playwright
 * serialises the function alone and a module-scope constant does not exist inside the page.
 */
function markProbeElements(input: {
  rootSelector: string;
  sans: string;
  mono: string;
  attribute: string;
}): MarkedProbes {
  const root = document.querySelector(input.rootSelector) ?? document.body;

  const ownsText = (element: Element): boolean =>
    Array.from(element.childNodes).some(
      (child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== ''
    );

  const isDrawn = (element: Element): boolean => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  };

  /** Does the element's resolved stack lead with this family? (A mono stack is not a sans one.) */
  const leadsWith = (element: Element, family: string): boolean => {
    const stack = getComputedStyle(element).fontFamily;
    const first = stack.slice(0, stack.indexOf(',') === -1 ? stack.length : stack.indexOf(','));
    return first.includes(family);
  };

  const mark = (family: string, tag: string): MarkedProbe | null => {
    const candidates: Element[] = [];
    if (ownsText(root)) candidates.push(root);
    candidates.push(...Array.from(root.querySelectorAll('*')));

    // The representative run of each role, not the first one: a mono line that happens to carry a single
    // glyph Plex does not have (an em dash, a `·`) would otherwise be the whole verdict for the screen.
    // Longest own-text wins, and ties go to the first in document order so the choice is deterministic.
    let best: Element | null = null;
    let bestLength = 0;
    for (const element of candidates) {
      if (!ownsText(element) || !isDrawn(element) || !leadsWith(element, family)) continue;
      const length = (element.textContent ?? '').trim().length;
      if (length > bestLength) {
        best = element;
        bestLength = length;
      }
    }
    if (best === null) return null;
    best.setAttribute(input.attribute, tag);
    return {
      selector: `[${input.attribute}="${tag}"]`,
      text: (best.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48),
    };
  };

  return { sans: mark(input.sans, 'sans'), mono: mark(input.mono, 'mono') };
}

/**
 * Measure what the page was really drawn with.
 *
 * @param page a page that has finished rendering
 * @param rootSelector the screen root the prose is looked for under
 */
export async function auditUsedFonts(page: Page, rootSelector: string): Promise<FontAudit> {
  const marked = await page.evaluate(markProbeElements, {
    rootSelector,
    sans: SANS_FAMILY,
    mono: MONO_FAMILY,
    attribute: PROBE_ATTRIBUTE,
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });

  const probes: FontProbeResult[] = [];
  const problems: string[] = [];
  const notes: string[] = [];

  for (const role of ['sans', 'mono'] as const) {
    const markedProbe = marked[role];
    if (markedProbe === null) {
      // Nothing on this screen declares the mono stack, so there is no machine data to verify. A
      // screen with no prose at all is different, and that one is a problem.
      if (role === 'sans') problems.push(`no drawn text under ${rootSelector} asks for ${SANS_FAMILY}`);
      probes.push({
        role,
        matched: rootSelector,
        text: '',
        fonts: [],
        usedDesignFace: false,
        absent: role === 'mono',
      });
      continue;
    }

    const { selector, text } = markedProbe;
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (nodeId === 0) {
      problems.push(`${role}: the marked probe (${selector}) is gone from the document`);
      probes.push({ role, matched: selector, text, fonts: [], usedDesignFace: false, absent: false });
      continue;
    }

    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const used: UsedFont[] = fonts.map((font) => ({ family: font.familyName, glyphs: font.glyphCount }));
    const wanted = role === 'sans' ? SANS_FAMILY : MONO_FAMILY;
    const usedDesignFace = used.some((font) => font.family.includes(wanted));
    probes.push({ role, matched: selector, text, fonts: used, usedDesignFace, absent: false });

    if (used.length === 0) {
      problems.push(`${role} probe (${selector}) "${text}": chromium laid out no text in it`);
      continue;
    }
    if (usedDesignFace) continue;

    // Glyph coverage is not metrics. IBM Plex Mono carries no Arabic and no dingbats, so a mono run
    // that is only `✗`, `·` or an em dash has nothing for Plex to draw and falls back by design. §11's
    // rule is that *machine data* — ids, commands, numbers — is mono, and that is what the probe
    // measures (the longest run of real characters per role). Recorded, never a failure; the day a word
    // falls back it stops being punctuation and the case fails.
    if (!/[A-Za-z\u00C0-\u024F\u0600-\u06FF0-9]/.test(text)) {
      notes.push(
        `${role} probe "${text}" is punctuation only → ${used
          .map((font) => `${font.family} ×${font.glyphs}`)
          .join(', ')} (glyph coverage, not metrics)`
      );
      continue;
    }

    const drawnWith = used.map((font) => `${font.family} ×${font.glyphs}`).join(', ');
    const why = FALLBACK_FAMILIES.some((family) => used.some((font) => font.family.includes(family)))
      ? 'a fallback from the token stack'
      : 'a face the token stack does not name';
    problems.push(
      `${role} probe "${text}" (${selector}) asked for "${wanted}" and was drawn with ${why}: ${drawnWith}`
    );
  }

  const metrics = await page.evaluate(
    ({ probe, sans, mono }): Record<string, number> => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context === null) return {};
      const widthOf = (family: string): number => {
        context.font = `16px "${family}"`;
        return Math.round(context.measureText(probe).width * 100) / 100;
      };
      return {
        [sans]: widthOf(sans),
        [mono]: widthOf(mono),
        'no such family': widthOf('Warsha Does Not Exist Family'),
        serif: widthOf('serif'),
      };
    },
    { probe: METRICS_PROBE, sans: SANS_FAMILY, mono: MONO_FAMILY }
  );

  const unknown = metrics['no such family'] ?? 0;
  for (const family of [SANS_FAMILY, MONO_FAMILY]) {
    const width = metrics[family] ?? 0;
    if (width === 0 || width === unknown) {
      problems.push(
        `canvas metrics: "${family}" measured ${width}px — the same as a family that does not exist, ` +
          'so it is not installed on this host and the screenshots would carry fallback metrics'
      );
    }
  }

  // The attributes are the harness's own; leave nothing behind for a later measurement to trip on.
  await page.evaluate((attribute: string) => {
    for (const element of Array.from(document.querySelectorAll(`[${attribute}]`))) {
      element.removeAttribute(attribute);
    }
  }, PROBE_ATTRIBUTE);

  return { probes, problems, notes, metrics };
}

/** One line per problem. */
export function describeFonts(audit: FontAudit): string {
  return audit.problems.join('\n');
}

/** The glyph-coverage notes, for the evidence file. */
export function describeFontNotes(audit: FontAudit): string {
  return audit.notes.join('\n');
}

/** The whole pass, formatted for the evidence file: every probe and what it drew with. */
export function formatFonts(audit: FontAudit): string {
  const lines = audit.probes.map((probe) => {
    if (probe.absent) return `n/a  ${probe.role}: no element on this screen declares that stack`;
    return `${probe.usedDesignFace ? 'ok  ' : 'FAIL'} ${probe.role} (${probe.matched}) — ${
      probe.fonts.length > 0 ? probe.fonts.map((font) => `${font.family} ×${font.glyphs}`).join(', ') : '(no text)'
    }`;
  });
  const metrics = Object.entries(audit.metrics).map(([family, width]) => `${family}=${width}px`);
  return [...lines, `metrics: ${metrics.join(' ')}`].join('\n');
}

/**
 * The message a failing host has to answer.
 *
 * Deliberately concrete: this gate is only worth having if a machine that cannot pass it is told the
 * one thing it has to do, rather than being handed a pixel diff.
 */
export const FONT_INSTALL_HINT =
  `the capture host must have ${SANS_FAMILY} and ${MONO_FAMILY} installed (official OFL 1.1 sources: ` +
  'google/fonts `ofl/ibmplexsansarabic` and `ofl/ibmplexmono`, Regular/Medium/SemiBold/Bold). ' +
  'On a Debian-family host: put the .ttf files in /usr/local/share/fonts/warsha-capture and run ' +
  '`fc-cache -f`; verify with `fc-list | grep -i plex`. The fonts are not vendored into the app, and ' +
  'vendoring them would need a license review that updates THIRD_PARTY_NOTICES.md first.';
