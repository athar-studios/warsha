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

test.describe('Frame journeys', () => {
  test('project switcher navigates across projects and creates new project', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'ar' });

    // Displays the project name (never raw UUID)
    await expect(page.locator('[data-action="frame.project.open"]')).toContainText(
      'متجر ورشة للأثاث المكتبي'
    );

    // Open project switcher
    await act(page, 'frame.project.open');
    const listbox = page.locator('[role="listbox"]');
    await expect(listbox).toBeVisible();

    // Switch project
    await act(page, 'frame.project.switch', { nth: 1 });
    await expect(page).toHaveURL(/#\/p\/proj-store/);
    await expect(page.locator('[data-action="frame.project.open"]')).toContainText('Warsha Store');

    // Open switcher and click new project
    await act(page, 'frame.project.open');
    await act(page, 'frame.project.new');
    await expect(page).toHaveURL(/#\//);
  });

  test('mode switching changes density and records shell config', async ({ page }) => {
    await openV3(page, '/', { mode: 'simple' });

    const root = page.locator('.v3-frame-root');
    await expect(root).toHaveAttribute('data-density', 'comfortable');

    // Switch to advanced mode
    await act(page, 'frame.mode.advanced');
    await expect(root).toHaveAttribute('data-density', 'compact');
    await expect(page.locator('[data-action="frame.mode.advanced"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );

    const configWrites = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
          }
        ).__WARSHA_STUB__?.configWrites ?? []
    );
    expect(
      configWrites.some((w) => w.key === 'app_mode' && w.value === 'advanced')
    ).toBe(true);

    // Switch back to simple mode
    await act(page, 'frame.mode.simple');
    await expect(root).toHaveAttribute('data-density', 'comfortable');
    await expect(page.locator('[data-action="frame.mode.simple"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  test('inbox count limits gates to current run stage only (amendment §5.5-b)', async ({
    page,
  }) => {
    // Harness has proj-store with run-gate-a at stage: 'gate_a' (1 pending gate at current stage),
    // and proj-ui with run-code at stage: 'code' (not a gate stage). Total should be 1.
    await openV3(page, '/', { lang: 'en' });
    const inboxBtn = page.locator('[data-action="frame.inbox.open"]');
    await expect(inboxBtn).toHaveAttribute('aria-label', 'Decisions waiting: 1');
    await expect(page.locator('.v3-frame-inbox-badge')).toHaveText('1');

    // When a run is at gate_b and gates.list answers all 4 pending gates, only gate_b is counted (1)
    await openV3(page, '/', {
      lang: 'en',
      fixtures: {
        'runs.list': {
          result: [
            {
              id: 'run-b',
              projectId: 'proj-ui',
              stage: 'gate_b',
              status: 'awaiting_gate',
              startedAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
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

    await expect(page.locator('[data-action="frame.inbox.open"]')).toHaveAttribute(
      'aria-label',
      'Decisions waiting: 1'
    );
  });

  test('daemon offline displays danger banner and retry dials health RPC', async ({ page }) => {
    await openV3(page, '/', {
      lang: 'ar',
      fixtures: {
        health: { error: 'Connection refused' },
      },
    });

    const banner = page.locator('[role="region"][aria-label="حالة الخادم"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('لا يمكن الوصول إلى خادم ورشة — إعادة المحاولة');

    await act(page, 'frame.daemon.retry');
    const call = await expectRpc(page, 'health');
    expect(call.method).toBe('health');
  });
});

// ---------------------------------------------------------------------------
// One test per frame action id
// ---------------------------------------------------------------------------

test.describe('Frame action ids', () => {
  test('frame.skip-to-main focuses main landmark', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'frame.skip-to-main');
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('main');
  });

  test('frame.project.open toggles project switcher listbox', async ({ page }) => {
    await openV3(page, '/');
    const listbox = page.locator('[role="listbox"]');
    await expect(listbox).toBeHidden();
    await act(page, 'frame.project.open');
    await expect(listbox).toBeVisible();
  });

  test('frame.project.switch switches project and updates URL', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'frame.project.open');
    await act(page, 'frame.project.switch', { nth: 1 });
    await expect(page).toHaveURL(/#\/p\/proj-store/);
  });

  test('frame.project.new navigates to root composer', async ({ page }) => {
    await openV3(page, '/p/proj-ui');
    await act(page, 'frame.project.open');
    await act(page, 'frame.project.new');
    await expect(page).toHaveURL(/#\//);
  });

  test('frame.mode.simple activates simple mode', async ({ page }) => {
    await openV3(page, '/', { mode: 'advanced' });
    await act(page, 'frame.mode.simple');
    await expect(page.locator('.v3-frame-root')).toHaveAttribute('data-density', 'comfortable');
  });

  test('frame.mode.advanced activates advanced mode', async ({ page }) => {
    await openV3(page, '/', { mode: 'simple' });
    await act(page, 'frame.mode.advanced');
    await expect(page.locator('.v3-frame-root')).toHaveAttribute('data-density', 'compact');
  });

  test('frame.inbox.open navigates to /inbox', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'frame.inbox.open');
    await expect(page).toHaveURL(/#\/inbox/);
  });

  test('frame.settings.open navigates to /settings/general', async ({ page }) => {
    await openV3(page, '/');
    await act(page, 'frame.settings.open');
    await expect(page).toHaveURL(/#\/settings\/general/);
  });

  test('frame.daemon.retry invokes health RPC', async ({ page }) => {
    await openV3(page, '/', {
      fixtures: {
        health: { error: 'Daemon offline' },
      },
    });
    await act(page, 'frame.daemon.retry');
    const call = await expectRpc(page, 'health');
    expect(call.method).toBe('health');
  });
});

// ---------------------------------------------------------------------------
// Accessibility and Keyboard (@a11y)
// ---------------------------------------------------------------------------

test.describe('Frame accessibility (@a11y)', () => {
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

  test('keyboard path traverses skip link, switcher, mode, inbox, settings @a11y', async ({
    page,
  }) => {
    await openV3(page, '/');

    // First tab hits skip link
    await page.keyboard.press('Tab');
    const activeFirst = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(activeFirst).toBe('frame.skip-to-main');

    // Pressing Enter on skip link focuses main
    await page.keyboard.press('Enter');
    const activeMain = await page.evaluate(() => document.activeElement?.id);
    expect(activeMain).toBe('main');

    // Return focus to skip link and Tab forward through TopBar controls
    await page.locator('[data-action="frame.skip-to-main"]').focus();
    await page.keyboard.press('Tab');
    const activeSwitcher = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(activeSwitcher).toBe('frame.project.open');

    // Open switcher with Enter and close with Escape
    await page.keyboard.press('Enter');
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="listbox"]')).toBeHidden();
    const afterEsc = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(afterEsc).toBe('frame.project.open');

    // Roving radio group for mode
    await page.keyboard.press('Tab');
    const activeMode = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(activeMode).toBe('frame.mode.simple');

    await page.keyboard.press('ArrowRight');
    const activeModeNext = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(activeModeNext).toBe('frame.mode.advanced');

    await page.keyboard.press('Tab');
    const activeInbox = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(activeInbox).toBe('frame.inbox.open');

    await page.keyboard.press('Tab');
    const activeSettings = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    expect(activeSettings).toBe('frame.settings.open');
  });
});

// ---------------------------------------------------------------------------
// Visual snapshots (@visual)
// ---------------------------------------------------------------------------

test.describe('Frame visual baselines (@visual)', () => {
  const STATES = ['ready', 'project-switcher-open', 'daemon-offline'] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual screenshot: frame ${state} ${vp.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            const isOffline = state === 'daemon-offline';
            await openV3(page, '/', {
              lang: locale,
              theme,
              viewport: { width: vp.width, height: vp.height },
              fixtures: isOffline ? { health: { error: 'Daemon offline' } } : {},
            });

            if (state === 'project-switcher-open') {
              await act(page, 'frame.project.open');
              await expect(page.locator('[role="listbox"]')).toBeVisible();
            }

            await expect(page).toHaveScreenshot(
              `frame-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
