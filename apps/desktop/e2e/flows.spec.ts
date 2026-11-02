// @warsha/desktop — the keyboard flows, driven with keys and checked against the daemon.
//
// §9's rule is that every interaction is reachable without a mouse, and REDESIGN's §6 components each
// own a piece of it: a skip link, a roving tablist, a mode group whose arrows move focus, a composer
// where Enter sends and Shift+Enter does not, a decision card whose refusal step demands a note, and a
// dialog that traps focus, answers Escape and gives focus back to what opened it.
//
// Each case types into the real app and asserts what the app really did — the focused element, the
// value of a field, and the RPC that reached the stubbed daemon. A flow that moves a cursor but never
// reaches the daemon is exactly the failure a screenshot cannot see, so the RPC record is part of the
// assertion wherever the flow has an outcome.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  LOCALES,
  openScreen,
  readConfigWrites,
  screenCase,
  THEMES,
  viewportsNamed,
  type Locale,
  type ScenarioId,
  type ScreenId,
  type Theme,
  type Viewport,
} from './harness';

/** The two widths a keyboard flow is walked at: the phone and the reference desktop. */
const FLOW_VIEWPORTS = viewportsNamed(['390x844', '1440x900']);

/** The one screen every flow below opens, at the width and language the case names. */
function openForKeys(
  page: Page,
  screen: ScreenId,
  locale: Locale,
  theme: Theme,
  viewport: Viewport,
  scenario?: ScenarioId
) {
  return openScreen(page, { screen, viewport, locale, theme, scenario });
}

/** Which element holds focus right now, described the way the audits describe a box. */
async function activeDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (element === null || element === document.body) return '(document)';
    const attributes = [
      element.getAttribute('data-testid'),
      element.getAttribute('data-gate-action'),
      element.getAttribute('href'),
    ];
    const firstClass =
      typeof element.className === 'string' && element.className !== ''
        ? element.className.split(/\s+/)[0] ?? ''
        : '';
    return [
      element.tagName.toLowerCase(),
      ...attributes.map((value) => (value !== null ? `@${value}` : '')),
      firstClass !== '' ? `.${firstClass}` : '',
    ].join(' ');
  });
}

