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

import { LOCALES, openScreen, THEMES, VIEWPORTS, type Locale } from './harness';

/** The three `Text` runs on the onboarding language step, in document order. */
const HEADLINE_RUNS = 3;

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
