// @warsha/desktop — the layout regression the visual suite exists for.
//
// The desktop app's first screen (Onboarding, language step) stacked a heading, a tagline and a
// label with `marginBottom` and `textAlign` — block-level intent on an inline box. `Text` rendered a
// bare `<span>`, so the vertical margins were dropped and the three runs collapsed onto one line
// with overlapping boxes. A screenshot diff would notice, but only as "pixels changed"; this test
// names the geometry, in a real layout engine, so a regression fails with the numbers that broke.
//
// It also pins the general rule that made the defect possible: a `Text` is a block-level box unless
// the call site asked for `inline`.
import { expect, test } from '@playwright/test';

import { LOCALES, openScreen, THEMES, VIEWPORTS, viewportsNamed, type Locale } from './harness';

/** The one width B4 §7 #6 failed at: the primary phone. */
const PHONE = viewportsNamed(['390x844'])[0];

/** The three `Text` runs on the onboarding language step, in document order. */
const HEADLINE_RUNS = 3;

/** A box's inline edges, as the phone case reads them off the rendered page. */
interface Edges {
  left: number;
  right: number;
}

/** How much sideways content a scroll container is holding, and how much room it has for it. */
interface ScrollRange {
  scrollWidth: number;
  clientWidth: number;
}

/** Everything the settings phone case measures, in one trip into the page. */
interface PhoneBoxes {
  viewport: number;
  area: ScrollRange | null;
  panel: Edges | null;
  control: Edges | null;
  reading: Edges | null;
}

for (const viewport of VIEWPORTS) {
  for (const locale of LOCALES as readonly Locale[]) {
    test(`the onboarding heading stack keeps three separate boxes (${viewport.name}, ${locale})`, async ({
      page,
    }) => {
      // Onboarding is the one screen a deep link cannot open: the shell decides it from
      // `get_config`, so this case answers `onboarding_complete: 'false'` instead.
      await openScreen(page, {
        screen: 'projects',
        viewport,
        locale,
        theme: THEMES[0],
        config: { onboarding_complete: 'false' },
        search: '',
        ready: '.onboarding',
      });

      const card = page.locator('.onboarding > div').first();
      await expect(card).toBeVisible();

      const boxes = await card.locator('span').evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: (element.textContent ?? '').trim(),
            display: getComputedStyle(element).display,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          };
        })
      );

      expect(boxes).toHaveLength(HEADLINE_RUNS);

      for (const box of boxes) {
        // The bug in one assertion: an inline box drops the vertical margins and the centring the
        // screen asked for, and cannot stack.
        expect(box.display, `"${box.text}" is inline and cannot stack`).toBe('block');
        expect(box.height, `"${box.text}" has no height`).toBeGreaterThan(0);
      }

      // Three consecutive lines, not one crammed one: every box ends above the next one starts.
      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1];
        const current = boxes[index];
        expect(
          previous.bottom,
          `"${previous.text}" (ends at ${previous.bottom}) overlaps "${current.text}" (starts at ${current.top})`
        ).toBeLessThanOrEqual(current.top + 1);
      }

      // Each `Text` asked for space below it; a block-level box honours it.
      expect(boxes[1].top - boxes[0].bottom).toBeGreaterThan(0);
    });
  }
}

/**
 * B4 §7 #6 — the settings plate never pushes the screen area sideways.
 *
 * What the gate found and the screenshot hid: at 390 Arabic the eco row's control needed ~404px on one
 * line (the switch's own words plus the mono battery/network reading), and the row pinned that box to its
 * content width, so the plate could not shrink it. `.bench { overflow: hidden }` clipped the difference —
 * the overflow gate read `scrollWidth === clientWidth` and passed — while the screen area, whose
 * `overflow-x: clip` computes to `hidden` beside `overflow-y: auto`, kept a sideways scroll range the RTL
 * scroll origin used: the settings tab panel, a real Tab stop, was measured ending at 404px in a 390px
 * viewport with its focus ring cut at the edge of the owner's screen.
 *
 * So this case measures the boxes, not the document. Four numbers, in both locales so a longer English
 * string cannot quietly bring the shape back:
 *
 *   * the screen area has no sideways scroll range at all — nothing can slide the plate out of view;
 *   * the tab panel's box is inside the viewport, which is what the keyboard walk asks of a stop;
 *   * the eco control's box is inside the viewport — the row gives way by wrapping, never by cutting;
 *   * and the reading is still on screen: the fix is a wrapped row, not a dropped battery line.
 */
for (const locale of LOCALES as readonly Locale[]) {
  test(`the settings plate keeps every box inside its phone width (${locale})`, async ({
    page,
  }) => {
    await openScreen(page, { screen: 'settings', viewport: PHONE, locale, theme: THEMES[0] });

    const boxes = await page.evaluate((): PhoneBoxes => {
      const edgeBox = (selector: string): { left: number; right: number } | null => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return { left: Math.round(rect.left), right: Math.round(rect.right) };
      };

      const area = document.getElementById('bench-main');
      return {
        viewport: window.innerWidth,
        area:
          area === null ? null : { scrollWidth: area.scrollWidth, clientWidth: area.clientWidth },
        panel: edgeBox('#settings-panel-settings'),
        control: edgeBox('[data-testid="eco-mode-toggle"]'),
        reading: edgeBox('[data-testid="eco-status"]'),
      };
    });

    // A missing box is the case failing, not a box silently skipped: the settings plate must expose the
    // stop, the control and the reading this case measures.
    const must = <T>(value: T | null, name: string): T => {
      if (value === null) {
        throw new Error(`${name} is not on the settings plate: ${JSON.stringify(boxes)}`);
      }
      return value;
    };

    const area = must(boxes.area, 'the screen area (#bench-main)');
    const panel = must(boxes.panel, 'the settings tab panel (#settings-panel-settings)');
    const control = must(boxes.control, 'the eco control');
    const reading = must(boxes.reading, 'the battery/network reading');
    const { viewport } = boxes;
    const inside = (box: Edges): string =>
      `${box.left}px..${box.right}px in a ${viewport}px viewport`;

    // 1. No sideways scroll range: the plate is as wide as the screen that holds it, never wider.
    expect(
      area.scrollWidth,
      `the screen area scrolls sideways: ${area.scrollWidth}px of content in ${area.clientWidth}px of plate`
    ).toBeLessThanOrEqual(area.clientWidth + 1);

    // 2. The tab panel: the stop whose ring was drawn past the edge.
    expect(
      panel.left,
      `the settings tab panel starts before the viewport — ${inside(panel)}`
    ).toBeGreaterThanOrEqual(-1);
    expect(
      panel.right,
      `the settings tab panel leaves the viewport — ${inside(panel)}`
    ).toBeLessThanOrEqual(viewport + 1);

    // 3+4. The control that overflowed, and the reading inside it, both still whole and on screen.
    for (const [name, box] of [
      ['the eco control', control],
      ['the battery/network reading', reading],
    ] as const) {
      expect(
        box.left,
        `${name} starts before the viewport — ${inside(box)}`
      ).toBeGreaterThanOrEqual(-1);
      expect(box.right, `${name} leaves the viewport — ${inside(box)}`).toBeLessThanOrEqual(
        viewport + 1
      );
    }
  });
}
