import { expect, test } from '@playwright/test';

import {
  auditClipping,
  auditFocusWalk,
  auditIsClean,
  auditLayout,
  axeIsClean,
  clipsAreClean,
  describeAudit,
  describeAxe,
  describeClips,
  describeFocus,
  focusIsClean,
  runAxe,
} from '../harness';

import { act, expectRpc, openV3, auditViewportFit, describeViewportFit, viewportFitIsClean } from './support';

const BENCH_URL = '/p/proj-ui/r/run-code/overview';
const GATE_WAITING_URL = '/p/proj-store/r/run-gate-a/overview';

const TABS = [
  'overview',
  'plan',
  'files',
  'changes',
  'terminal',
  'team',
  'assistant',
  'cost',
  'artifacts',
  'preview',
] as const;

test.describe('Workbench (U4) — Journeys & Amendments', () => {
  test('renders rail, header, 14-stage strip, all 10 tabs, and advanced composer without fake controls', async ({
    page,
  }) => {
    await openV3(page, BENCH_URL, { lang: 'ar', theme: 'light', mode: 'advanced' });

    await expect(page.getByTestId('bench-rail')).toBeVisible();
    await expect(page.getByTestId('bench-header')).toBeVisible();

    const stages = page.getByTestId('bench-stage-strip').locator('li');
    await expect(stages).toHaveCount(14);

    const tabs = page.getByTestId('bench-tabs').locator('[role="tab"]');
    await expect(tabs).toHaveCount(10);

    const composer = page.getByTestId('bench-advanced-composer');
    await expect(composer).toBeVisible();
    // No fast-mode, permission chip, slash or mention controls
    await expect(composer.getByText(/fast|permission|eco/i)).toHaveCount(0);
  });

  test('Amendment (a): hides request-changes and reject behind capability flag OFF', async ({
    page,
  }) => {
    await openV3(page, GATE_WAITING_URL, { lang: 'ar', theme: 'light', mode: 'advanced' });

    await expect(page.getByTestId('bench-decision-card')).toBeVisible();
    await expect(page.getByTestId('bench-gate-approve-btn')).toBeVisible();
    await expect(page.getByTestId('bench-gate-changes-btn')).toHaveCount(0);
    await expect(page.getByTestId('bench-gate-reject-btn')).toHaveCount(0);
  });

  test('Amendment (b): counts/shows gate pill and DecisionCard ONLY for current-stage gate', async ({
    page,
  }) => {
    // run-code is at stage "code", while gates.list returns gate_a pending -> should NOT show gate waiting pill or DecisionCard
    await openV3(page, BENCH_URL, { lang: 'ar', theme: 'light', mode: 'advanced' });
    await expect(page.getByTestId('header-gate-pill')).toHaveCount(0);
    await expect(page.getByTestId('bench-decision-card')).toHaveCount(0);

    // run-gate-a is at stage "gate_a", and gates.list has gate_a pending -> SHOULD show both
    await openV3(page, GATE_WAITING_URL, { lang: 'ar', theme: 'light', mode: 'advanced' });
    await expect(page.getByTestId('header-gate-pill')).toBeVisible();
    await expect(page.getByTestId('bench-decision-card')).toBeVisible();
  });

  test('Amendment (c): Plan, Files, Changes show honest EmptyState when daemon returns no fixtures', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-ui/r/run-code/plan', {
      mode: 'advanced',
      fixtures: { 'runs.artifacts': { result: [] } },
    });
    await expect(page.getByTestId('bench-plan-empty')).toBeVisible();

    await openV3(page, '/p/proj-ui/r/run-code/files', {
      mode: 'advanced',
      fixtures: { 'files.tree': { result: [] } },
    });
    await expect(page.getByTestId('bench-files-empty')).toBeVisible();

    await openV3(page, '/p/proj-ui/r/run-code/changes', {
      mode: 'advanced',
      fixtures: { 'runs.artifacts': { result: [] } },
    });
    await expect(page.getByTestId('bench-changes-empty')).toBeVisible();
  });

  test('Terminal tab is read-only and has no input controls', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/terminal', { mode: 'advanced' });
    const panel = page.getByTestId('bench-tabpanel-terminal');
    await expect(panel).toBeVisible();
    await expect(panel.locator('input, textarea')).toHaveCount(0);
  });

  test('Assistant tab runs real Plan <-> Agent conversation via agent.* RPCs', async ({
    page,
  }) => {
    await openV3(page, '/p/proj-ui/r/run-code/assistant', {
      lang: 'ar',
      mode: 'advanced',
    });

    await expect(page.getByTestId('bench-tabpanel-assistant')).toBeVisible();

    // Owner clicks Agent mode -> approves via agent.approve_mode
    await act(page, 'bench.assistant.mode.agent');
    await expectRpc(page, 'agent.approve_mode', { run_id: 'run-code' });

    // Owner switches back to Plan mode -> agent.plan_mode
    await act(page, 'bench.assistant.mode.plan');
    await expectRpc(page, 'agent.plan_mode', { run_id: 'run-code' });

    // Owner sends real turn -> agent.turn_run and renders real daemon response
    await page
      .getByTestId('bench-assistant-input')
      .locator('textarea')
      .fill('ما هي خطة التنفيذ؟');
    await act(page, 'bench.assistant.send');
    await expectRpc(page, 'agent.turn_run', { run_id: 'run-code', input: 'ما هي خطة التنفيذ؟' });
    await expect(
      page.getByText('تم تجهيز الخطة، وهي بانتظار موافقتك للمتابعة.')
    ).toBeVisible();
  });

  test('EvidenceCard collects evidence through harness stub', async ({ page }) => {
    // run-gate-c is the one fixture at Gate C, so the card is collectable there and nowhere else.
    await openV3(page, '/p/proj-ui/r/run-gate-c/changes', { mode: 'advanced' });

    await expect(page.getByTestId('bench-evidence-card')).toBeVisible();
    await expect(page.getByTestId('bench-evidence-not-collected')).toBeVisible();

    // The command field is a TextField: its test id sits on the wrapper, the input inside it.
    await page.getByTestId('bench-evidence-command-input').locator('input').fill('pnpm test');
    await act(page, 'bench.evidence.collect');

    await expectRpc(page, 'gates.evidence', {
      run_id: 'run-gate-c',
      program: 'pnpm',
      args: ['test'],
    });

    await expect(page.getByTestId('bench-evidence-collected')).toBeVisible();
    await expect(page.getByTestId('bench-evidence-passing')).toBeVisible();
  });

  test('EvidenceCard file row opens the Files tab for the changed path', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-gate-c/changes', { mode: 'advanced' });

    await page.getByTestId('bench-evidence-command-input').locator('input').fill('pnpm test');
    await act(page, 'bench.evidence.collect');
    await expect(page.getByTestId('bench-evidence-collected')).toBeVisible();

    // The harness `gates.evidence` result names two changed files, so the card lists one row per
    // path; each row carries the action id and navigates to the Files tab of this run.
    const fileRows = page.getByTestId('bench-evidence-file');
    await expect(fileRows).toHaveCount(2);
    await act(page, 'bench.evidence.file.open');

    await expect(page).toHaveURL(/#\/p\/proj-ui\/r\/run-gate-c\/files/);
  });
});

