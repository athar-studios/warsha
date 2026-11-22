import { expect, test, type Page } from '@playwright/test';

import { act, openV3 } from './support';

/**
 * R-UI-3 polish states (E1): the type scale and the cue have unit tests of their own; what only a browser can
 * answer is whether the motion the stylesheet declares actually runs — and whether `prefers-reduced-motion:
 * reduce` actually stops it.
 *
 * `openV3` injects a kill-switch stylesheet (`animation: none !important`) so the visual baselines are stable.
 * These cases measure `tokens.css` itself, so the kill-switch comes out first; without that, every assertion
 * below would pass on the injected rule rather than on ours.
 */
async function dropHarnessMotionKill(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const style of Array.from(document.querySelectorAll('style'))) {
      // The harness rule starts with the universal selector reset; tokens.css never does. (Matching on
      // `animation: none !important` alone would remove tokens.css itself — it carries that declaration too.)
      if (style.textContent?.includes('*, *::before, *::after')) style.remove();
    }
  });
}

async function computedAnimationName(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    return element ? getComputedStyle(element).animationName : 'missing-element';
  }, selector);
}

async function runningAnimations(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return ['missing-element'];
    return element
      .getAnimations()
      .map((animation) => (animation as CSSAnimation).animationName ?? 'unnamed');
  }, selector);
}

test.describe('polish v3 — motion (R-UI-3 D1, E1)', () => {
  test('reduced motion leaves the Sheet and the Stepper static', async ({ page }) => {
    // `openV3` emulates `reducedMotion: reduce`, and the kill-switch is removed below, so the only rule
    // that can set `animation: none` here is the one tokens.css ships.
    await openV3(page, '/', { lang: 'en', mode: 'simple' });
    await dropHarnessMotionKill(page);

    await act(page, 'home.defaults.open');
    await expect(page.getByTestId('home-defaults-sheet')).toBeVisible();
    expect(await computedAnimationName(page, '.w-sheet')).toBe('none');
    expect(await computedAnimationName(page, '.w-sheet-scrim')).toBe('none');
    expect(await runningAnimations(page, '.w-sheet')).toEqual([]);
    expect(await runningAnimations(page, '.w-sheet-scrim')).toEqual([]);

    // A stage that becomes `done` runs w-step-done; under reduce the marker stays put.
    await openV3(page, '/p/proj-store', { lang: 'en', mode: 'simple' });
    await dropHarnessMotionKill(page);
    await expect(page.getByTestId('project-stepper')).toBeVisible();
    expect(await computedAnimationName(page, '.w-stepper__bar')).toBe('none');

    await act(page, 'project.gate.approve');
    await expect(page.getByTestId('project-stepper')).toBeVisible();
    expect(await runningAnimations(page, '.w-stepper__bar')).toEqual([]);
    expect(await runningAnimations(page, '.w-stepper')).toEqual([]);
  });

  test('reduced motion leaves the spinner, the skeleton and the indeterminate bar static', async ({
    page,
  }) => {
    // The budget save is held pending by a stalled `preferences.record`, so the button keeps its spinner.
    await openV3(page, '/settings/general', {
      lang: 'en',
      mode: 'simple',
      fixtures: { 'preferences.record': { delayMs: 30000 } },
    });
    await dropHarnessMotionKill(page);

    const budgetInput = page.locator('[data-testid="general-default-budget-input"] input');
    await budgetInput.fill('50');
    await act(page, 'settings.budget-default.save');
    await expect(page.locator('.w-spinner svg').first()).toBeVisible();
    expect(await computedAnimationName(page, '.w-spinner svg')).toBe('none');
    expect(await runningAnimations(page, '.w-spinner svg')).toEqual([]);

    // The General section's loading skeletons: a stalled `preferences.list` while the route mounts.
    await openV3(page, '/settings/about', {
      lang: 'en',
      mode: 'simple',
      fixtures: { 'preferences.list': { delayMs: 30000 } },
    });
    await dropHarnessMotionKill(page);
    await page.locator('a[href="#/settings/general"]').click();
    await expect(page.locator('.w-skeleton').first()).toBeVisible();
    expect(await computedAnimationName(page, '.w-skeleton')).toBe('none');
    expect(await runningAnimations(page, '.w-skeleton')).toEqual([]);

    // No screen renders an indeterminate bar (CostTab always passes a value), so the component's own inline
    // animation string is put on a `.w-progress-bar__fill` probe: this asserts the stylesheet's reduce rule
    // wins over that inline string, which is the half a jsdom test cannot see either.
    const indeterminate = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'w-progress-bar__fill';
      probe.style.animation = 'w-progress-indeterminate 1.5s infinite ease-in-out';
      document.body.appendChild(probe);
      const result = {
        animationName: getComputedStyle(probe).animationName,
        running: probe.getAnimations().length,
      };
      probe.remove();
      return result;
    });
    expect(indeterminate.animationName).toBe('none');
    expect(indeterminate.running).toBe(0);
  });

  test('without a motion preference the Sheet actually slides in', async ({ page }) => {
    await openV3(page, '/', { lang: 'en', mode: 'simple' });
    await dropHarnessMotionKill(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Read the animation the moment React mounts the sheet (a MutationObserver callback runs before a
    // 320ms animation could finish), instead of racing a round trip against it.
    const opened = await page.evaluate(
      () =>
        new Promise<{ computed: string; running: { name: string; state: string }[] }>((resolve) => {
          const read = (): boolean => {
            const sheet = document.querySelector('.w-sheet');
            if (!sheet) return false;
            const running = sheet.getAnimations().map((animation) => ({
              name: (animation as CSSAnimation).animationName ?? 'unnamed',
              state: animation.playState,
            }));
            if (running.length === 0) return false;
            resolve({ computed: getComputedStyle(sheet).animationName, running });
            return true;
          };

          const observer = new MutationObserver(() => {
            if (read()) observer.disconnect();
          });
          observer.observe(document.body, { childList: true, subtree: true });

          document.querySelector<HTMLElement>('[data-action="home.defaults.open"]')?.click();

          setTimeout(() => {
            observer.disconnect();
            const sheet = document.querySelector('.w-sheet');
            resolve({
              computed: sheet ? getComputedStyle(sheet).animationName : 'missing-element',
              running: [],
            });
          }, 2000);
        })
    );

    expect(opened.computed).toBe('w-sheet-in');
    expect(
      opened.running.some(
        (animation) => animation.name === 'w-sheet-in' && animation.state === 'running'
      )
    ).toBe(true);
    await expect(page.getByTestId('home-defaults-sheet')).toBeVisible();
  });
});

test.describe('polish v3 — sound switch (R-UI-3 D2, E1)', () => {
  for (const [locale, label] of [
    ['ar', 'تنبيهات صوتية'],
    ['en', 'Sound cues'],
  ] as const) {
    test(`the Settings switch is present and starts off in ${locale}`, async ({ page }) => {
      await openV3(page, '/settings/general', { lang: locale, mode: 'simple' });

      const control = page.locator('[data-action="settings.sound-cues.set"]');
      await expect(page.getByRole('switch', { name: label })).toBeVisible();
      await expect(control).toHaveAttribute('aria-checked', 'false');
      expect(
        await page.evaluate(() => window.localStorage.getItem('warsha.sound_cues'))
      ).toBeNull();
    });
  }
});
