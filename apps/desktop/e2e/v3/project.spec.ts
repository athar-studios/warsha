import { expect, test } from '@playwright/test';

import {
  auditFocusWalk,
  describeAxe,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../harness';

import { act, expectRpc, openV3, rpcCalls, auditViewportFit, describeViewportFit, viewportFitIsClean } from './support';

/**
 * `health` answering what `warshad` answers once its store carries the K2 run-version column.
 *
 * This is the daemon-true path to the run-ending controls (R-UI-2 D4): the screen reads one
 * capability out of `health`, so a case that wants the controls turns them on by having the
 * daemon say so — there is no `window` flag left to flip.
 */
const RUN_CONTROLS_HEALTH = {
  result: {
    status: 'ok',
    version: '0.2.0',
    capabilities: { daemon: true, providers: true, keychain: true, run_controls: true },
  },
};

/** The same daemon with `run_controls: false`, for the cases that assert the controls are absent. */
const NO_RUN_CONTROLS_HEALTH = {
  result: {
    status: 'ok',
    version: '0.2.0',
    capabilities: { daemon: true, providers: true, keychain: true, run_controls: false },
  },
};

const LOCALES = ['ar', 'en'] as const;
const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { width: 1280, height: 800, name: '1280x800' },
  { width: 390, height: 844, name: '390x844' },
] as const;

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