test.describe('Workbench (U4) — Action ID contracts', () => {
  test('action: bench.project.new navigates to Home', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.project.new');
    await expect(page).toHaveURL(/#\/$/);
  });

  test('action: bench.run.select switches active run', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.run.select', { nth: 1 });
    await expect(page).toHaveURL(/#\/p\/proj-ui\/r\/run-research\/overview/);
  });

  test('action: bench.run.start calls runs.start', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.run.start');
    await expectRpc(page, 'runs.start', { projectId: 'proj-ui' });
  });

  test('action: bench.run.advance calls runs.advance', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.run.advance');
    await expectRpc(page, 'runs.advance', { run_id: 'run-code' });
  });

  test('action: bench.run.cancel.open opens cancel confirmation dialog', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.run.cancel.open');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('action: bench.run.cancel.confirm calls runs.cancel', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.run.cancel.open');
    await act(page, 'bench.run.cancel.confirm');
    await expectRpc(page, 'runs.cancel', { run_id: 'run-code' });
  });

  test('action: bench.tab.select navigates across tabs', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.tab.select', { nth: 4 });
    await expect(page).toHaveURL(/#\/p\/proj-ui\/r\/run-code\/terminal/);
    await expect(page.getByTestId('bench-tabpanel-terminal')).toBeVisible();
  });

  test('action: bench.gate.approve calls gates.approve and runs.advance', async ({ page }) => {
    await openV3(page, GATE_WAITING_URL, { mode: 'advanced' });
    await act(page, 'bench.gate.approve');
    await expectRpc(page, 'gates.approve', { run_id: 'run-gate-a', stage: 'gate_a' });
    await expectRpc(page, 'runs.advance', { run_id: 'run-gate-a' });
  });

  test('action: bench.gate.changes.send calls gates.changes when capability is enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ENABLE_RESUME__?: boolean }).__ENABLE_RESUME__ = true;
    });
    await openV3(page, GATE_WAITING_URL, { mode: 'advanced' });
    await act(page, 'bench.gate.changes.send');
    await page
      .getByTestId('decision-changes-textarea')
      .locator('textarea')
      .fill('يرجى توضيح الجدول الزمني');
    await page.getByTestId('decision-submit-changes-btn').click();
    await expectRpc(page, 'gates.changes', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      notes: 'يرجى توضيح الجدول الزمني',
    });
  });

  test('action: bench.gate.reject.confirm calls gates.reject when capability is enabled', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ENABLE_RESUME__?: boolean }).__ENABLE_RESUME__ = true;
    });
    await openV3(page, GATE_WAITING_URL, { mode: 'advanced' });
    await act(page, 'bench.gate.reject.confirm');
    await page
      .getByTestId('decision-reject-reason-input')
      .locator('textarea')
      .fill('خارج النطاق');
    await page.getByTestId('bench-confirm-reject-btn').click();
    await expectRpc(page, 'gates.reject', {
      run_id: 'run-gate-a',
      stage: 'gate_a',
      reason: 'خارج النطاق',
    });
  });

  test('action: bench.files.expand expands directory via files.tree', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/files', {
      mode: 'advanced',
      fixtures: {
        'files.tree': {
          result: [{ name: 'src', path: 'src', is_dir: true, size_bytes: 0 }],
        },
      },
    });
    await act(page, 'bench.files.expand');
    await expectRpc(page, 'files.tree', { project_id: 'proj-ui', path: 'src' });
  });

  test('action: bench.files.open reads file via files.read', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/files', {
      mode: 'advanced',
      fixtures: {
        'files.tree': {
          result: [{ name: 'README.md', path: 'README.md', is_dir: false, size_bytes: 64 }],
        },
        'files.read': {
          result: { path: 'README.md', content: '# Warsha', mime_type: 'text/markdown' },
        },
      },
    });
    await act(page, 'bench.files.open');
    await expectRpc(page, 'files.read', { project_id: 'proj-ui', path: 'README.md' });
    await expect(page.getByText('# Warsha')).toBeVisible();
  });

  test('action: bench.code.copy copies displayed file code', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/files', {
      mode: 'advanced',
      fixtures: {
        'files.tree': {
          result: [{ name: 'main.ts', path: 'main.ts', is_dir: false, size_bytes: 32 }],
        },
        'files.read': {
          result: { path: 'main.ts', content: 'export const ok = true;', mime_type: 'text/typescript' },
        },
      },
    });
    await act(page, 'bench.files.open');
    await expect(page.getByTestId('bench-code-copy-btn')).toBeVisible();
    await act(page, 'bench.code.copy');
  });

  test('action: bench.handoff.create calls handoff.create', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/changes', { mode: 'advanced' });
    await act(page, 'bench.handoff.create');
    await expectRpc(page, 'handoff.create', { run_id: 'run-code' });
    await expect(page.getByText('/tmp/warsha/handoff.zip')).toBeVisible();
  });

  test('action: bench.handoff.apply calls handoff.apply', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/changes', { mode: 'advanced' });
    await page
      .getByTestId('bench-handoff-path-input')
      .locator('input')
      .fill('/tmp/warsha/handoff.zip');
    await act(page, 'bench.handoff.apply');
    await expectRpc(page, 'handoff.apply', { path: '/tmp/warsha/handoff.zip', owner_wins: true });
  });

  test('action: bench.terminal.follow toggles terminal stream follow state', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/terminal', { mode: 'advanced' });
    const btn = page.getByTestId('bench-terminal-follow-btn');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await act(page, 'bench.terminal.follow');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('action: bench.terminal.copy copies terminal transcript', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/terminal', { mode: 'advanced' });
    await act(page, 'bench.terminal.copy');
    await expect(page.getByTestId('bench-terminal-transcript')).toBeVisible();
  });

  test('action: bench.team.model.set calls roles.set', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/team', { mode: 'advanced' });
    await act(page, 'bench.team.model.set', { nth: 2 });
    await expectRpc(page, 'roles.set');
  });

  test('action: bench.assistant.send calls agent.turn_run', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/assistant', { mode: 'advanced' });
    await page
      .getByTestId('bench-assistant-input')
      .locator('textarea')
      .fill('مرحبا');
    await act(page, 'bench.assistant.send');
    await expectRpc(page, 'agent.turn_run', { run_id: 'run-code', input: 'مرحبا' });
  });

  test('action: bench.assistant.mode.plan calls agent.plan_mode', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/assistant', { mode: 'advanced' });
    await act(page, 'bench.assistant.mode.plan');
    await expectRpc(page, 'agent.plan_mode', { run_id: 'run-code' });
  });

  test('action: bench.assistant.mode.agent calls agent.approve_mode', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/assistant', { mode: 'advanced' });
    await act(page, 'bench.assistant.mode.agent');
    await expectRpc(page, 'agent.approve_mode', { run_id: 'run-code' });
  });

  test('action: bench.budget.save calls budget.set', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/cost', { mode: 'advanced' });
    await page.getByTestId('bench-cost-budget-input').locator('input').fill('45');
    await act(page, 'bench.budget.save');
    await expectRpc(page, 'budget.set', { projectId: 'proj-ui', cents: 4500 });
  });

  test('action: bench.artifact.open opens artifact sheet', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/artifacts', { mode: 'advanced' });
    await act(page, 'bench.artifact.open');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('action: bench.artifact.copy-path copies artifact path', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/artifacts', { mode: 'advanced' });
    await act(page, 'bench.artifact.copy-path');
    await expect(page.getByTestId('bench-artifact-item-prd_spec')).toBeVisible();
  });

  test('action: bench.preview.start calls preview.start', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/preview', { mode: 'advanced' });
    await act(page, 'bench.preview.start');
    await expectRpc(page, 'preview.start', { project_id: 'proj-ui' });
  });

  test('action: bench.preview.stop calls preview.stop', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/preview', {
      mode: 'advanced',
      fixtures: {
        'preview.status': {
          result: {
            project_id: 'proj-ui',
            process_id: 'proc-1',
            command: 'npm',
            args: ['run', 'dev'],
            status: 'running',
            url: 'http://127.0.0.1:4173',
          },
        },
      },
    });
    await act(page, 'bench.preview.stop');
    await expectRpc(page, 'preview.stop', { project_id: 'proj-ui' });
  });

  test('action: bench.preview.open opens preview URL in browser', async ({ page }) => {
    await openV3(page, '/p/proj-ui/r/run-code/preview', {
      mode: 'advanced',
      fixtures: {
        'preview.status': {
          result: {
            project_id: 'proj-ui',
            process_id: 'proc-1',
            command: 'npm',
            args: ['run', 'dev'],
            status: 'running',
            url: 'http://127.0.0.1:4173',
          },
        },
      },
    });
    await page.evaluate(() => {
      const win = window as unknown as { __OPENED?: string[] };
      win.__OPENED = [];
      window.open = (url) => {
        win.__OPENED?.push(String(url ?? ''));
        return null;
      };
    });
    await act(page, 'bench.preview.open');
    const opened = await page.evaluate(
      () => (window as unknown as { __OPENED?: string[] }).__OPENED ?? []
    );
    expect(opened).toContain('http://127.0.0.1:4173');
  });

  test('action: bench.followup.send calls runs.followup', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await page
      .getByTestId('bench-composer-textarea')
      .locator('textarea')
      .fill('أضف اختبارات');
    await act(page, 'bench.followup.send');
    await expectRpc(page, 'runs.followup', { run_id: 'run-code', prompt: 'أضف اختبارات' });
  });

  test('action: bench.harness.select calls harness.select', async ({ page }) => {
    await openV3(page, BENCH_URL, {
      mode: 'advanced',
      fixtures: {
        'harness.list': {
          result: [
            {
              id: 'wf-1',
              version: '1.0',
              name: 'Flow One',
              description: '',
              stages: [],
              rules: {
                max_repair_iterations: 1,
                budget_cap_cents: null,
                allow_parallel_subagents: false,
                require_verification_receipt: false,
              },
              preset: true,
              active: true,
              created_at: '2026-10-05T07:00:00.000Z',
            },
          ],
        },
      },
    });
    await act(page, 'bench.harness.select');
    await expectRpc(page, 'harness.select', { harness_id: 'wf-1', project_id: 'proj-ui' });
  });

  test('action: bench.runmode.set calls runmode.set', async ({ page }) => {
    await openV3(page, BENCH_URL, {
      mode: 'advanced',
      fixtures: {
        'runmode.list': {
          result: [{ mode: 'local', bind_host: '127.0.0.1', allowed_hosts: [], relay_url: null }],
        },
      },
    });
    await act(page, 'bench.runmode.set');
    await expectRpc(page, 'runmode.set');
  });

  test('action: bench.stream.reconnect reloads stream via runs.subscribe', async ({ page }) => {
    await openV3(page, BENCH_URL, { mode: 'advanced' });
    await act(page, 'bench.stream.reconnect');
    await expectRpc(page, 'runs.subscribe', { run_id: 'run-code' });
  });
});

