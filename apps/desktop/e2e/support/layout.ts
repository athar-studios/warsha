// e2e — the layout invariants both browser apps are held to.
//
// This module is deliberately app-neutral: it takes a page and a root selector, and measures. The
// desktop suite (`../harness.ts`) adds the Tauri and daemon stubs on top; the remote smoke check
// (`apps/remote/e2e/`) imports it by relative path, so both apps are checked against one definition
// of "the tokens are applied and the layout is sound" instead of two that can drift apart.
//
// It lives under `apps/desktop/e2e/`, not in a top-level `e2e/`, because of how the two Node module
// systems meet here: only the workspace *apps* declare `"type": "module"`, and Node's ESM loader
// refuses the named exports of a CommonJS module. A helper at the repo root (CommonJS) therefore
// fails with "Export 'LOCALES' is not defined" the moment a spec imports it — being inside an ESM
// package is what makes the shared helpers importable at all.
//
// It is outside `apps/desktop/src` on purpose: `packages/ui/src/tokens/tokenDrift.test.ts` (R6)
// scans the app source for design-value literals, and a file that measures pixel boxes has no
// business carrying tokens.

/** The two locales both apps ship (`@warsha/i18n`). */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** The two explicit themes (`warsha.theme`). `system` is never used in a check. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The five widths `docs/design/REDESIGN.md` §10 gives the bench a different shape at.
 *
 * `320` is the floor the rails collapse to horizontal strips on, `390` the primary phone, `768` where
 * a rail returns and forms go side-by-side, `1024` where the full bench (and Simple's end panel) fits,
 * and `1440` the reference desktop. The heights are the real device heights so a sticky composer or a
 * decision bar is measured against the screen it actually has to share.
 *
 * The two names carried over from the previous matrix (`1440x900`, `390x844`) are unchanged on purpose:
 * they are part of every stored baseline's file name.
 */
export const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;
export type Viewport = (typeof VIEWPORTS)[number];
export type ViewportName = Viewport['name'];

/** The three widths every screen is measured at: phone, tablet, reference desktop. */
export const CORE_VIEWPORT_NAMES = ['390x844', '768x1024', '1440x900'] as const satisfies readonly ViewportName[];

/** The two extra widths only the screens that change shape at them are photographed at (§10). */
export const EDGE_VIEWPORT_NAMES = ['320x568', '1024x768'] as const satisfies readonly ViewportName[];

/** Every viewport by its name, so a screen can name the widths it changes at. */
const VIEWPORT_BY_NAME = new Map<string, Viewport>(VIEWPORTS.map((viewport) => [viewport.name, viewport]));

/** The viewports for a list of names, in the order given, failing loudly on an unknown name. */
export function viewportsNamed(names: readonly ViewportName[]): readonly Viewport[] {
  return names.map((name) => {
    const viewport = VIEWPORT_BY_NAME.get(name);
    if (viewport === undefined) throw new Error(`no viewport is named "${name}"`);
    return viewport;
  });
}

/** Every problem one case can report. All of them fail the case. */
export interface LayoutAudit {
  /** `var(--warsha-…)` names that are referenced but never declared, or declared and empty. */
  undefinedVars: string[];
  /** Missing background/colour, or the theme attribute not applied. */
  unstyled: string[];
  /** The document scrolls sideways. */
  horizontalScroll: string[];
  /** An element is wider than the viewport and nothing clips it. */
  oversized: string[];
  /** Text-bearing sibling elements whose boxes intersect inside an allow-listed stack. */
  overlaps: string[];
  /** An element that holds its own text but has no box. */
  emptyBoxes: string[];
}

/** True when the audit found nothing. */
export function auditIsClean(audit: LayoutAudit): boolean {
  return Object.values(audit).every((problems) => problems.length === 0);
}

/** One line per problem, for a failure message that says what broke instead of "expected 0, got 3". */
export function describeAudit(audit: LayoutAudit): string {
  const lines: string[] = [];
  for (const [category, problems] of Object.entries(audit)) {
    for (const problem of problems) lines.push(`${category}: ${problem}`);
  }
  return lines.join('\n');
}

/** A page, as far as this module is concerned — kept structural so it needs no Playwright import. */
interface AuditablePage {
  evaluate<Arg, Result>(
    pageFunction: (argument: Arg) => Result,
    argument: Arg
  ): Promise<Result>;
}

/**
 * Measure a screen and report every layout invariant that does not hold.
 *
 * The overlap check uses a deterministic allow-list — the screen root and its parent — rather than
 * an all-pairs comparison over the document: those two elements are exactly where a screen's blocks
 * are stacked, and comparing every pair in the tree would compare elements that are *supposed* to
 * intersect (a label inside its card, a badge inside its row).
 *
 * @param page the page to measure
 * @param rootSelector the screen root
 * @param theme the theme the page was opened with
 */
export async function auditLayout(
  page: AuditablePage,
  rootSelector: string,
  theme: Theme
): Promise<LayoutAudit> {
  return page.evaluate(
    ({ selector, expectedTheme }: { selector: string; expectedTheme: string }): LayoutAudit => {
      const audit: LayoutAudit = {
        undefinedVars: [],
        unstyled: [],
        horizontalScroll: [],
        oversized: [],
        overlaps: [],
        emptyBoxes: [],
      };

      /** Short, stable description of an element for a failure message. */
      const describe = (element: Element): string => {
        const tag = element.tagName.toLowerCase();
        const anchor =
          element.getAttribute('data-testid') ??
          (typeof element.className === 'string' ? element.className : '');
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
        return `<${tag}${anchor !== '' ? ` .${anchor}` : ''}>${text !== '' ? ` "${text}"` : ''}`;
      };

      const round = (value: number): number => Math.round(value * 10) / 10;
      const isOpaque = (colour: string): boolean =>
        colour !== '' && colour !== 'transparent' && colour !== 'rgba(0, 0, 0, 0)';

      /**
       * Is this box actually on screen?
       *
       * `getComputedStyle(el).display` answers `inline-flex` for a span inside a `display: none` strip —
       * the computed value is the element's own, and the ancestor's hiding is not in it. Only
       * `checkVisibility` follows the whole chain, and `checkVisibility` is what §10's progressive
       * disclosure is written in: a reading the phone does not show is *gone*, not "a zero box with
       * words in it". Every geometric check below asks this first, or the disclosure reads as a defect.
       */
      const onScreen = (element: Element): boolean => {
        const html = element as HTMLElement;
        if (typeof html.checkVisibility === 'function') {
          return html.checkVisibility({ opacityProperty: false, visibilityProperty: true });
        }
        const style = getComputedStyle(html);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };

      const root = document.querySelector(selector);
      if (root === null) {
        audit.unstyled.push(`screen root ${selector} is missing`);
        return audit;
      }

      // 1. Every referenced custom property must exist and resolve. A `var()` with no declaration
      //    renders as nothing at all, which is what a missing stylesheet looks like.
      const referenced = new Set<string>();
      const declared = new Set<string>();
      const collect = (text: string | null): void => {
        if (text === null) return;
        for (const match of text.matchAll(/var\(\s*(--warsha-[a-z0-9-]+)/gi)) {
          referenced.add(match[1]);
        }
        for (const match of text.matchAll(/(--warsha-[a-z0-9-]+)\s*:/gi)) declared.add(match[1]);
      };

      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          // A cross-origin sheet cannot be read; nothing this app loads is cross-origin.
          continue;
        }
        if (rules === null) continue;
        for (const rule of Array.from(rules)) collect(rule.cssText);
      }
      for (const element of Array.from(document.querySelectorAll('[style]'))) {
        collect(element.getAttribute('style'));
      }

      const rootStyle = getComputedStyle(document.documentElement);
      for (const name of referenced) {
        if (!declared.has(name) || rootStyle.getPropertyValue(name).trim() === '') {
          audit.undefinedVars.push(name);
        }
      }

      // 2. The stylesheet is applied: a resolved body colour/background, a theme attribute, and a
      //    screen root that inherits a real background from somewhere above it.
      const bodyStyle = getComputedStyle(document.body);
      if (!isOpaque(bodyStyle.backgroundColor)) {
        audit.unstyled.push(`body has no resolved background-color (${bodyStyle.backgroundColor})`);
      }
      if (bodyStyle.color.trim() === '') audit.unstyled.push('body has no resolved color');

      const appliedTheme = document.documentElement.dataset.theme ?? '';
      if (appliedTheme !== expectedTheme) {
        audit.unstyled.push(`data-theme is "${appliedTheme}", expected "${expectedTheme}"`);
      }

      const rootComputed = getComputedStyle(root);
      if (rootComputed.color.trim() === '') {
        audit.unstyled.push(`screen root ${selector} has no resolved color`);
      }
      let background: string | null = null;
      for (let node: Element | null = root; node !== null; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        if (isOpaque(colour)) {
          background = colour;
          break;
        }
      }
      if (background === null) {
        audit.unstyled.push(`screen root ${selector} resolves no background anywhere above it`);
      }

      // 3. Nothing may scroll the document sideways.
      const viewportWidth = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > viewportWidth + 1) {
        audit.horizontalScroll.push(
          `documentElement.scrollWidth ${document.documentElement.scrollWidth} > clientWidth ${viewportWidth}`
        );
      }
      if (document.body.scrollWidth > viewportWidth + 1) {
        audit.horizontalScroll.push(
          `body.scrollWidth ${document.body.scrollWidth} > clientWidth ${viewportWidth}`
        );
      }

      // 4. No element sticks out of the viewport, unless something clips it: a deliberate horizontal
      //    scroller (the projects board) is not a layout defect.
      const isClipped = (element: Element): boolean => {
        for (let node: Element | null = element; node !== null; node = node.parentElement) {
          const overflowX = getComputedStyle(node).overflowX;
          if (
            overflowX === 'auto' ||
            overflowX === 'scroll' ||
            overflowX === 'hidden' ||
            overflowX === 'clip'
          ) {
            return true;
          }
        }
        return false;
      };

      for (const element of Array.from(document.querySelectorAll('body *'))) {
        if (!onScreen(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > viewportWidth + 1 && !isClipped(element)) {
          audit.oversized.push(
            `${describe(element)} is ${round(rect.width)}px wide in a ${viewportWidth}px viewport`
          );
        }
      }

      // 5. Text that exists must occupy a box.
      const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TITLE', 'OPTION', 'NOSCRIPT', 'TEMPLATE']);
      for (const element of Array.from(document.querySelectorAll('body *'))) {
        if (SKIP_TAGS.has(element.tagName)) continue;
        const ownText = Array.from(element.childNodes).some(
          (node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== ''
        );
        if (!ownText) continue;

        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (!onScreen(element)) continue;

        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          audit.emptyBoxes.push(
            `${describe(element)} holds text but is ${round(rect.width)}×${round(rect.height)}`
          );
        }
      }

      // 6. The allow-listed stacks: the screen root and its parent hold the blocks that must not
      //    overlap each other. Positioned overlays are excluded by design.
      const containers: Element[] = [root];
      if (root.parentElement !== null) containers.push(root.parentElement);

      for (const container of containers) {
        const candidates = Array.from(container.children).filter((element) => {
          if (!onScreen(element)) return false;
          const style = getComputedStyle(element);
          if (style.position === 'absolute' || style.position === 'fixed') return false;
          if ((element.textContent ?? '').trim() === '') return false;
          const rect = element.getBoundingClientRect();
          return rect.width >= 1 && rect.height >= 1;
        });

        for (let i = 0; i < candidates.length; i += 1) {
          for (let j = i + 1; j < candidates.length; j += 1) {
            const first = candidates[i].getBoundingClientRect();
            const second = candidates[j].getBoundingClientRect();
            const overlapWidth =
              Math.min(first.right, second.right) - Math.max(first.left, second.left);
            const overlapHeight =
              Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
            if (overlapWidth > 1 && overlapHeight > 1) {
              audit.overlaps.push(
                `${describe(candidates[i])} overlaps ${describe(candidates[j])} by ` +
                  `${round(overlapWidth)}×${round(overlapHeight)}`
              );
            }
          }
        }
      }

      return audit;
    },
    { selector: rootSelector, expectedTheme: theme }
  );
}
