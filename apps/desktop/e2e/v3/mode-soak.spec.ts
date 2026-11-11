import { expect, test } from '@playwright/test';

import { act, openV3 } from './support';

/**
 * T1 — the mode switch, soaked.
 *
 * Simple <-> Advanced swaps the whole screen tree at `/`, and the 2026-11-10 review asked for a soak
 * because a switch that leaks one listener, one sheet or one stale focus ring is invisible in a single
 * round trip. Fifty switches, each one asserted: the document's `data-mode`, the frame's density, the
 * pressed radio, and focus staying on the control the owner pressed. A page that throws, logs an error,
 * or drops its tree fails here instead of in the owner's hands.
 */
const SWITCHES = 50;

test(`mode soak: Simple <-> Advanced ${SWITCHES} times stays clean`, async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await openV3(page, '/', { lang: 'ar', mode: 'simple', viewport: { width: 1440, height: 900 } });

  const root = page.locator('.v3-frame-root');
  await expect(root).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'simple');
  await expect(root).toHaveAttribute('data-density', 'comfortable');

  for (let index = 0; index < SWITCHES; index += 1) {
    const next = index % 2 === 0 ? 'advanced' : 'simple';
    const density = next === 'advanced' ? 'compact' : 'comfortable';

    await act(page, `frame.mode.${next}`);

    await expect(page.locator('html')).toHaveAttribute('data-mode', next);
    await expect(root).toHaveAttribute('data-density', density);
    await expect(root).toBeVisible();
    await expect(page.locator(`[data-action="frame.mode.${next}"]`)).toHaveAttribute(
      'aria-checked',
      'true'
    );

    // Focus stays on the control the owner pressed: a switch that steals it loses the keyboard owner.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-action') ?? null);
    expect(focused, `focus left the mode switch on round ${index + 1}`).toBe(`frame.mode.${next}`);

    // Nothing is left showing that the mode it replaced owned: no sheet, no dialog, no main landmark
    // missing from the tree.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('main')).toHaveCount(1);
  }

  expect(pageErrors, `page errors during the soak:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors, `console errors during the soak:\n${consoleErrors.join('\n')}`).toEqual([]);
});