test.describe('Narrow Workbench (below 768px)', () => {
  const PHONE = { width: 390, height: 844 } as const;

  test('bench.rail.open moves the rail into a Sheet, and a run choice closes it', async ({ page }) => {
    await openV3(page, BENCH_URL, { lang: 'en', mode: 'advanced', viewport: PHONE });

    // The rail left the layout: it is neither painted nor reachable beside the screen at 390.
    await expect(page.locator('[data-testid="bench-rail"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bench-rail-open-btn"]')).toBeVisible();

    await act(page, 'bench.rail.open');
    const sheet = page.locator('[data-testid="bench-rail-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-testid="bench-rail"]')).toBeVisible();

    // Choosing the other project's run from the Sheet navigates and hands the screen back.
    const runButton = sheet.locator('[data-action="bench.run.select"]').first();
    await expect(runButton).toBeVisible();
    await runButton.click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/#\/p\/[^/]+\/r\/[^/]+\/overview$/);
  });

  test('the decision card keeps its primary action on screen at 390x844', async ({ page }) => {
    await openV3(page, GATE_WAITING_URL, { lang: 'en', mode: 'advanced', viewport: PHONE });

    const approve = page.locator('[data-testid="bench-gate-approve-btn"]');
    await expect(approve).toBeVisible();
    const box = await approve.boundingBox();
    expect(box, 'the primary decision action has no box').not.toBeNull();
    expect(box!.x, 'the approve button starts outside the phone viewport').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'the approve button runs past the phone viewport').toBeLessThanOrEqual(
      PHONE.width
    );
    expect(box!.y + box!.height, 'the approve button sits below the phone viewport').toBeLessThanOrEqual(
      PHONE.height
    );
  });
});

