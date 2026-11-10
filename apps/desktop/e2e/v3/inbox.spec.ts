import { expect, test } from '@playwright/test';

import {
  auditFocusWalk,
  describeAxe,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../harness';

import { act, expectRpc, openV3, rpcCalls } from './support';

const LOCALES = ['ar', 'en'] as const;
const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { width: 1280, height: 800, name: '1280x800' },
  { width: 390, height: 844, name: '390x844' },
] as const;

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

test.describe('Inbox journeys', () => {
  test('renders list of gates needing the owner, limited strictly to current-stage gate with no request-changes or reject visible', async ({
    page,
  }) => {
    await openV3(page, '/inbox', { lang: 'en', mode: 'simple' });

    await expect(page.locator('[data-testid="inbox-ready"]')).toBeVisible();

    // Default fixtures: proj-store has run-gate-a at gate_a; proj-ui has run-code at code.
    // Only run-gate-a has a gate matching its current stage (gate_a).
    const rows = page.locator('[data-testid^="inbox-row-"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Warsha Store');
    await expect(rows.first()).toContainText('Do we approve the idea and brief?');

    // Amendment §5.5-a: request-changes and reject controls remain hidden in DOM
    await expect(page.locator('[data-action="inbox.gate.changes.send"]')).toHaveCount(0);
    await expect(page.locator('[data-action="inbox.gate.reject.confirm"]')).toHaveCount(0);
  });

  test('ignores all-pending future gates for runs at other stages per Amendment §5.5-b', async ({
    page,
  }) => {
    await openV3(page, '/inbox', {
      lang: 'en',
      mode: 'simple',
      fixtures: {
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

    await expect(page.locator('[data-testid="inbox-ready"]')).toBeVisible();

    // proj-ui (run-code at 'code') does NOT match any pending gate;
    // proj-store (run-gate-a at 'gate_a') matches gate_a only.
    const rows = page.locator('[data-testid^="inbox-row-"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Warsha Store');
  });

  test('approves gate via inbox.gate.approve (gates.approve then runs.advance in that order)', async ({
    page,
  }) => {
    await openV3(page, '/inbox', { lang: 'en', mode: 'simple' });

    await expect(page.locator('[data-testid="inbox-ready"]')).toBeVisible();
    await act(page, 'inbox.gate.approve');

    await expectRpc(page, 'gates.approve', { run_id: 'run-gate-a', stage: 'gate_a' });
    await expectRpc(page, 'runs.advance', { run_id: 'run-gate-a' });

    const calls = await rpcCalls(page);
    const approveIdx = calls.findIndex((c) => c.method === 'gates.approve');
    const advanceIdx = calls.findIndex((c) => c.method === 'runs.advance');
    expect(approveIdx).toBeGreaterThanOrEqual(0);
    expect(advanceIdx).toBeGreaterThan(approveIdx);

    // After approval, the decided decision is cleared from view
    await expect(page.locator('[data-testid="inbox-empty"]')).toBeVisible();
  });

  test('each row opens its project via inbox.project.open', async ({ page }) => {
    await openV3(page, '/inbox', { lang: 'en', mode: 'simple' });

    await act(page, 'inbox.project.open');
    await expect(page).toHaveURL(/#\/p\/proj-store$/);
  });

  test('opens decision Sheet via inbox.decision.open and approves from within Sheet', async ({
    page,
  }) => {
    await openV3(page, '/inbox', { lang: 'en', mode: 'simple' });

    await act(page, 'inbox.decision.open');
    const sheet = page.locator('[data-testid="inbox-decision-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Do we approve the idea and brief?');
    await expect(sheet).toContainText('Warsha Store');

    // Approve inside Sheet
    await act(page, 'inbox.gate.approve');
    await expectRpc(page, 'gates.approve', { run_id: 'run-gate-a', stage: 'gate_a' });
    await expectRpc(page, 'runs.advance', { run_id: 'run-gate-a' });
  });

  test('renders honest empty and error states with retry', async ({ page }) => {
    await openV3(page, '/inbox', {
      lang: 'en',
      fixtures: {
        'projects.list': { result: [] },
      },
    });
    await expect(page.locator('[data-testid="inbox-empty"]')).toBeVisible();

    await openV3(page, '/inbox', {
      lang: 'en',
      fixtures: {
        'projects.list': { error: 'Network failure' },
      },
    });
    await expect(page.locator('[data-testid="inbox-error"]')).toBeVisible();
    await expect(page.locator('[data-action="inbox.retry"]')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Action IDs (6/6)
// ---------------------------------------------------------------------------

test.describe('Inbox action ids', () => {
  test('inbox.decision.open opens decision Sheet', async ({ page }) => {
    await openV3(page, '/inbox', { lang: 'en' });
    await act(page, 'inbox.decision.open');
    await expect(page.locator('[data-testid="inbox-decision-sheet"]')).toBeVisible();
  });

  test('inbox.gate.approve dials gates.approve then runs.advance', async ({ page }) => {
    await openV3(page, '/inbox', { lang: 'en' });
    await act(page, 'inbox.gate.approve');
    await expectRpc(page, 'gates.approve', { run_id: 'run-gate-a', stage: 'gate_a' });
    await expectRpc(page, 'runs.advance', { run_id: 'run-gate-a' });
  });

  test('inbox.project.open navigates to /p/:id', async ({ page }) => {
    await openV3(page, '/inbox', { lang: 'en' });
    await act(page, 'inbox.project.open');
    await expect(page).toHaveURL(/#\/p\/proj-store$/);
  });

  test('inbox.gate.changes.send sends requested changes when capability enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/inbox', { lang: 'en' });
    await act(page, 'inbox.decision.open');
    await page.locator('[data-testid="inbox-changes-textarea"] textarea').fill('Revise brief');
    await act(page, 'inbox.gate.changes.send');
    await expectRpc(page, 'gates.changes', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      notes: 'Revise brief',
    });
  });

  test('inbox.gate.reject.confirm rejects gate when capability enabled', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/inbox', { lang: 'en' });
    await act(page, 'inbox.decision.open');
    await page.locator('[data-testid="inbox-reject-reason"] textarea').fill('Rejected scope');
    await act(page, 'inbox.gate.reject.confirm');
    await expectRpc(page, 'gates.reject', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      reason: 'Rejected scope',
    });
  });

  test('inbox.retry re-dials projects.list', async ({ page }) => {
    await openV3(page, '/inbox', {
      fixtures: {
        'projects.list': { error: 'Temporary error' },
      },
    });
    await act(page, 'inbox.retry');
    const call = await expectRpc(page, 'projects.list');
    expect(call.method).toBe('projects.list');
  });
});

// ---------------------------------------------------------------------------
// Accessibility and Keyboard (@a11y)
// ---------------------------------------------------------------------------

test.describe('Inbox accessibility (@a11y)', () => {
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`ready inbox axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/inbox', { lang: locale, theme, mode: 'simple' });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });

      test(`empty inbox axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/inbox', {
          lang: locale,
          theme,
          mode: 'simple',
          fixtures: {
            'projects.list': { result: [] },
          },
        });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });
    }
  }

  test('keyboard traversal reaches open project, review decision, and approve actions @a11y', async ({
    page,
  }) => {
    await openV3(page, '/inbox', { lang: 'en', mode: 'simple' });

    const seenActions = new Set<string>();
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press('Tab');
      const action = await page.evaluate(
        () => document.activeElement?.getAttribute('data-action') ?? ''
      );
      if (action) seenActions.add(action);
    }

    expect(seenActions.has('inbox.project.open')).toBe(true);
    expect(seenActions.has('inbox.decision.open')).toBe(true);
    expect(seenActions.has('inbox.gate.approve')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Visual baselines (@visual)
// ---------------------------------------------------------------------------

test.describe('Inbox visual baselines (@visual)', () => {
  const STATES = ['ready', 'sheet', 'empty', 'error'] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual screenshot: inbox ${state} ${vp.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            const isError = state === 'error';
            const isEmpty = state === 'empty';

            await openV3(page, '/inbox', {
              lang: locale,
              theme,
              mode: 'simple',
              viewport: { width: vp.width, height: vp.height },
              fixtures: isError
                ? { 'projects.list': { error: 'Daemon offline' } }
                : isEmpty
                  ? { 'projects.list': { result: [] } }
                  : {},
            });

            if (isError) {
              await expect(page.locator('[data-testid="inbox-error"]')).toBeVisible();
            } else if (isEmpty) {
              await expect(page.locator('[data-testid="inbox-empty"]')).toBeVisible();
            } else if (state === 'sheet') {
              await act(page, 'inbox.decision.open');
              await expect(page.locator('[data-testid="inbox-decision-sheet"]')).toBeVisible();
            } else {
              await expect(page.locator('[data-testid="inbox-ready"]')).toBeVisible();
            }

            await expect(page).toHaveScreenshot(
              `inbox-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
