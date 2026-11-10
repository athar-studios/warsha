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

test.describe('Projects journeys', () => {
  test('renders project board with name, stage, spend, last activity, and filters via search', async ({
    page,
  }) => {
    await openV3(page, '/projects', { lang: 'en', mode: 'simple' });

    const grid = page.locator('[data-testid="projects-grid"]');
    await expect(grid).toBeVisible();

    const cards = page.locator('[data-action="projects.open"]');
    await expect(cards).toHaveCount(2);

    const cardUi = page.locator('[data-testid="projects-card-proj-ui"]');
    const cardStore = page.locator('[data-testid="projects-card-proj-store"]');
    await expect(cardUi).toContainText('متجر ورشة للأثاث المكتبي');
    await expect(cardUi).toContainText('Build');
    await expect(cardUi).toContainText('$4.37');
    await expect(cardStore).toContainText('Warsha Store');
    await expect(cardStore).toContainText('Waiting');

    // Filter by name using projects.search
    const searchInput = page.locator('[data-testid="projects-search-input"]');
    await searchInput.fill('Warsha Store');
    await act(page, 'projects.search');

    await expect(cards).toHaveCount(1);
    await expect(cardStore).toBeVisible();

    // Unmatched query shows search empty message
    await searchInput.fill('NoSuchProjectName');
    await act(page, 'projects.search');
    await expect(page.locator('[data-testid="projects-empty-search"]')).toBeVisible();

    // Clearing search restores all projects
    await searchInput.fill('');
    await act(page, 'projects.search');
    await expect(cards).toHaveCount(2);
  });

  test('opens a project card and navigates to new project composer', async ({ page }) => {
    await openV3(page, '/projects', { lang: 'ar', mode: 'simple' });

    await act(page, 'projects.open', { nth: 0 });
    await expect(page).toHaveURL(/#\/p\/proj-ui/);

    await openV3(page, '/projects', { lang: 'ar', mode: 'simple' });
    await act(page, 'projects.new');
    await expect(page).toHaveURL(/#\//);
  });

  test('Advanced mode renders DataTable and sorts projects via projects.sort', async ({ page }) => {
    await openV3(page, '/projects', { lang: 'en', mode: 'advanced' });

    const table = page.locator('[data-testid="projects-table"]');
    await expect(table).toBeVisible();

    const firstRowCell = table.locator('tbody tr').nth(0).locator('td').nth(0);
    const secondRowCell = table.locator('tbody tr').nth(1).locator('td').nth(0);

    // Default updated:desc -> proj-ui (09:45) first, proj-store (09:20) second
    await expect(firstRowCell).toContainText('متجر ورشة للأثاث المكتبي');
    await expect(secondRowCell).toContainText('Warsha Store');

    // Cycle sort via projects.sort -> updated:asc -> proj-store first, proj-ui second
    await act(page, 'projects.sort');
    await expect(firstRowCell).toContainText('Warsha Store');
    await expect(secondRowCell).toContainText('متجر ورشة للأثاث المكتبي');

    // Click DataTable column header for name
    await table.locator('thead th').nth(0).click();
    await expect(firstRowCell).toContainText('Warsha Store');
  });

  test('empty state displays single primary projects.new CTA navigating to /', async ({ page }) => {
    await openV3(page, '/projects', {
      lang: 'ar',
      fixtures: {
        'projects.list': { result: [] },
      },
    });

    await expect(page.locator('[data-testid="projects-empty-state"]')).toBeVisible();
    await expect(page.locator('main [data-variant="primary"]')).toHaveCount(1);

    await act(page, 'projects.new');
    await expect(page).toHaveURL(/#\//);
  });

  test('error banner allows retry via projects.retry', async ({ page }) => {
    await openV3(page, '/projects', {
      lang: 'en',
      fixtures: {
        'projects.list': { error: 'Daemon unavailable' },
      },
    });

    await expect(page.locator('[data-testid="projects-error-banner"]')).toBeVisible();

    await act(page, 'projects.retry');
    const call = await expectRpc(page, 'projects.list');
    expect(call.method).toBe('projects.list');
  });

  test('ignores future pending gates at non-gate stages (Amendment §5.5-b)', async ({ page }) => {
    await openV3(page, '/projects', {
      lang: 'en',
      fixtures: {
        'projects.list': {
          result: [
            {
              id: 'proj-ui',
              name: 'Only Current Gate',
              createdAt: '2026-10-01T08:00:00.000Z',
              updatedAt: '2026-10-02T09:30:00.000Z',
            },
          ],
        },
        'runs.list': {
          result: [
            {
              id: 'run-code',
              projectId: 'proj-ui',
              stage: 'code',
              status: 'running',
              startedAt: '2026-10-05T07:15:00.000Z',
              updatedAt: '2026-10-05T09:45:00.000Z',
            },
          ],
        },
        'gates.list': {
          result: [
            { stage: 'gate_a', state: { state: 'pending' } },
            { stage: 'gate_b', state: { state: 'pending' } },
            { stage: 'gate_c', state: { state: 'pending' } },
            { stage: 'gate_d', state: { state: 'pending' } },
          ],
        },
      },
    });

    const card = page.locator('[data-testid="projects-card-proj-ui"]');
    await expect(card).toContainText('Running');
    await expect(card).not.toContainText('Waiting');
  });
});

// ---------------------------------------------------------------------------
// Action IDs (5/5)
// ---------------------------------------------------------------------------

test.describe('Projects action ids', () => {
  test('projects.open navigates to /p/:id', async ({ page }) => {
    await openV3(page, '/projects');
    await act(page, 'projects.open', { nth: 0 });
    await expect(page).toHaveURL(/#\/p\//);
  });

  test('projects.new navigates to /', async ({ page }) => {
    await openV3(page, '/projects');
    await act(page, 'projects.new');
    await expect(page).toHaveURL(/#\//);
  });

  test('projects.search filters the project board', async ({ page }) => {
    await openV3(page, '/projects', { lang: 'en' });
    await page.locator('[data-testid="projects-search-input"]').fill('Warsha Store');
    await act(page, 'projects.search');
    await expect(page.locator('[data-action="projects.open"]')).toHaveCount(1);
  });

  test('projects.sort reorders project rows in Advanced mode', async ({ page }) => {
    await openV3(page, '/projects', { lang: 'en', mode: 'advanced' });
    const firstCell = page.locator('[data-testid="projects-table"] tbody tr').first().locator('td').first();
    await expect(firstCell).toContainText('متجر ورشة للأثاث المكتبي');

    await act(page, 'projects.sort');
    await expect(firstCell).toContainText('Warsha Store');
  });

  test('projects.retry re-dials projects.list', async ({ page }) => {
    await openV3(page, '/projects', {
      fixtures: {
        'projects.list': { error: 'Temporary failure' },
      },
    });
    await act(page, 'projects.retry');
    const call = await expectRpc(page, 'projects.list');
    expect(call.method).toBe('projects.list');
  });
});

// ---------------------------------------------------------------------------
// Accessibility and Keyboard (@a11y)
// ---------------------------------------------------------------------------

test.describe('Projects accessibility (@a11y)', () => {
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`Simple mode axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/projects', { lang: locale, theme, mode: 'simple' });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });

      test(`Advanced mode axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/projects', { lang: locale, theme, mode: 'advanced' });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });
    }
  }

  test('keyboard traversal through new project, search, and project cards @a11y', async ({
    page,
  }) => {
    await openV3(page, '/projects', { lang: 'en', mode: 'simple' });

    // Tab through skip link and top bar items
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab'); // project switcher
    await page.keyboard.press('Tab'); // mode radio
    await page.keyboard.press('Tab'); // inbox button
    await page.keyboard.press('Tab'); // settings button

    // Tab reaches New project button in main
    await page.keyboard.press('Tab');
    const activeNew = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeNew).toBe('projects.new');

    // Tab reaches search input
    await page.keyboard.press('Tab');
    const activeSearchInput = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    );
    expect(activeSearchInput).toBe('projects-search-input');

    // Tab reaches search submit button
    await page.keyboard.press('Tab');
    const activeSearchBtn = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeSearchBtn).toBe('projects.search');

    // Tab reaches first project card
    await page.keyboard.press('Tab');
    const activeCard = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-action')
    );
    expect(activeCard).toBe('projects.open');
  });
});

// ---------------------------------------------------------------------------
// Visual snapshots (@visual)
// ---------------------------------------------------------------------------

test.describe('Projects visual baselines (@visual)', () => {
  const STATES = ['ready', 'empty', 'error', 'advanced'] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual screenshot: projects ${state} ${vp.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            const isError = state === 'error';
            const isEmpty = state === 'empty';
            const isAdvanced = state === 'advanced';

            await openV3(page, '/projects', {
              lang: locale,
              theme,
              mode: isAdvanced ? 'advanced' : 'simple',
              viewport: { width: vp.width, height: vp.height },
              fixtures: isError
                ? { 'projects.list': { error: 'Daemon offline' } }
                : isEmpty
                  ? { 'projects.list': { result: [] } }
                  : {},
            });

            if (isError) {
              await expect(page.locator('[data-testid="projects-error-banner"]')).toBeVisible();
            } else if (isEmpty) {
              await expect(page.locator('[data-testid="projects-empty-state"]')).toBeVisible();
            } else if (isAdvanced) {
              await expect(page.locator('[data-testid="projects-table"]')).toBeVisible();
            } else {
              await expect(page.locator('[data-testid="projects-grid"]')).toBeVisible();
            }

            await expect(page).toHaveScreenshot(
              `projects-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
