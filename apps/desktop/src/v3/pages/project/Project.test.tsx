import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  BudgetStatus,
  GateSummary,
  LivePreview,
  ProjectId,
  ProjectSummary,
  RunArtifact,
  RunId,
  RunStreamSync,
  RunSummary,
  WarshaClient,
} from '@warsha/client';
import { I18nProvider, enCatalog } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider, useDataReady } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { RouterProvider } from '../../router';

import ProjectPage, {
  buildSimpleStepperStages,
  computeRunStatusPill,
  extractCodeUrl,
  extractRetryHint,
  extractTestArtifacts,
  findPendingGateAtCurrentStage,
  findRetryHint,
  retryHintKey,
  retryHintText,
} from './index';

function ReadyInspector(): React.ReactElement {
  const { isReady } = useDataReady();
  return <div data-testid="ready-inspector">{String(isReady)}</div>;
}

const SAMPLE_PROJECT: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'متجر ورشة',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const RUNNING_RUN: RunSummary = {
  id: 'run-code' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  runMode: 'agent',
  startedAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const AWAITING_GATE_RUN: RunSummary = {
  id: 'run-gate' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'gate_a',
  status: 'awaiting_gate',
  runMode: 'agent',
  startedAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const PAUSED_RUN: RunSummary = {
  id: 'run-paused' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'idea',
  status: 'paused',
  runMode: 'agent',
  startedAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const FAILED_RUN: RunSummary = {
  id: 'run-failed' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'failed',
  runMode: 'agent',
  startedAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const ALL_PENDING_GATES: GateSummary[] = [
  { stage: 'gate_a', state: { state: 'pending' } },
  { stage: 'gate_b', state: { state: 'pending' } },
  { stage: 'gate_c', state: { state: 'pending' } },
  { stage: 'gate_d', state: { state: 'pending' } },
];

function createMockClient(overrides: Partial<Record<string, unknown>> = {}): WarshaClient {
  const defaultStreamSync: RunStreamSync = {
    seq: 1,
    gap_detected: false,
    resync_required: false,
    dropped_count: 0,
    run: null,
    events: [
      {
        id: 'evt-1',
        runId: 'run-code' as RunId,
        stage: 'code',
        role: 'coder',
        kind: 'agent_step',
        payload: { summary: 'Implementing project view' },
        costCents: null,
        createdAt: '2026-10-02T09:05:00.000Z',
        deviceId: null,
      },
    ],
  };

  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.3.0' }),
    listProviders: vi.fn().mockResolvedValue([{ name: 'p1', kind: 'open_router', enabled: true }]),
    getProject: vi.fn().mockResolvedValue(SAMPLE_PROJECT),
    listRuns: vi.fn().mockResolvedValue([RUNNING_RUN]),
    getRunEvents: vi.fn().mockResolvedValue([]),
    getGates: vi.fn().mockResolvedValue(ALL_PENDING_GATES),
    getProjectBudget: vi.fn().mockResolvedValue({
      totalBudgetUsd: 12,
      spentUsd: 4.37,
      remainingUsd: 7.63,
    } satisfies BudgetStatus),
    previewStatus: vi.fn().mockRejectedValue(new Error('preview not found')),
    startPreview: vi.fn().mockResolvedValue({
      projectId: 'proj-1' as ProjectId,
      processId: 'proc-1',
      command: 'pnpm',
      args: ['dev'],
      status: 'running',
      url: 'http://127.0.0.1:4173',
    } satisfies LivePreview),
    stopPreview: vi.fn().mockResolvedValue(undefined),
    getRunArtifacts: vi.fn().mockResolvedValue([
      {
        name: 'test_report',
        content: '12 passed, 0 failed',
        stage: 'review_qa_security',
        role: 'reviewer',
        created_at: '2026-10-02T09:00:00.000Z',
        updated_at: '2026-10-02T09:00:00.000Z',
        version: 1,
      },
    ] satisfies RunArtifact[]),
    subscribeRun: vi.fn().mockResolvedValue(defaultStreamSync),
    approveGate: vi.fn().mockResolvedValue(undefined),
    advanceRun: vi
      .fn()
      .mockResolvedValue({ ...AWAITING_GATE_RUN, stage: 'research', status: 'running' }),
    requestChanges: vi.fn().mockResolvedValue(undefined),
    rejectGate: vi.fn().mockResolvedValue(undefined),
    followupRun: vi.fn().mockResolvedValue(RUNNING_RUN),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue({ ...RUNNING_RUN, status: 'cancelled' }),
    startRun: vi.fn().mockResolvedValue(RUNNING_RUN),
    ...overrides,
  } as unknown as WarshaClient;
}

/** The same mock client, with `health` advertising the run-ending controls the way `warshad` does. */
function createRunEndingClient(overrides: Partial<Record<string, unknown>> = {}): WarshaClient {
  return createMockClient({
    health: vi.fn().mockResolvedValue({
      status: 'ok',
      version: '0.3.0',
      capabilities: { runControls: true },
    }),
    ...overrides,
  });
}

function renderProject(
  client: WarshaClient | null,
  path = '/p/proj-1',
  locale: 'en' | 'ar' = 'en'
) {
  return render(
    <ClientProvider client={client ?? undefined}>
      <CapabilitiesProvider client={client ?? undefined}>
        <I18nProvider initialLocale={locale}>
          <DensityProvider initialMode="simple">
            <DataReadyProvider>
              <RouterProvider initialPath={path}>
                <ReadyInspector />
                <ProjectPage />
              </RouterProvider>
            </DataReadyProvider>
          </DensityProvider>
        </I18nProvider>
      </CapabilitiesProvider>
    </ClientProvider>
  );
}

describe('live gate regressions', () => {
  const brief = {
    name: 'brief',
    content:
      '# Fake Intake Summary\n\n## Brief\n- Goal, audience and constraints recorded for gate A.',
    stage: 'idea',
    role: 'intake',
    created_at: '',
    updated_at: '',
    version: 1,
  } satisfies RunArtifact;

  it.each(['live', 'persisted'])(
    'shows Gate A and its brief from a %s role-less stage event without remounting',
    async (source) => {
      vi.useFakeTimers();
      const ideaRun = { ...AWAITING_GATE_RUN, stage: 'idea', status: 'running' };
      const event = {
        id: 'gate-entry',
        runId: ideaRun.id,
        stage: 'gate_a',
        role: null,
        kind: 'StageStarted',
        payload: { from: 'idea', to: 'gate_a' },
        costCents: null,
        createdAt: '2026-11-26T00:00:01Z',
        deviceId: null,
      };
      let atGate = false;
      const client = createMockClient({
        listRuns: vi.fn().mockImplementation(async () => [atGate ? AWAITING_GATE_RUN : ideaRun]),
        getRunEvents: vi
          .fn()
          .mockImplementation(async () => (atGate && source === 'persisted' ? [event] : [])),
        getGates: vi.fn().mockImplementation(async () => (atGate ? ALL_PENDING_GATES : [])),
        getRunArtifacts: vi.fn().mockImplementation(async () => (atGate ? [brief] : [])),
        subscribeRun: vi.fn().mockImplementation(async () => ({
          seq: atGate ? 2 : 1,
          gap_detected: false,
          resync_required: false,
          dropped_count: 0,
          run: null,
          events: atGate && source === 'live' ? [event] : [],
        })),
      });
      const view = renderProject(client);
      try {
        await act(async () => {});
        expect(screen.queryByTestId('project-decision-card')).toBeNull();
        atGate = true;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        expect(screen.queryByTestId('project-decision-card')).not.toBeNull();
        expect(screen.getByTestId('project-decision-card').textContent).toContain(brief.content);
        expect(client.getGates).toHaveBeenCalledTimes(2);
      } finally {
        view.unmount();
        vi.useRealTimers();
      }
    }
  );

  it('renders the stored brief body as text in the existing Gate A card', async () => {
    renderProject(
      createMockClient({
        listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
        getRunArtifacts: vi.fn().mockResolvedValue([brief]),
      })
    );
    const card = await screen.findByTestId('project-decision-card');
    await waitFor(() => expect(card.textContent).toContain(brief.content));
  });
});

describe('ProjectPage helpers', () => {
  it('only finds pending gate matching run.stage and ignores future pending gates', () => {
    expect(findPendingGateAtCurrentStage(ALL_PENDING_GATES, RUNNING_RUN)).toBeNull();
    const pendingA = findPendingGateAtCurrentStage(ALL_PENDING_GATES, AWAITING_GATE_RUN);
    expect(pendingA?.stage).toBe('gate_a');
    expect(findPendingGateAtCurrentStage(ALL_PENDING_GATES, FAILED_RUN)).toBeNull();
  });

  it('maps daemon stages onto the 5-stage map accurately', () => {
    const stages = buildSimpleStepperStages(RUNNING_RUN, (k) => k);
    expect(stages.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);

    const gateStages = buildSimpleStepperStages(AWAITING_GATE_RUN, (k) => k);
    expect(gateStages.map((s) => s.state)).toEqual(['waiting', 'todo', 'todo', 'todo', 'todo']);
  });

  it('computes status pill state and extracts code URL and test artifacts (F4)', () => {
    expect(computeRunStatusPill(RUNNING_RUN, null)).toBe('running');
    expect(computeRunStatusPill(AWAITING_GATE_RUN, ALL_PENDING_GATES[0])).toBe('waiting');
    expect(computeRunStatusPill(FAILED_RUN, null)).toBe('failed');
    const CANCELLED_RUN = { ...RUNNING_RUN, id: 'run-c' as RunId, status: 'cancelled' as const };
    expect(computeRunStatusPill(CANCELLED_RUN, null)).toBe('cancelled');

    const artifacts: RunArtifact[] = [
      {
        name: 'prd_spec',
        content: 'Simple spec without URL',
        stage: 'prd_spec',
        role: 'pm',
        created_at: '',
        updated_at: '',
        version: 1,
      },
      {
        name: 'code_pr',
        content: 'Opened PR at https://github.com/org/repo/pull/42',
        stage: 'code',
        role: 'coder',
        created_at: '',
        updated_at: '',
        version: 1,
      },
      {
        name: 'qa_tests',
        content: 'All 42 tests passed',
        stage: 'review_qa_security',
        role: 'reviewer',
        created_at: '',
        updated_at: '',
        version: 1,
      },
    ];
    expect(extractCodeUrl(artifacts)).toBe('https://github.com/org/repo/pull/42');
    expect(extractTestArtifacts(artifacts)).toHaveLength(1);
  });

  it('extracts retry_hint from event payload and searches events list', () => {
    expect(extractRetryHint(null)).toBe('');
    expect(extractRetryHint({})).toBe('');
    expect(extractRetryHint({ retry_hint: '  Check API key  ' })).toBe('Check API key');
    expect(
      findRetryHint([
        {
          id: 'evt-1',
          runId: 'run-1' as RunId,
          stage: 'code',
          role: null,
          kind: 'error',
          payload: { retry_hint: 'Verify model endpoint' },
          costCents: null,
          createdAt: '2026-10-02T09:00:00.000Z',
          deviceId: null,
        },
        {
          id: 'evt-2',
          runId: 'run-1' as RunId,
          stage: 'code',
          role: null,
          kind: 'run_finished',
          payload: { status: 'failed' },
          costCents: null,
          createdAt: '2026-10-02T09:01:00.000Z',
          deviceId: null,
        },
      ])
    ).toBe('Verify model endpoint');
  });

  it('uses only the newest pause-causing hint, not an older one', () => {
    const older = {
      id: 'evt-old',
      runId: 'run-paused' as RunId,
      stage: 'idea' as const,
      role: null,
      kind: 'error',
      payload: {
        action: 'provider_required',
        retry_hint: 'Configure a provider route for this role in Settings -> Models',
      },
      costCents: null,
      createdAt: '2026-10-02T08:00:00.000Z',
      deviceId: null,
    };
    const newest = {
      id: 'evt-new',
      runId: 'run-paused' as RunId,
      stage: 'idea' as const,
      role: null,
      kind: 'error',
      payload: { action: 'run_interrupted' },
      costCents: null,
      createdAt: '2026-10-02T09:00:00.000Z',
      deviceId: null,
    };
    expect(findRetryHint([older, newest], 'paused')).toBe('');
    expect(findRetryHint([newest, older], 'paused')).toBe('');
    expect(
      findRetryHint(
        [
          newest,
          {
            ...older,
            id: 'evt-current',
            createdAt: '2026-10-02T10:00:00.000Z',
            payload: { action: 'provider_required', retry_hint: 'project.retry_hint_provider' },
          },
        ],
        'paused'
      )
    ).toBe('project.retry_hint_provider');
  });
});

describe('ProjectPage component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading, empty, and error states honestly with retry', async () => {
    let resolveProject!: (val: ProjectSummary) => void;
    const pendingClient = createMockClient({
      getProject: vi.fn().mockImplementation(
        () =>
          new Promise<ProjectSummary>((res) => {
            resolveProject = res;
          })
      ),
    });

    renderProject(pendingClient);
    expect(screen.getByTestId('project-loading')).toBeDefined();
    expect(screen.getByTestId('ready-inspector').textContent).toBe('false');

    await waitFor(() => {
      expect(pendingClient.getProject).toHaveBeenCalled();
    });
    resolveProject(SAMPLE_PROJECT);
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
      expect(screen.getByTestId('ready-inspector').textContent).toBe('true');
    });

    const emptyClient = createMockClient({
      getProject: vi.fn().mockResolvedValue(null),
    });
    renderProject(emptyClient);
    await waitFor(() => {
      expect(screen.getByTestId('project-empty')).toBeDefined();
    });

    const errorClient = createMockClient({
      getProject: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network down'))
        .mockResolvedValue(SAMPLE_PROJECT),
    });
    renderProject(errorClient);
    await waitFor(() => {
      expect(screen.getByTestId('project-error')).toBeDefined();
    });

    fireEvent.click(document.querySelector('[data-action="project.retry"]') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });
  });

  it('shows ONE decision card only when gate is pending at current stage, with no request-changes/reject visible, and calls approveGate then advanceRun', async () => {
    const callOrder: string[] = [];
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
      approveGate: vi.fn().mockImplementation(async () => {
        callOrder.push('gates.approve');
      }),
      advanceRun: vi.fn().mockImplementation(async () => {
        callOrder.push('runs.advance');
        return { ...AWAITING_GATE_RUN, stage: 'research', status: 'running' };
      }),
    });

    renderProject(client);
    await waitFor(() => {
      expect(screen.getByTestId('project-decision-card')).toBeDefined();
    });

    expect(document.querySelector('[data-action="project.gate.changes.open"]')).toBeNull();
    expect(document.querySelector('[data-action="project.gate.reject.open"]')).toBeNull();
    expect(document.querySelector('[data-action="project.run.cancel.open"]')).toBeNull();

    fireEvent.click(document.querySelector('[data-action="project.gate.approve"]') as HTMLElement);
    await waitFor(() => {
      expect(callOrder).toEqual(['gates.approve', 'runs.advance']);
    });
  });

  it('hides decision card when run is at code stage even if future gates are pending', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([RUNNING_RUN]),
      getGates: vi.fn().mockResolvedValue(ALL_PENDING_GATES),
    });

    renderProject(client);
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });
    expect(screen.queryByTestId('project-decision-card')).toBeNull();
  });

  it('wires followup composer, preview controls, tests sheet, budget sheet, and activity toggle', async () => {
    const client = createMockClient();
    renderProject(client);

    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });

    const textarea = screen
      .getByTestId('project-followup-textarea')
      .querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Add RTL unit tests' } });
    fireEvent.click(document.querySelector('[data-action="project.followup.send"]') as HTMLElement);
    await waitFor(() => {
      expect(client.followupRun).toHaveBeenCalledWith('run-code', 'Add RTL unit tests');
    });

    fireEvent.click(document.querySelector('[data-action="project.preview.start"]') as HTMLElement);
    await waitFor(() => {
      expect(client.startPreview).toHaveBeenCalledWith('proj-1', 'pnpm dev');
    });

    fireEvent.click(document.querySelector('[data-action="project.tests.open"]') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('project-tests-sheet')).toBeDefined();
    });

    fireEvent.click(document.querySelector('[data-action="project.budget.open"]') as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('project-budget-sheet')).toBeDefined();
    });
    const budgetInput = screen.getByTestId('budget-custom-input') as HTMLInputElement;
    fireEvent.change(budgetInput, { target: { value: '25' } });
    fireEvent.click(document.querySelector('[data-action="project.budget.save"]') as HTMLElement);
    await waitFor(() => {
      expect(client.setProjectBudget).toHaveBeenCalledWith('proj-1', 2500);
    });

    expect(screen.getByTestId('project-activity-feed')).toBeDefined();
    fireEvent.click(
      document.querySelector('[data-action="project.activity.toggle"]') as HTMLElement
    );
    expect(screen.queryByTestId('project-activity-feed')).toBeNull();
  });

  it('renders restart banner on failed run and sets advanced mode on open-advanced', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([FAILED_RUN]),
    });

    renderProject(client);
    await waitFor(() => {
      expect(screen.getByTestId('project-run-ended-banner')).toBeDefined();
    });

    fireEvent.click(document.querySelector('[data-action="project.run.restart"]') as HTMLElement);
    await waitFor(() => {
      expect(client.startRun).toHaveBeenCalledWith('proj-1', SAMPLE_PROJECT.name);
    });

    fireEvent.click(document.querySelector('[data-action="project.open-advanced"]') as HTMLElement);
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-mode')).toBe('developers');
    });
  });

  it('surfaces retry_hint in danger banner on failed run (English)', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([FAILED_RUN]),
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 2,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: FAILED_RUN,
        events: [
          {
            id: 'evt-err',
            runId: 'run-failed' as RunId,
            stage: 'code',
            role: 'coder',
            kind: 'error',
            payload: {
              action: 'stage_failed',
              retry_hint: 'Check model provider configuration and retry stage',
            },
            costCents: null,
            createdAt: '2026-10-02T09:05:00.000Z',
            deviceId: null,
          },
          {
            id: 'evt-fin',
            runId: 'run-failed' as RunId,
            stage: 'code',
            role: null,
            kind: 'run_finished',
            payload: { status: 'failed' },
            costCents: null,
            createdAt: '2026-10-02T09:05:01.000Z',
            deviceId: null,
          },
        ],
      }),
    });

    renderProject(client, '/p/proj-1', 'en');
    await waitFor(() => {
      expect(screen.getByTestId('project-run-ended-banner')).toBeDefined();
    });

    const banner = screen.getByTestId('project-run-ended-banner');
    expect(banner.textContent).toContain('This run failed before completion');
    const hintEl = screen.getByTestId('project-banner-retry-hint');
    expect(hintEl.textContent).toBe('Check model provider configuration and retry stage');
    expect(retryHintKey('Check model provider configuration and retry stage')).toBe(
      'project.retry_hint.stage_failed'
    );
  });

  it('surfaces retry_hint in danger banner on failed run (Arabic) with RTL logical styling', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([FAILED_RUN]),
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 2,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: FAILED_RUN,
        events: [
          {
            id: 'evt-err',
            runId: 'run-failed' as RunId,
            stage: 'code',
            role: 'coder',
            kind: 'error',
            payload: {
              action: 'stage_failed',
              retry_hint: 'Check model provider configuration and retry stage',
            },
            costCents: null,
            createdAt: '2026-10-02T09:05:00.000Z',
            deviceId: null,
          },
        ],
      }),
    });

    renderProject(client, '/p/proj-1', 'ar');
    await waitFor(() => {
      expect(screen.getByTestId('project-run-ended-banner')).toBeDefined();
    });

    const banner = screen.getByTestId('project-run-ended-banner');
    expect(banner.textContent).toContain('تعثّر هذا التشغيل قبل الاكتمال');
    const hintEl = screen.getByTestId('project-banner-retry-hint');
    expect(hintEl.textContent).toBe('راجع إعداد مزوّد النموذج ثم أعد محاولة هذه المرحلة');
    expect(hintEl.querySelector('bdi')?.getAttribute('dir')).toBe('auto');
    expect((hintEl as HTMLElement).style.marginBlockStart).toBe('var(--w-space-1)');
  });

  it('renders the paused-notice catalog string and falls back to a raw hint', async () => {
    const daemonHint = 'Configure a provider route for this role in Settings -> Models';
    const catalogHint = enCatalog['project.retry_hint.provider_required'];
    expect(catalogHint).toBeTruthy();
    expect(catalogHint).not.toBe(daemonHint);

    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([PAUSED_RUN]),
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 1,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: PAUSED_RUN,
        events: [
          {
            id: 'evt-pause',
            runId: 'run-paused' as RunId,
            stage: 'idea',
            role: 'intake',
            kind: 'error',
            payload: {
              action: 'provider_required',
              retry_hint: daemonHint,
            },
            costCents: null,
            createdAt: '2026-10-02T09:05:00.000Z',
            deviceId: null,
          },
        ],
      }),
    });

    renderProject(client, '/p/proj-1', 'en');
    await waitFor(() => {
      expect(screen.getByTestId('project-paused-notice')).toBeDefined();
    });
    expect(screen.queryByTestId('project-run-ended-banner')).toBeNull();
    expect(screen.getByTestId('project-banner-retry-hint').textContent).toBe(catalogHint);

    expect(retryHintText('provider route was reworded by the daemon')).toBe(
      'provider route was reworded by the daemon'
    );
  });

  it('does not render a hint copied from an older pause when the newest pause has none', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([PAUSED_RUN]),
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 1,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: PAUSED_RUN,
        events: [
          {
            id: 'evt-old-hint',
            runId: 'run-paused' as RunId,
            stage: 'idea',
            role: 'intake',
            kind: 'error',
            payload: {
              action: 'provider_required',
              retry_hint: 'Configure a provider route for this role in Settings -> Models',
            },
            costCents: null,
            createdAt: '2026-10-02T08:00:00.000Z',
            deviceId: null,
          },
          {
            id: 'evt-interrupted',
            runId: 'run-paused' as RunId,
            stage: 'idea',
            role: null,
            kind: 'error',
            payload: { action: 'run_interrupted' },
            costCents: null,
            createdAt: '2026-10-02T09:00:00.000Z',
            deviceId: null,
          },
        ],
      }),
    });

    renderProject(client, '/p/proj-1', 'en');
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });
    expect(screen.queryByTestId('project-paused-notice')).toBeNull();
    expect(screen.queryByTestId('project-banner-retry-hint')).toBeNull();
    // The older sentence may still appear in the activity feed. It must not
    // appear as the paused banner hint.
    expect(screen.queryByTestId('project-banner-retry-hint')).toBeNull();
  });

  it('keeps the danger banner free of a retry hint when no event carries one', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([FAILED_RUN]),
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 1,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: FAILED_RUN,
        events: [
          {
            id: 'evt-fin',
            runId: 'run-failed' as RunId,
            stage: 'code',
            role: null,
            kind: 'run_finished',
            payload: { status: 'failed' },
            costCents: null,
            createdAt: '2026-10-02T09:05:01.000Z',
            deviceId: null,
          },
        ],
      }),
    });

    renderProject(client);
    await waitFor(() => {
      expect(screen.getByTestId('project-run-ended-banner')).toBeDefined();
    });

    expect(screen.getByTestId('project-run-ended-banner').textContent).toContain(
      'This run failed before completion'
    );
    expect(screen.queryByTestId('project-banner-retry-hint')).toBeNull();
  });

  it('hides the run-ending controls when the daemon does not advertise them', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
    });

    renderProject(client);
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });

    for (const id of [
      'project.gate.changes.open',
      'project.gate.changes.send',
      'project.gate.reject.open',
      'project.gate.reject.confirm',
    ]) {
      expect(document.querySelector(`[data-action="${id}"]`)).toBeNull();
    }
  });

  it('supports capability-gated changes, reject, and cancel flows when the daemon advertises run controls', async () => {
    const client = createRunEndingClient({
      listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
    });

    renderProject(client);
    await waitFor(() => {
      expect(document.querySelector('[data-action="project.gate.changes.open"]')).not.toBeNull();
    });

    fireEvent.click(
      document.querySelector('[data-action="project.gate.changes.open"]') as HTMLElement
    );
    const changesInput = screen
      .getByTestId('project-changes-textarea')
      .querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(changesInput, { target: { value: 'Clarify auth scope' } });
    fireEvent.click(
      document.querySelector('[data-action="project.gate.changes.send"]') as HTMLElement
    );
    await waitFor(() => {
      expect(client.requestChanges).toHaveBeenCalledWith(
        'run-gate',
        'gate_a',
        'Clarify auth scope'
      );
    });

    fireEvent.click(
      document.querySelector('[data-action="project.gate.reject.open"]') as HTMLElement
    );
    await waitFor(() => {
      expect(document.querySelector('[data-action="project.gate.reject.confirm"]')).not.toBeNull();
    });
    fireEvent.click(
      document.querySelector('[data-action="project.gate.reject.confirm"]') as HTMLElement
    );
    await waitFor(() => {
      expect(client.rejectGate).toHaveBeenCalledWith('run-gate', 'gate_a', 'Rejected by owner');
    });
  });

  it('names Gate A on a Gate A decision instead of the Simple Idea label', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
    });
    renderProject(client, '/p/proj-1', 'en');
    await waitFor(() => {
      expect(screen.getByTestId('project-latest-sentence').textContent).toContain('Gate A');
    });
    expect(screen.getByTestId('project-latest-sentence').textContent).not.toContain('Idea');
  });

  it('names the same gate in Arabic', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
    });
    renderProject(client, '/p/proj-1', 'ar');
    await waitFor(() => {
      expect(screen.getByTestId('project-latest-sentence').textContent).toContain('البوابة أ');
    });
    expect(screen.getByTestId('project-latest-sentence').textContent).not.toContain('الفكرة');
  });

  it('renders runmode-chip for a plan fixture row and none for agent rows', async () => {
    // Agent run: no runmode chip
    const agentClient = createMockClient({
      listRuns: vi.fn().mockResolvedValue([{ ...RUNNING_RUN }]),
    });
    const { unmount } = renderProject(agentClient);
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });
    expect(screen.queryByTestId('runmode-chip')).toBeNull();
    unmount();

    // Plan run: renders runmode chip
    const planClient = createMockClient({
      listRuns: vi.fn().mockResolvedValue([{ ...RUNNING_RUN, runMode: 'plan' }]),
    });
    renderProject(planClient);
    await waitFor(() => {
      expect(screen.getByTestId('project-ready')).toBeDefined();
    });
    const chip = screen.getByTestId('runmode-chip');
    expect(chip).toBeDefined();
    expect(chip.getAttribute('data-runmode')).toBe('plan');
  });
});
