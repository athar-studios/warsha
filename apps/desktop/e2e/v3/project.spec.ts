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
    await expect(card).toContainText('Should we approve the idea and brief?');

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
    await openV3(page, '/p/missing-proj', {
      lang: 'en',
      fixtures: {
        'projects.get': { result: null },
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

  test('project.gate.changes.open toggles requested changes input when capability enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/p/proj-store', { lang: 'en' });
    await act(page, 'project.gate.changes.open');
    await expect(page.locator('[data-testid="project-changes-textarea"] textarea')).toBeVisible();
  });

  test('project.gate.changes.send calls gates.changes when capability enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/p/proj-store', { lang: 'en' });
    await act(page, 'project.gate.changes.open');
    await page.locator('[data-testid="project-changes-textarea"] textarea').fill('Revise spec');
    await act(page, 'project.gate.changes.send');
    await expectRpc(page, 'gates.changes', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      notes: 'Revise spec',
    });
  });

  test('project.gate.reject.open opens reject dialog when capability enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/p/proj-store', { lang: 'en' });
    await act(page, 'project.gate.reject.open');
    await expect(page.locator('[data-testid="project-reject-dialog"]')).toBeVisible();
  });

  test('project.gate.reject.confirm calls gates.reject when capability enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/p/proj-store', { lang: 'en' });
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

  test('project.run.cancel.open opens cancel dialog when capability enabled', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.run.cancel.open');
    await expect(page.locator('[data-testid="project-cancel-dialog"]')).toBeVisible();
  });

  test('project.run.cancel.confirm calls runs.cancel when capability enabled', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    });
    await openV3(page, '/p/proj-ui', { lang: 'en' });
    await act(page, 'project.run.cancel.open');
    await act(page, 'project.run.cancel.confirm');
    await expectRpc(page, 'runs.cancel', { run_id: 'run-code' });
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
    const report = await openV3(page, '/p/proj-ui', { lang: 'en', mode: 'simple' });
    await act(page, 'project.open-advanced');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'advanced');
    expect(report.configWrites).toContainEqual({ key: 'app_mode', value: 'advanced' });
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
                    ? { 'projects.get': { result: null } }
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

            await expect(page).toHaveScreenshot(
              `project-${state}-${vp.name}-${locale}-${theme}.png`
            );
          });
        }
      }
    }
  }
});
