// e2e — the accessibility and paint invariants both browser apps are held to.
//
// `./layout.ts` answers "is the box geometry sound". This module answers the two questions a
// screenshot cannot: "does an assistive technology see a WCAG 2.1 AA violation" (axe-core) and "can the
// keyboard reach every control without the ring being invisible or the control hidden under the sticky
// composer" (a real Tab walk with a hit-test at every stop).
//
// The rules enforced are the ones `docs/design/REDESIGN.md` §9 locks. The split between gating and
// reporting is deliberate, and it is what makes the evidence readable:
//
//   * **gating** — axe violations carrying a WCAG 2.0/2.1 A or AA tag, every stop of the focus walk,
//     and every clipped text box. Any finding fails the case.
//   * **reporting** — axe's `best-practice` findings and its `incomplete` results come back in the same
//     pass but never fail it: a hint is not an AA requirement, and "could not decide" is not "broken".
//     They are written into the evidence file instead of being switched off, so nothing is quietly
//     hidden.
//
// axe-core is the only library involved, injected from the devDependency's own bundle into the page
// under test. Nothing in the app is instrumented for it, and no rule depends on a network fetch.
//
// Like `./layout.ts`, this file is app-neutral and lives under `apps/desktop/e2e/` (an ESM package) so
// the remote suite imports it by relative path and both apps are held to one definition.
import { createRequire } from 'node:module';

import type { AxeResults, RunOptions } from 'axe-core';
import type { Page } from '@playwright/test';

/**
 * axe-core is CommonJS (`module.exports = axe`, browser bundle in `axe.source`), and Playwright loads
 * these specs as ESM — only the workspace apps declare `"type": "module"`. A namespace import of a CJS
 * module hands back the interop default, which is not where `.source` is guaranteed to live, so the
 * bundle is required explicitly. Resolution walks up from this file to the repo root's `node_modules`,
 * which is where the root devDependency links it.
 */
const requireFromHere = createRequire(import.meta.url);
const axeBundle = requireFromHere('axe-core') as { source: string };

/** The tags that make a rule a WCAG requirement rather than a hint. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/** Every rule set evaluated in one pass; the split into gate and report happens on the tags. */
const AXE_TAGS = [...WCAG_TAGS, 'best-practice'];

/**
 * What is handed to `axe.run`.
 *
 * `resultTypes` asks only for the two buckets this module reads: violations decide the gate, and
 * `incomplete` is reported so an undecidable rule is visible in the evidence rather than absent.
 */
const AXE_RUN_OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: AXE_TAGS },
  resultTypes: ['violations', 'incomplete'],
};

/** One axe rule that found something, flattened into what a failure message and an evidence row need. */
export interface AxeFinding {
  id: string;
  impact: string;
  help: string;
  href: string;
  /** One line per node: the selector axe matched and the failure summary axe wrote for it. */
  nodes: string[];
}

/** What one accessibility pass found. */
export interface A11yAudit {
  /** WCAG A/AA violations — the gate. These must be empty. */
  violations: AxeFinding[];
  /** `best-practice` findings — reported, never gating. */
  advisories: AxeFinding[];
  /** Rules axe could not decide (contrast on a canvas-painted swatch, content it could not reach). */
  incomplete: AxeFinding[];
  /** How many rules did not apply, for the evidence file's "what was actually evaluated" line. */
  inapplicable: number;
  /** How many checks passed, same reason: an audit that found nothing and one that checked nothing */
  passed: number;
}

/** One keyboard stop, as the walk recorded it. */
export interface FocusStop {
  /** `<tag .class "label">` — the same shape `./layout.ts` uses in a failure message. */
  element: string;
  /** Index in the Tab order, from the start of the document. */
  order: number;
  width: number;
  height: number;
  /** Whether a focus indicator is actually drawn at this stop (outline or box-shadow). */
  ring: boolean;
  /** The hit-test at the stop's centre named something outside the focused element's subtree. */
  obscuredBy: string | null;
  /** Part of the box leaves the viewport, so the ring is drawn where the owner cannot see it. */
  outside: string | null;
}

/** What the keyboard walk found. */
export interface FocusAudit {
  /** Every stop in Tab order — the record the evidence file prints. */
  stops: FocusStop[];
  /** Stops with no drawn focus indicator. */
  invisible: string[];
  /** Stops whose box leaves the viewport. */
  outside: string[];
  /** Stops covered by another element (a sticky composer, a decision bar, an overlay). */
  obscured: string[];
  /** The element the first Tab lands on, so a regression in the entry point is visible. */
  first: string | null;
}