test.describe('Project journeys', () => {
  test('renders 5-stage map, current sentence, activity feed, and hides decision card when run stage is not awaiting gate', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en', mode: 'simple' });

    await expect(page.locator('[data-testid="project-ready"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-stepper"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-latest-sentence"]')).toContainText('Build');
    await expect(page.locator('[data-testid="project-activity-feed"]')).toBeVisible();

    // proj-ui latest run is at stage 'code' ('running'); even though gate_a is pending in GATES,
    // no decision card should be shown because no gate is pending at the CURRENT stage.
    await expect(page.locator('[data-testid="project-decision-card"]')).toHaveCount(0);
    await expect(page.locator('[data-action="project.gate.changes.open"]')).toHaveCount(0);
    await expect(page.locator('[data-action="project.gate.reject.open"]')).toHaveCount(0);
  });

  test('ignores all-pending future gates when current stage is code', async ({ page }) => {
    await openV3(page, '/p/proj-ui', {
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

    await expect(page.locator('[data-testid="project-decision-card"]')).toHaveCount(0);
  });

  test('shows ONE decision card when a gate awaits at current stage with no request-changes/reject visible, and approve calls gates.approve then runs.advance', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-store', { lang: 'en', mode: 'simple' });

    const card = page.locator('[data-testid="project-decision-card"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Do we approve the idea and brief?');

    // Request-changes and reject remain hidden
    await expect(page.locator('[data-action="project.gate.changes.open"]')).toHaveCount(0);
    await expect(page.locator('[data-action="project.gate.reject.open"]')).toHaveCount(0);

    await act(page, 'project.gate.approve');
    await expectRpc(page, 'gates.approve', { run_id: 'run-gate-a', stage: 'gate_a' });
    await expectRpc(page, 'runs.advance', { run_id: 'run-gate-a' });

    const calls = await rpcCalls(page);
    const approveIdx = calls.findIndex((c) => c.method === 'gates.approve');
    const advanceIdx = calls.findIndex((c) => c.method === 'runs.advance');
    expect(approveIdx).toBeGreaterThanOrEqual(0);
    expect(advanceIdx).toBeGreaterThan(approveIdx);
  });

  test('renders honest empty, error, and failed-run restart states', async ({ page }) => {
    // The daemon answers an unknown project id with `-32000 "project not found: <id>"`
    // (`crates/warshad/src/lib.rs` get_project mapping StoreError), and the screen reads that as the
    // empty state rather than an error banner — a deleted project is not an outage.
    await openV3(page, '/p/missing-proj', {
      lang: 'en',
      fixtures: {
        'projects.get': { error: 'project not found: missing-proj' },
      },
    });
    await expect(page.locator('[data-testid="project-empty"]')).toBeVisible();

    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'projects.get': { error: 'Daemon offline' },
      },
    });
    await expect(page.locator('[data-testid="project-error"]')).toBeVisible();

    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'runs.list': {
          result: [
            {
              id: 'run-failed',
              projectId: 'proj-ui',
              stage: 'code',
              status: 'failed',
              startedAt: '2026-10-05T08:00:00.000Z',
              updatedAt: '2026-10-05T09:00:00.000Z',
            },
          ],
        },
      },
    });
    await expect(page.locator('[data-testid="project-run-ended-banner"]')).toBeVisible();
    await expect(page.locator('[data-action="project.run.restart"]')).toBeVisible();
  });

  test('sends followup instructions via runs.followup', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en', mode: 'simple' });

    const textarea = page.locator('[data-testid="project-followup-textarea"] textarea');
    await textarea.fill('Please verify mobile spacing');
    await act(page, 'project.followup.send');

    await expectRpc(page, 'runs.followup', {
      run_id: 'run-code',
      prompt: 'Please verify mobile spacing',
    });
    await expect(textarea).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Action IDs (19/19)
// ---------------------------------------------------------------------------

test.describe('Project action ids', () => {
  test('project.gate.approve approves gate and advances run', async ({ page }) => {
    await openV3(page, '/p/proj-store', { lang: 'en' });
    await act(page, 'project.gate.approve');
    await expectRpc(page, 'gates.approve', { run_id: 'run-gate-a', stage: 'gate_a' });
    await expectRpc(page, 'runs.advance', { run_id: 'run-gate-a' });
  });

  test('project.gate.changes.open toggles requested changes input when the daemon advertises run controls', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-store', {
      lang: 'en',
      fixtures: { health: RUN_CONTROLS_HEALTH },
    });
    await act(page, 'project.gate.changes.open');
    await expect(page.locator('[data-testid="project-changes-textarea"] textarea')).toBeVisible();
  });

  test('project.gate.changes.send calls gates.changes when the daemon advertises run controls', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-store', {
      lang: 'en',
      fixtures: { health: RUN_CONTROLS_HEALTH },
    });
    await act(page, 'project.gate.changes.open');
    await page.locator('[data-testid="project-changes-textarea"] textarea').fill('Revise spec');
    await act(page, 'project.gate.changes.send');
    await expectRpc(page, 'gates.changes', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      notes: 'Revise spec',
    });
  });

  test('project.gate.reject.open opens reject dialog when the daemon advertises run controls', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-store', {
      lang: 'en',
      fixtures: { health: RUN_CONTROLS_HEALTH },
    });
    await act(page, 'project.gate.reject.open');
    await expect(page.locator('[data-testid="project-reject-dialog"]')).toBeVisible();
  });

  test('project.gate.reject.confirm calls gates.reject when the daemon advertises run controls', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-store', {
      lang: 'en',
      fixtures: { health: RUN_CONTROLS_HEALTH },
    });
    await act(page, 'project.gate.reject.open');
    await page.locator('[data-testid="project-reject-reason"] textarea').fill('Scope mismatch');
    await act(page, 'project.gate.reject.confirm');
    await expectRpc(page, 'gates.reject', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      reason: 'Scope mismatch',
    });
  });

  test('project.preview.start starts live preview', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.preview.start');
    await expectRpc(page, 'preview.start', { project_id: 'proj-ui', command: 'pnpm dev' });
  });

  test('project.preview.stop stops active preview', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.preview.start');
    await expect(page.locator('[data-action="project.preview.stop"]')).toBeVisible();
    await act(page, 'project.preview.stop');
    await expectRpc(page, 'preview.stop', { project_id: 'proj-ui' });
  });

  test('project.preview.open opens active preview URL', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url?: string | URL) => {
        (window as unknown as Record<string, unknown>).__openedPreviewUrl = String(url);
        return null;
      }) as typeof window.open;
    });
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'preview.status': {
          result: {
            project_id: 'proj-ui',
            process_id: 'proc-1',
            command: 'pnpm',
            args: ['dev'],
            status: 'running',
            url: 'http://127.0.0.1:4173',
          },
        },
      },
    });
    await act(page, 'project.preview.open');
    const opened = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__openedPreviewUrl
    );
    expect(opened).toBe('http://127.0.0.1:4173');
  });

  test('project.code.open opens repository URL when artifact provides one', async ({ page }) => {
    await page.addInitScript(() => {
      window.open = ((url?: string | URL) => {
        (window as unknown as Record<string, unknown>).__openedCodeUrl = String(url);
        return null;
      }) as typeof window.open;
    });
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'runs.artifacts': {
          result: [
            {
              name: 'code_pr',
              content: 'Pull request: https://github.com/warsha/demo/pull/7',
              stage: 'code',
              role: 'coder',
              created_at: '2026-10-05T09:00:00.000Z',
              updated_at: '2026-10-05T09:00:00.000Z',
              version: 1,
            },
          ],
        },
      },
    });
    await act(page, 'project.code.open');
    const opened = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__openedCodeUrl
    );
    expect(opened).toBe('https://github.com/warsha/demo/pull/7');
  });

  test('project.tests.open opens test artifact sheet', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.tests.open');
    await expect(page.locator('[data-testid="project-tests-sheet"]')).toBeVisible();
  });

  test('project.activity.toggle collapses and expands activity feed', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await expect(page.locator('[data-testid="project-activity-feed"]')).toBeVisible();
    await act(page, 'project.activity.toggle');
    await expect(page.locator('[data-testid="project-activity-feed"]')).toHaveCount(0);
    await act(page, 'project.activity.toggle');
    await expect(page.locator('[data-testid="project-activity-feed"]')).toBeVisible();
  });

  test('project.followup.send dials runs.followup', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await page.locator('[data-testid="project-followup-textarea"] textarea').fill('Check dark mode');
    await act(page, 'project.followup.send');
    await expectRpc(page, 'runs.followup', { run_id: 'run-code', prompt: 'Check dark mode' });
  });

  test('project.budget.open opens budget sheet', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.budget.open');
    await expect(page.locator('[data-testid="project-budget-sheet"]')).toBeVisible();
  });

  test('project.budget.save dials budget.set with cents', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.budget.open');
    await page.locator('[data-testid="budget-custom-input"]').fill('35');
    await act(page, 'project.budget.save');
    await expectRpc(page, 'budget.set', { projectId: 'proj-ui', cents: 3500 });
  });

  test('project.run.cancel.open opens cancel dialog when the daemon advertises run controls', async ({ page }) => {
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: { health: RUN_CONTROLS_HEALTH },
    });
    await act(page, 'project.run.cancel.open');
    await expect(page.locator('[data-testid="project-cancel-dialog"]')).toBeVisible();
  });

  test('project.run.cancel.confirm calls runs.cancel when the daemon advertises run controls', async ({ page }) => {
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: { health: RUN_CONTROLS_HEALTH },
    });
    await act(page, 'project.run.cancel.open');
    await act(page, 'project.run.cancel.confirm');
    await expectRpc(page, 'runs.cancel', { run_id: 'run-code' });
  });

  test('hides the run-ending controls when the daemon answers run_controls: false', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-store', {
      lang: 'en',
      fixtures: { health: NO_RUN_CONTROLS_HEALTH },
    });

    await expect(page.locator('[data-action="project.gate.approve"]')).toBeVisible();
    for (const id of [
      'project.gate.changes.open',
      'project.gate.changes.send',
      'project.gate.reject.open',
      'project.gate.reject.confirm',
    ]) {
      await expect(page.locator(`[data-action="${id}"]`)).toHaveCount(0);
    }
  });

  test('project.run.restart dials runs.start on failed run', async ({ page }) => {
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'runs.list': {
          result: [
            {
              id: 'run-failed',
              projectId: 'proj-ui',
              stage: 'code',
              status: 'failed',
              startedAt: '2026-10-05T08:00:00.000Z',
              updatedAt: '2026-10-05T09:00:00.000Z',
            },
          ],
        },
      },
    });
    await act(page, 'project.run.restart');
    await expectRpc(page, 'runs.start', { projectId: 'proj-ui' });
  });

  test('project.open-advanced switches app_mode to advanced on the same route', async ({ page }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en', mode: 'simple' });
    await act(page, 'project.open-advanced');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'advanced');
    // `set_config` is the Tauri shell's channel, so the write lands in the page-side stub record
    // (`window.__WARSHA_STUB__.configWrites`), exactly as `frame.spec.ts` reads it.
    const configWrites = await page.evaluate(
      () =>
        (
          window as unknown as {
            __WARSHA_STUB__?: { configWrites: { key: string; value: string }[] };
          }
        ).__WARSHA_STUB__?.configWrites ?? []
    );
    expect(configWrites).toContainEqual({ key: 'app_mode', value: 'advanced' });
    await expect(page).toHaveURL(/#\/p\/proj-ui$/);
  });

  test('project.retry re-dials projects.get', async ({ page }) => {
    await openV3(page, '/p/proj-ui', {
      lang: 'en',
      fixtures: {
        'projects.get': { error: 'Temporary outage' },
      },
    });
    const beforeCount = (await rpcCalls(page)).filter((c) => c.method === 'projects.get').length;
    await act(page, 'project.retry');
    await expect
      .poll(async () => (await rpcCalls(page)).filter((c) => c.method === 'projects.get').length)
      .toBeGreaterThan(beforeCount);
  });
});