for (const viewport of FLOW_VIEWPORTS) {
  for (const locale of LOCALES as readonly Locale[]) {
    const where = `${viewport.name} ${locale}`;

    test(`the skip link is the first stop and it lands in the bench: ${where}`, async ({ page }) => {
      await openForKeys(page, 'simple', locale, 'light', viewport);

      await page.keyboard.press('Tab');
      const first = await activeDescriptor(page);
      expect(first, 'the first Tab should land on the skip link').toContain('bench-skip');

      await page.keyboard.press('Enter');
      await expect(page.locator('#bench-main')).toBeFocused();
    });

    test(`the mode group moves focus with the arrows and presses with Enter: ${where}`, async ({
      page,
    }) => {
      await openForKeys(page, 'simple', locale, 'light', viewport);

      const rungs = page.locator('.warsha-mode-rung');
      await expect(rungs).toHaveCount(2);
      await rungs.first().focus();

      await page.keyboard.press('ArrowRight');
      await expect(rungs.nth(1), 'ArrowRight did not move focus to the other rung').toBeFocused();

      await page.keyboard.press('ArrowLeft');
      await expect(rungs.first(), 'ArrowLeft did not bring focus back').toBeFocused();

      // Enter on the far rung is the switch: the bench changes depth and the shell saves the owner's
      // choice through the seam `checkOnboarding` reads back at the next start-up. The writes are read
      // from the page here rather than from `openScreen`'s snapshot, which is a record of the open.
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await expect(page.locator(screenCase('advanced').root)).toBeVisible();
      await expect
        .poll(() => readConfigWrites(page), {
          message: 'switching mode did not persist the choice',
        })
        .toContainEqual({ key: 'app_mode', value: 'advanced' });
    });

    test(`the settings tab strip is a roving tablist: ${where}`, async ({ page }) => {
      await openForKeys(page, 'settings', locale, 'light', viewport);

      const tabs = page.locator('[data-testid="settings-tabs"] [role="tab"]');
      const count = await tabs.count();
      expect(count, 'the settings tab strip has no tabs').toBeGreaterThan(1);

      // The strip mirrors: in Arabic the arrows walk the other way (§11). What must hold in either
      // direction is that an arrow moves focus to another tab, that exactly one tab is a Tab stop, and
      // that Home and End reach the ends of the strip.
      await tabs.first().focus();
      await page.keyboard.press('ArrowRight');
      // The tab's own `data-testid` is what to read here — its DOM `id` is the panel's
      // (`settings-panel-<screen>-tab`), which is what made B4's first version of this case report a
      // product defect that was really the test reaching for the wrong attribute.
      const movedTo = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? ''
      );
      expect(movedTo, 'ArrowRight moved focus out of the tab strip').toContain('settings-tab-');
      expect(movedTo).not.toBe(await tabs.first().getAttribute('data-testid'));

      await page.keyboard.press('Home');
      await expect(tabs.first(), 'Home did not return to the first tab').toBeFocused();

      await page.keyboard.press('End');
      await expect(tabs.nth(count - 1), 'End did not reach the last tab').toBeFocused();

      const inTabOrder = await tabs.evaluateAll((elements) =>
        elements.filter((element) => element.getAttribute('tabindex') === '0').length
      );
      expect(inTabOrder, 'a roving tablist keeps exactly one tab in the Tab order').toBe(1);

      // Enter activates the tab the cursor is on — the strip is manual-activation, so selection follows
      // the press and not the arrow.
      await page.keyboard.press('Enter');
      await expect(tabs.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
    });

    test(`the composer: Shift+Enter breaks the line, Enter sends it: ${where}`, async ({ page }) => {
      await openForKeys(page, 'simple', locale, 'light', viewport);
      const composer = page.locator('[data-testid="simple-composer-input"]');

      await composer.focus();
      await composer.fill('');
      await page.keyboard.type('سطر أول');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('سطر ثانٍ');

      const draft = await composer.inputValue();
      expect(draft, 'Shift+Enter should break the line instead of sending').toContain('\n');

      await page.keyboard.press('Enter');
      await expect
        .poll(() => composer.inputValue(), { message: 'Enter did not clear the composer' })
        .toBe('');

      // The message is in the transcript, addressed to the agent the bench has selected. What is *not*
      // here is an RPC: `SimpleMode` answers with a fixture reply because no chat method exists on the
      // daemon yet — a documented seam (`apps/desktop/src/screens/SimpleMode.tsx`), recorded as an
      // integration gap in `bridge-io/audit/visual.md` rather than asserted as if it worked.
      await expect(page.locator('.simple-mode')).toContainText('سطر أول');
    });

    test(`a gate is approved from the keyboard, and only by the daemon: ${where}`, async ({
      page,
    }) => {
      const stubs = await openForKeys(page, 'simple', locale, 'light', viewport, 'permission');

      const approve = page.locator('[data-gate-action="approve"]').first();
      await expect(approve).toBeVisible();
      await approve.focus();
      await page.keyboard.press('Enter');

      await expect
        .poll(() => stubs.rpcMethods.filter((method) => method === 'gates.approve').length, {
          message: 'Enter on the approve action never reached the daemon',
        })
        .toBeGreaterThan(0);
    });

    test(`a refusal needs a note, and Escape hands focus back: ${where}`, async ({ page }) => {
      const stubs = await openForKeys(page, 'simple', locale, 'light', viewport, 'permission');

      const reject = page.locator('[data-gate-action="reject"]').first();
      await reject.focus();
      await page.keyboard.press('Enter');

      // The step opens with a labelled field. Submitting it empty is refused where it was typed.
      const note = page.locator('form:has(textarea) textarea').first();
      await expect(note).toBeVisible();
      const confirm = page.locator('form:has(textarea) button[type="submit"]').first();
      await confirm.focus();
      await page.keyboard.press('Enter');

      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
      await expect(page.locator('[role="alert"]').first()).toBeVisible();
      expect(
        stubs.rpcMethods.filter((method) => method === 'gates.reject').length,
        'a noteless refusal reached the daemon'
      ).toBe(0);

      // Escape closes the step and puts the cursor back on the action that opened it.
      await note.focus();
      await page.keyboard.press('Escape');
      await expect
        .poll(() => activeDescriptor(page), { message: 'Escape did not restore focus to the action' })
        .toContain('reject');

      // And a note typed by hand does reach the daemon, with the note in it.
      await page.keyboard.press('Enter');
      await page.locator('form:has(textarea) textarea').first().fill('أعد مراجعة حساب التكاليف');
      await page.locator('form:has(textarea) button[type="submit"]').first().focus();
      await page.keyboard.press('Enter');
      await expect
        .poll(() => stubs.rpcMethods.filter((method) => method === 'gates.reject').length, {
          message: 'a reasoned refusal never reached the daemon',
        })
        .toBeGreaterThan(0);
    });

    test(`the handoff dialog traps the keyboard and gives focus back on Escape: ${where}`, async ({
      page,
    }) => {
      await openForKeys(page, 'run', locale, 'light', viewport);

      const opener = page.locator('[data-testid="handoff-open"]');
      await expect(opener).toBeVisible();
      await opener.focus();
      await page.keyboard.press('Enter');

      const dialog = page.locator('[data-testid="handoff-dialog"]');
      await expect(dialog).toBeVisible();

      // Focus is inside, and walking the ring never leaves it.
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-testid="handoff-dialog"]'))
      );
      expect(inside, 'opening the dialog did not move focus into it').toBe(true);

      for (let step = 1; step <= 12; step += 1) {
        await page.keyboard.press('Tab');
        const stillInside = await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[data-testid="handoff-dialog"]'))
        );
        expect(stillInside, `the Tab ring escaped the dialog after ${step} stops`).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(() => activeDescriptor(page), { message: 'Escape did not return focus to the opener' })
        .toContain('handoff-open');
    });
  }
}

/**
 * The ring §9 pins, per theme: `accent-strong` on the light plate, `accent` on the dark one.
 *
 * These are the two `--warsha-focus-ring` values as rgb(), which is what a computed outline colour
 * reports. A theme that repaints the ring with the bare accent on light (1.35:1, AUDIT-1 §1.3) stops
 * being a visible focus indicator, and this is the case that says so.
 */
const RING: Record<Theme, string> = {
  light: 'rgb(138, 106, 0)',
  dark: 'rgb(255, 214, 10)',
};

for (const theme of THEMES as readonly Theme[]) {
  test(`a focused control draws the §9 ring in ${theme}`, async ({ page }) => {
    await openScreen(page, {
      screen: 'settings',
      viewport: FLOW_VIEWPORTS[1],
      locale: 'ar',
      theme,
    });

    const focused = page.locator('[data-testid="settings-tabs"] [role="tab"]').first();
    await expect(focused).toBeVisible();
    await focused.focus();

    const ring = await focused.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, line: style.outlineStyle, color: style.outlineColor };
    });

    expect(ring.line, 'the focus indicator is not an outline').not.toBe('none');
    expect(Number.parseFloat(ring.width), 'the focus ring has no width').toBeGreaterThan(0);
    expect(ring.color, `the ${theme} ring is not the token §9 fixes`).toBe(RING[theme]);
  });
}