/** What the clip pass found. */
export interface ClipAudit {
  /** Text cut by its own box with no `title`/`aria-label` carrying the full value. */
  clipped: string[];
  /** Boxes that scroll on purpose (a diff pane, a tab strip) — reported, not gated. */
  scrollers: string[];
}

/** The gate decision for an axe pass. */
export function axeIsClean(audit: A11yAudit): boolean {
  return audit.violations.length === 0;
}

/** The gate decision for a focus walk. */
export function focusIsClean(audit: FocusAudit): boolean {
  return audit.invisible.length === 0 && audit.outside.length === 0 && audit.obscured.length === 0;
}

/** The gate decision for a clip pass. */
export function clipsAreClean(audit: ClipAudit): boolean {
  return audit.clipped.length === 0;
}

/** The page-side surface of `window.axe`, narrow enough that no `any` is needed to read it. */
interface AxeWindow {
  axe: { run(context: Document, options: RunOptions): Promise<AxeResults> };
}

/**
 * Run axe in a page and split what it found into the gate and the report.
 *
 * The bundle is injected per page (Playwright gives every case a fresh one) and the run is scoped to
 * the whole document — chrome included, because a violation in the top bar is still one the owner meets.
 */
export async function runAxe(page: Page): Promise<A11yAudit> {
  await page.addScriptTag({ content: axeBundle.source });

  const raw = await page.evaluate(
    async (input: {
      options: RunOptions;
      wcagTags: string[];
    }): Promise<{
      violations: { id: string; impact: string; help: string; href: string; wcag: boolean; nodes: string[] }[];
      incomplete: { id: string; impact: string; help: string; href: string; wcag: boolean; nodes: string[] }[];
      inapplicable: number;
      passed: number;
    }> => {
      const axeGlobal = (globalThis as unknown as { axe?: AxeWindow['axe'] }).axe;
      if (axeGlobal === undefined) throw new Error('the axe bundle did not load into the page');

      const results = await axeGlobal.run(document, input.options);

      const shape = (list: AxeResults['violations']) =>
        list.map((rule) => ({
          id: rule.id,
          impact: rule.impact ?? 'unknown',
          help: rule.help,
          href: rule.helpUrl,
          wcag: (rule.tags ?? []).some((tag) => input.wcagTags.includes(tag)),
          nodes: rule.nodes.map((node) => {
            const target = node.target.length > 0 ? node.target.join(' ') : '(no selector)';
            return `${target} — ${node.failureSummary ?? rule.help}`;
          }),
        }));

      return {
        violations: shape(results.violations),
        incomplete: shape(results.incomplete),
        inapplicable: results.inapplicable.length,
        passed: results.passes.length,
      };
    },
    { options: AXE_RUN_OPTIONS, wcagTags: [...WCAG_TAGS] }
  );

  const toFinding = (finding: (typeof raw.violations)[number]): AxeFinding => ({
    id: finding.id,
    impact: finding.impact,
    help: finding.help,
    href: finding.href,
    nodes: finding.nodes,
  });

  return {
    violations: raw.violations.filter((finding) => finding.wcag).map(toFinding),
    advisories: raw.violations.filter((finding) => !finding.wcag).map(toFinding),
    incomplete: raw.incomplete.map(toFinding),
    inapplicable: raw.inapplicable,
    passed: raw.passed,
  };
}

/** Everything a failing axe pass says, one rule per line, nodes indented under it. */
export function describeAxe(audit: A11yAudit): string {
  return audit.violations
    .map(
      (finding) =>
        `${finding.id} [${finding.impact}] ${finding.help}\n` +
        finding.nodes.map((node) => `    ${node}`).join('\n')
    )
    .join('\n');
}

/** The hints and undecidables, formatted for the evidence file rather than for a failure. */
export function describeAxeReport(audit: A11yAudit): string {
  const parts = [
    ...audit.advisories.map((finding) => `best-practice ${finding.id}: ${finding.nodes.length} node(s)`),
    ...audit.incomplete.map((finding) => `incomplete ${finding.id}: ${finding.nodes.length} node(s)`),
  ];
  return parts.length > 0 ? parts.join('; ') : `none (${audit.passed} checks passed)`;
}

/** What one stop looks like, measured inside the page where the element lives. */
interface RawStop {
  element: string;
  ring: boolean;
  obscuredBy: string | null;
  outside: string | null;
  width: number;
  height: number;
}

/**
 * Describe the element that currently holds focus, and whether it is a good stop.
 *
 * Kept as a standalone function because Playwright serialises it into the page: nothing here may close
 * over a Node-side value.
 */