// ---------------------------------------------------------------------------
// Accessibility and Keyboard (@a11y)
// ---------------------------------------------------------------------------

test.describe('Project accessibility (@a11y)', () => {
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      test(`ready project axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/p/proj-ui', { lang: locale, theme, mode: 'simple' });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });

      test(`pending gate project axe AA clean and keyboard complete in ${locale} ${theme} @a11y`, async ({
        page,
      }) => {
        await openV3(page, '/p/proj-store', { lang: locale, theme, mode: 'simple' });

        const axe = await runAxe(page);
        expect(axe.violations, `axe found WCAG AA violations:\n${describeAxe(axe)}`).toEqual([]);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus walk issues:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });
    }
  }

  test('keyboard traversal reaches header actions, preview, tests, activity, and followup dock @a11y', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-ui', { lang: 'en', mode: 'simple' });

    const seenActions = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const action = await page.evaluate(
        () => document.activeElement?.getAttribute('data-action') ?? ''
      );
      if (action) seenActions.add(action);
    }

    expect(seenActions.has('project.open-advanced')).toBe(true);
    expect(seenActions.has('project.budget.open')).toBe(true);
    expect(seenActions.has('project.preview.start')).toBe(true);
    expect(seenActions.has('project.tests.open')).toBe(true);
    expect(seenActions.has('project.activity.toggle')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Visual baselines (@visual)
// ---------------------------------------------------------------------------

test.describe('Project visual baselines (@visual)', () => {
  const STATES = ['ready', 'gate', 'empty', 'error', 'failed'] as const;

  for (const state of STATES) {
    for (const vp of VIEWPORTS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          test(`visual screenshot: project ${state} ${vp.name} ${locale} ${theme} @visual`, async ({
            page,
          }) => {
            const route = state === 'gate' ? '/p/proj-store' : state === 'empty' ? '/p/missing' : '/p/proj-ui';

            await openV3(page, route, {
              lang: locale,
              theme,
              mode: 'simple',
              viewport: { width: vp.width, height: vp.height },
              fixtures:
                state === 'error'
                  ? { 'projects.get': { error: 'Daemon offline' } }
                  : state === 'empty'
                    ? { 'projects.get': { error: 'project not found: missing' } }
                    : state === 'failed'
                      ? {
                          'runs.list': {
                            result: [
                              {
                                id: 'run-failed',
                                projectId: 'proj-ui',
                                stage: 'code',
                                status: 'failed',
                                startedAt: '2026-10-05T08:00:00.000Z',
                                updatedAt: '2026-10-05T09:00:00.000Z',
                              },
                            ],
                          },
                        }
                      : {},
            });

            if (state === 'error') {
              await expect(page.locator('[data-testid="project-error"]')).toBeVisible();
            } else if (state === 'empty') {
              await expect(page.locator('[data-testid="project-empty"]')).toBeVisible();
            } else if (state === 'failed') {
              await expect(page.locator('[data-testid="project-run-ended-banner"]')).toBeVisible();
            } else if (state === 'gate') {
              await expect(page.locator('[data-testid="project-decision-card"]')).toBeVisible();
            } else {
              await expect(page.locator('[data-testid="project-ready"]')).toBeVisible();
            }

            const fit = await auditViewportFit(page);
            expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
            await expect(page).toHaveScreenshot(
              `project-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
