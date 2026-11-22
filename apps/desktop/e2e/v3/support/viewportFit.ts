import type { Page } from '@playwright/test';

/**
 * Does the page fit the viewport it was opened in?
 *
 * The layout audit (`../../support/layout.ts`) measures boxes inside the screen; it does not ask the
 * cheapest question of all — whether the page is wider than the window. The 2026-11-10 review found
 * every 390x844 Workbench capture unusable with no audit failing: the rail kept its 264px, the screen
 * was squeezed to a clipped strip, and the document scrolled sideways with nobody reading `scrollWidth`.
 *
 * This audit closes that hole for v3. It is deliberately about *the page*, not a component:
 *
 *   * the document and `main` must not overflow horizontally (`scrollWidth <= clientWidth`),
 *   * `main` must keep a phone-width floor (320px) at a 390px viewport,
 *   * the frame's brand title must lie inside the viewport (the review found it touching the
 *     inline-start edge in every capture).
 *
 * Values are measured in the page; nothing here reads a design token or a literal from the app.
 */
export interface ViewportFitAudit {
  /** The width the document claims it needs, minus the width it has. `0` is clean. */
  documentOverflow: number;
  /** `main`'s horizontal overflow, or `null` when the document has no `main`. */
  mainOverflow: number | null;
  /** `main`'s border-box width, or `null` when the document has no `main`. */
  mainWidth: number | null;
  /** The brand title's horizontal span, or `null` when the page paints no brand. */
  brand: { left: number; right: number } | null;
  /** One sentence per defect, in document order. Empty means the page fits. */
  problems: string[];
}

export interface ViewportFitOptions {
  /** The phone-width floor `main` must keep. Defaults to 320px (the design's 320 floor). */
  minMainWidth?: number;
}

/** Pure reader for tests and callers: the page fits when nothing was reported. */
export function viewportFitIsClean(audit: ViewportFitAudit): boolean {
  return audit.problems.length === 0;
}

/** Every problem on its own line, for a failure message. */
export function describeViewportFit(audit: ViewportFitAudit): string {
  return audit.problems.join('\n');
}

export async function auditViewportFit(
  page: Page,
  options: ViewportFitOptions = {}
): Promise<ViewportFitAudit> {
  const minMainWidth = options.minMainWidth ?? 320;

  return page.evaluate(
    ({ floor }: { floor: number }): ViewportFitAudit => {
      const viewportWidth = window.innerWidth;
      const problems: string[] = [];

      const overflowOf = (element: HTMLElement): number =>
        Math.max(0, element.scrollWidth - element.clientWidth);

      const documentOverflow = Math.max(
        overflowOf(document.documentElement),
        document.body ? overflowOf(document.body) : 0
      );
      if (documentOverflow > 1) {
        problems.push(
          `the document is ${documentOverflow}px wider than the ${viewportWidth}px viewport (it scrolls sideways)`
        );
      }

      const main = document.querySelector<HTMLElement>('main');
      let mainOverflow: number | null = null;
      let mainWidth: number | null = null;
      if (main !== null) {
        mainOverflow = overflowOf(main);
        const rect = main.getBoundingClientRect();
        mainWidth = Math.round(rect.width * 10) / 10;
        if (mainOverflow > 1) {
          problems.push(
            `main is ${mainOverflow}px wider than its box (one of its children overflows it)`
          );
        }
        // A phone-width floor only applies where the viewport itself can seat it.
        const expectedFloor = Math.min(floor, viewportWidth);
        if (rect.width + 0.5 < expectedFloor) {
          problems.push(
            `main is ${mainWidth}px wide at a ${viewportWidth}px viewport (floor ${expectedFloor}px)`
          );
        }
      } else {
        problems.push('the document renders no main landmark');
      }

      const brand = document.querySelector<HTMLElement>('.v3-frame-brand');
      let brandSpan: { left: number; right: number } | null = null;
      if (brand !== null) {
        const rect = brand.getBoundingClientRect();
        brandSpan = { left: Math.round(rect.left), right: Math.round(rect.right) };
        if (rect.width > 0 && (rect.left < -0.5 || rect.right > viewportWidth + 0.5)) {
          problems.push(
            `the brand title spans ${Math.round(rect.left)}..${Math.round(rect.right)}px in a ${viewportWidth}px viewport (it is cut at an edge)`
          );
        }
      }

      return { documentOverflow, mainOverflow, mainWidth, brand: brandSpan, problems };
    },
    { floor: minMainWidth }
  );
}