function describeFocusedStop(): { stop: RawStop | null; cycleComplete: boolean } {
  const active = document.activeElement as HTMLElement | null;

  // Back at the document itself: the walk has come all the way round.
  if (active === null || active === document.body || active === document.documentElement) {
    return { stop: null, cycleComplete: true };
  }

  const style = getComputedStyle(active);
  const rect = active.getBoundingClientRect();

  const describe = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    const testId = element.getAttribute('data-testid');
    const firstClass =
      typeof element.className === 'string' && element.className !== ''
        ? `.${element.className.split(/\s+/)[0] ?? ''}`
        : '';
    const anchor = testId !== null ? `[${testId}]` : firstClass;
    const label = (element.getAttribute('aria-label') ?? '').trim();
    const text = label !== '' ? label : (element.textContent ?? '').trim().replace(/\s+/g, ' ');
    return `<${tag}${anchor}> "${text.slice(0, 40)}"`;
  };

  // §9: one global `:focus-visible` at 2px solid. An author who replaces the outline owes a shadow.
  const outlineWidth = Number.parseFloat(style.outlineWidth);
  const ring =
    (style.outlineStyle !== 'none' && Number.isFinite(outlineWidth) && outlineWidth > 0) ||
    (style.boxShadow !== '' && style.boxShadow !== 'none');

  // The centre of the part of the box that is on screen: a control pushed under a sticky strip has to
  // be hit-tested where the owner can actually see it, not at the hidden geometric centre.
  const visibleLeft = Math.max(rect.left, 0);
  const visibleRight = Math.min(rect.right, window.innerWidth);
  const visibleTop = Math.max(rect.top, 0);
  const visibleBottom = Math.min(rect.bottom, window.innerHeight);

  let obscuredBy: string | null = null;
  if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
    const hit = document.elementFromPoint((visibleLeft + visibleRight) / 2, (visibleTop + visibleBottom) / 2);
    if (hit === null) {
      obscuredBy = '(nothing hit at that point)';
    } else if (hit !== active && !active.contains(hit) && !hit.contains(active)) {
      obscuredBy = describe(hit);
    }
  }

  const tolerance = 1;
  let outside: string | null = null;

  // A reading inside a deliberate horizontal scroller (a rail that lies down at 390, a settings tab
  // strip, a diff pane) is wider than the viewport by design and the owner scrolls to it — the same
  // exemption `./layout.ts` gives the overflow check, applied here so a tab stop in a scroller is not
  // reported as a control nobody can see. A box outside a scroller, however, really is off screen.
  const scrollsInside = ((): boolean => {
    for (let node: HTMLElement | null = active.parentElement; node !== null; node = node.parentElement) {
      const ancestor = getComputedStyle(node);
      if (ancestor.overflowX === 'auto' || ancestor.overflowX === 'scroll') return true;
    }
    return false;
  })();

  if (!scrollsInside && rect.width > 0 && rect.height > 0) {
    if (rect.left < -tolerance) outside = `starts at ${Math.round(rect.left)}px, before the viewport`;
    else if (rect.right > window.innerWidth + tolerance)
      outside = `ends at ${Math.round(rect.right)}px, past the ${window.innerWidth}px viewport`;
    // §9 is about the ring being *seen*, not the whole box fitting. A tall region (a document body, a
    // log) can legitimately run past the bottom edge while its ring is drawn at the top; what is a
    // defect is a stop with nothing of it inside the viewport at all — pushed below the fold by the
    // scroll, or up under the sticky chrome.
    else if (rect.bottom <= tolerance)
      outside = `ends ${Math.round(-rect.bottom)}px above the viewport — nothing of it is on screen`;
    else if (rect.top >= window.innerHeight - tolerance)
      outside = `starts ${Math.round(rect.top - window.innerHeight)}px below the fold, and the scroll left it there`;
  }

  return {
    stop: {
      element: describe(active),
      ring,
      obscuredBy,
      outside,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    },
    cycleComplete: false,
  };
}

/**
 * Walk the page with the keyboard and report every stop that fails REDESIGN §9.
 *
 * The walk starts from a blurred document, which is how the owner arrives: the first Tab must land on
 * the first control rather than on whatever a click left focused. `maxStops` bounds the loop, so a page
 * whose focus never returns to the document fails with a count instead of hanging the suite.
 */