test.describe('@a11y Workbench axe and keyboard', () => {
  for (const lang of ['ar', 'en'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`@a11y bench overview passes axe AA and keyboard walk (${lang} ${theme})`, async ({
        page,
      }) => {
        await openV3(page, BENCH_URL, {
          lang,
          theme,
          mode: 'advanced',
          viewport: { width: 1280, height: 800 },
        });

        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

        const axe = await runAxe(page);
        expect(axeIsClean(axe), `axe violations:\n${describeAxe(axe)}`).toBe(true);

        const focus = await auditFocusWalk(page);
        expect(focusIsClean(focus), `focus problems:\n${describeFocus(focus)}`).toBe(true);
        expect(focus.stops.length).toBeGreaterThan(0);
      });
    }
  }
});

test.describe('@visual Workbench tabs & states', () => {
  const VISUAL_VIEWPORTS = [
    { name: '1280x800', width: 1280, height: 800 },
    { name: '390x844', width: 390, height: 844 },
  ] as const;

  for (const viewport of VISUAL_VIEWPORTS) {
    for (const lang of ['ar', 'en'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        for (const tab of TABS) {
          test(`@visual bench-${tab}-${viewport.name}-${lang}-${theme}`, async ({ page }) => {
            await openV3(page, `/p/proj-ui/r/run-code/${tab}`, {
              lang,
              theme,
              mode: 'advanced',
              viewport: { width: viewport.width, height: viewport.height },
            });

            const layout = await auditLayout(page, '[data-testid="bench-container"]', theme);
            expect.soft(auditIsClean(layout), describeAudit(layout)).toBe(true);

            const clips = await auditClipping(page, '[data-testid="bench-container"]');
            expect.soft(clipsAreClean(clips), describeClips(clips)).toBe(true);

            const fit = await auditViewportFit(page);
            expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
            await expect(page).toHaveScreenshot(
              `bench-${tab}-${viewport.name}-${lang}-${theme}.png`
            );
          });
        }

        test(`@visual bench-gate-waiting-${viewport.name}-${lang}-${theme}`, async ({ page }) => {
          await openV3(page, GATE_WAITING_URL, {
            lang,
            theme,
            mode: 'advanced',
            viewport: { width: viewport.width, height: viewport.height },
          });

          const layout = await auditLayout(page, '[data-testid="bench-container"]', theme);
          expect.soft(auditIsClean(layout), describeAudit(layout)).toBe(true);

          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(
            `bench-gate-waiting-${viewport.name}-${lang}-${theme}.png`
          );
        });

        test(`@visual bench-error-${viewport.name}-${lang}-${theme}`, async ({ page }) => {
          await openV3(page, BENCH_URL, {
            lang,
            theme,
            mode: 'advanced',
            viewport: { width: viewport.width, height: viewport.height },
            fixtures: { 'runs.get': { error: 'Daemon unreachable' } },
          });

          const layout = await auditLayout(page, '[data-testid="bench-error"]', theme);
          expect.soft(auditIsClean(layout), describeAudit(layout)).toBe(true);

          const fit = await auditViewportFit(page);
          expect.soft(viewportFitIsClean(fit), `viewport fit:\n${describeViewportFit(fit)}`).toBe(true);
          await expect(page).toHaveScreenshot(
            `bench-error-${viewport.name}-${lang}-${theme}.png`
          );
        });
      }
    }
  }
});
