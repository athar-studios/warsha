import { expect, test } from '@playwright/test';

import {
  auditFocusWalk,
  describeAxe,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../harness';

import { act, expectRpc, openV3 } from './support';

const LOCALES = ['ar', 'en'] as const;
const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { width: 1280, height: 800, name: '1280x800' },
  { width: 390, height: 844, name: '390x844' },
] as const;

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

test.describe('Home journeys', () => {
  test('home.start calls projects.create -> budget.set -> runs.start in order and navigates', async ({
    page,
  }) => {
    await openV3(page, '/', { lang: 'ar' });

    // Single primary path: only one composer on the page
    const textarea = page.locator('main textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('متجر أدوات ورشة للتصنيع\nتطبيق متكامل مع قاعدة بيانات وسير عمل');

    const startBtn = page.locator('[data-action="home.start"]');
    await expect(startBtn).toBeEnabled();
    await expect(startBtn).toHaveAttribute('data-variant', 'primary');

    await act(page, 'home.start');

    // Assert RPC sequence
    const createCall = await expectRpc(page, 'projects.create');
    expect(createCall.method).toBe('projects.create');
    const budgetCall = await expectRpc(page, 'budget.set');
    expect(budgetCall.method).toBe('budget.set');
    const runCall = await expectRpc(page, 'runs.start');
    expect(runCall.method).toBe('runs.start');

    // Navigated to /p/:id
    await expect(page).toHaveURL(/#\/p\/proj-created/);
  });

  test('defaults sheet manages coordinator model routing and records budget preference', async ({
    page,
  }) => {
    await openV3(page, '/', { lang: 'en' });

    // Open defaults Sheet
    await act(page, 'home.defaults.open');
    const sheet = page.locator('[data-testid="home-defaults-sheet"]');
    await expect(sheet).toBeVisible();

    // Change budget and save
    const budgetInput = sheet.locator('input[type="number"]');
    await budgetInput.fill('40');
    await act(page, 'home.defaults.budget.save');

    const prefCall = await expectRpc(page, 'preferences.record');
    expect(prefCall.method).toBe('preferences.record');

    // Navigate to models settings
    await act(page, 'home.defaults.models.open');
    await expect(page).toHaveURL(/#\/settings\/models/);
  });

  test('inbox banner reviews pending gates and projects navigate', async ({ page }) => {
    await openV3(page, '/', { lang: 'en' });

    // Pending gate at current stage renders attention banner (Amendment §5.5-b)
    const banner = page.locator('[data-testid="home-inbox-banner"]');
    await expect(banner).toBeVisible();

    await act(page, 'home.inbox.review');
    await expect(page).toHaveURL(/#\/inbox/);

    // Return to home and navigate to a project
    await openV3(page, '/', { lang: 'en' });
    const projectCards = page.locator('[data-action="home.project.open"]');
    await expect(projectCards.first()).toBeVisible();

    await act(page, 'home.project.open', { nth: 0 });
    await expect(page).toHaveURL(/#\/p\//);

    // Test View All link
    await openV3(page, '/', { lang: 'en' });
    await act(page, 'home.projects.all');
    await expect(page).toHaveURL(/#\/projects/);
  });

  test('unconfigured provider replaces start with home.provider.add', async ({ page }) => {
    await openV3(page, '/', {
      lang: 'ar',
      fixtures: {
        'providers.list': { result: [] },
      },
    });

    await expect(page.locator('[data-action="home.start"]')).toHaveCount(0);
    const providerAddBtn = page.locator('[data-action="home.provider.add"]');
    await expect(providerAddBtn).toBeVisible();

    await act(page, 'home.provider.add');
    await expect(page).toHaveURL(/#\/onboarding/);
  });

  test('error banner allows retry via home.retry', async ({ page }) => {
    await openV3(page, '/', {
      fixtures: {
        'projects.list': { error: 'Daemon communication failure' },
      },
    });

    await expect(page.locator('[data-testid="home-error-banner"]')).toBeVisible();

    await act(page, 'home.retry');
    const call = await expectRpc(page, 'projects.list');
    expect(call.method).toBe('projects.list');
  });
});

// ---------------------------------------------------------------------------
// Action IDs (10/10)
// ---------------------------------------------------------------------------

test.describe('Home action ids', () => {
  test('home.start creates project, sets budget, starts run and navigates', async ({ page }) => {
    await openV3(page, '/');
    await page.locator('main textarea').fill('مشروع تجريبي\nوصف كامل للمشروع');
    await act(page, 'home.start');
    await expectRpc(page, 'projects.create');
    await expectRpc(page, 'budget.set');
    await expectRpc(page, 'runs.start');
    await expect(page).toHaveURL(/#\/p\/proj-created/);
  });

  test('home.example.use fills textarea with starter idea', async ({ page }) => {
    await openV3(page, '/', { lang: 'ar' });
    await act(page, 'home.example.use', { nth: 1 });
    const textarea = page.locator('main textarea');
    await expect(textarea).toHaveValue('نظام كاشير لمطعم');
  });

  test('home.defaults.open opens defaults Sheet', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'home.defaults.open');
    await expect(page.locator('[data-testid="home-defaults-sheet"]')).toBeVisible();
  });

  test('home.defaults.budget.save records preference', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'home.defaults.open');
    await act(page, 'home.defaults.budget.save');
    const call = await expectRpc(page, 'preferences.record');
    expect(call.method).toBe('preferences.record');
  });

  test('home.defaults.models.open navigates to /settings/models', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'home.defaults.open');
    await act(page, 'home.defaults.models.open');
    await expect(page).toHaveURL(/#\/settings\/models/);
  });

  test('home.inbox.review navigates to /inbox', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'home.inbox.review');
    await expect(page).toHaveURL(/#\/inbox/);
  });

  test('home.project.open navigates to /p/:id', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'home.project.open', { nth: 0 });
    await expect(page).toHaveURL(/#\/p\//);
  });

  test('home.projects.all navigates to /projects', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'home.projects.all');
    await expect(page).toHaveURL(/#\/projects/);
  });

  test('home.provider.add navigates to /onboarding', async ({ page }) => {
    await openV3(page, '/', {
      fixtures: {
        'providers.list': { result: [] },
      },
    });
    await act(page, 'home.provider.add');
    await expect(page).toHaveURL(/#\/onboarding/);
  });

  test('home.retry re-dials projects.list', async ({ page }) => {
    await openV3(page, '/', {
      fixtures: {
        'projects.list': { error: 'Temporary connection drop' },
      },
    });
    await act(page, 'home.retry');
    const call = await expectRpc(page, 'projects.list');
    expect(call.method).toBe('projects.list');
  });
});

// ---------------------------------------------------------------------------
// Accessibility and Keyboard (@a11y)
// ---------------------------------------------------------------------------

test.describe('Home accessibility (@a11y)', () => {
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/', { lang: locale, theme });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });
    }
  }

  test('keyboard traversal through composer, example chips, and project cards @a11y', async ({
    page,
  }) => {
    await openV3(page, '/');

    // Tab through skip link and top bar items
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // project switcher
    await page.keyboard.press('Tab'); // mode radio
    await page.keyboard.press('Tab'); // inbox button
    await page.keyboard.press('Tab'); // settings button

    // Now tab reaches composer textarea in main
    await page.keyboard.press('Tab');
    const activeTextarea = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
    expect(activeTextarea).toBe('textarea');

    // Tab to defaults open button
    await page.keyboard.press('Tab');
    const activeDefaults = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeDefaults).toBe('home.defaults.open');

    // Tab to starter chips
    await page.keyboard.press('Tab');
    const activeChip1 = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeChip1).toBe('home.example.use');
  });
});

// ---------------------------------------------------------------------------
// Visual snapshots (@visual)
// ---------------------------------------------------------------------------

test.describe('Home visual baselines (@visual)', () => {
  const STATES = ['ready', 'empty', 'defaults-sheet', 'no-provider', 'error'] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual screenshot: home ${state} ${vp.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            const isError = state === 'error';
            const isEmpty = state === 'empty';
            const isNoProvider = state === 'no-provider';

            await openV3(page, '/', {
              lang: locale,
              theme,
              viewport: { width: vp.width, height: vp.height },
              fixtures: isError
                ? { 'projects.list': { error: 'Daemon offline' } }
                : isEmpty
                  ? { 'projects.list': { result: [] } }
                  : isNoProvider
                    ? { 'providers.list': { result: [] } }
                    : {},
            });

            if (state === 'defaults-sheet') {
              await act(page, 'home.defaults.open');
              await expect(page.locator('[data-testid="home-defaults-sheet"]')).toBeVisible();
            }

            if (isError) {
              await expect(page.locator('[data-testid="home-error-banner"]')).toBeVisible();
            }

            await expect(page).toHaveScreenshot(
              `home-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