export async function auditFocusWalk(
  page: Page,
  options: { maxStops?: number } = {}
): Promise<FocusAudit> {
  const maxStops = options.maxStops ?? 400;

  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  const stops: FocusStop[] = [];

  for (let order = 1; order <= maxStops; order += 1) {
    await page.keyboard.press('Tab');
    const { stop, cycleComplete } = await page.evaluate(describeFocusedStop);
    if (stop === null || cycleComplete) break;
    stops.push({ ...stop, order });
  }

  const label = (stop: FocusStop, reason: string): string => `#${stop.order} ${stop.element} ${reason}`;

  return {
    stops,
    first: stops.length > 0 ? stops[0].element : null,
    invisible: stops.filter((stop) => !stop.ring).map((stop) => label(stop, 'has no focus ring')),
    outside: stops.filter((stop) => stop.outside !== null).map((stop) => label(stop, stop.outside ?? '')),
    obscured: stops
      .filter((stop) => stop.obscuredBy !== null)
      .map((stop) => label(stop, `is covered by ${stop.obscuredBy ?? ''}`)),
  };
}

/** One line per focus problem. */
export function describeFocus(audit: FocusAudit): string {
  return [...audit.invisible, ...audit.outside, ...audit.obscured].join('\n');
}

/**
 * Find text cut off by its own box with no alternative carrying the whole value.
 *
 * A deliberate scroller (`overflow-x: auto` on a diff pane or a tab strip) passes: the hidden part is
 * reachable. A box clipped with `overflow: hidden` does not, unless the element or an ancestor names
 * the full value in `title` / `aria-label` / `aria-describedby`, which is what REDESIGN §11 requires of
 * a truncating ledger row.
 */
export async function auditClipping(page: Page, rootSelector: string): Promise<ClipAudit> {
  return page.evaluate(
    ({ selector }: { selector: string }): ClipAudit => {
      const clipped: string[] = [];
      const scrollers: string[] = [];
      const root = document.querySelector(selector) ?? document.body;

      const describe = (element: Element): string => {
        const tag = element.tagName.toLowerCase();
        const testId = element.getAttribute('data-testid');
        const firstClass =
          typeof element.className === 'string' && element.className !== ''
            ? `.${element.className.split(/\s+/)[0] ?? ''}`
            : '';
        const anchor = testId !== null ? `[${testId}]` : firstClass;
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        return `<${tag}${anchor}> "${text}"`;
      };

      const namesFullValue = (element: Element): boolean => {
        for (let node: Element | null = element; node !== null; node = node.parentElement) {
          if (node.hasAttribute('title')) return true;
          if ((node.getAttribute('aria-label') ?? '').trim() !== '') return true;
          if ((node.getAttribute('aria-describedby') ?? '').trim() !== '') return true;
          if (node === root) return false;
        }
        return false;
      };

      const scrollsAbove = (element: Element): boolean => {
        for (let node: Element | null = element.parentElement; node !== null; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (
            style.overflowX === 'auto' ||
            style.overflowX === 'scroll' ||
            style.overflowY === 'auto' ||
            style.overflowY === 'scroll'
          ) {
            return true;
          }
          if (node === root) return false;
        }
        return false;
      };

      for (const node of Array.from(root.querySelectorAll('*'))) {
        const element = node as HTMLElement;
        const ownsText = Array.from(element.childNodes).some(
          (child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== ''
        );
        if (!ownsText) continue;

        // Hidden by an ancestor (`display: none` on a §10 disclosure) is hidden, whatever this box's own
        // computed `display` says.
        if (typeof element.checkVisibility === 'function' ? !element.checkVisibility() : false) continue;

        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        // A skip link or a visually-hidden label says so with `clip-path`: the text is there for the
        // keyboard and for a screen reader, and it is *meant* not to be read on screen until it is.
        if (style.clipPath !== 'none' && style.clipPath !== '') continue;

        // A box this small with `overflow: hidden` is the accessible-name carrier, not a clip.
        const box = element.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;

        const cutHorizontally = element.scrollWidth > element.clientWidth + 1;
        const cutVertically = element.scrollHeight > element.clientHeight + 1;
        if (!cutHorizontally && !cutVertically) continue;

        const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
        const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';

        if (((clipsX && cutHorizontally) || (clipsY && cutVertically)) && !namesFullValue(element)) {
          clipped.push(
            `${describe(element)} cut at ${element.scrollWidth}×${element.scrollHeight} inside ` +
              `${element.clientWidth}×${element.clientHeight} (overflow: ${style.overflowX}/${style.overflowY})`
          );
          continue;
        }

        if (style.overflowX === 'auto' || style.overflowX === 'scroll' || scrollsAbove(element)) {
          scrollers.push(describe(element));
        }
      }

      return { clipped, scrollers };
    },
    { selector: rootSelector }
  );
}

/** One line per clipped box. */
export function describeClips(audit: ClipAudit): string {
  return audit.clipped.join('\n');
}
