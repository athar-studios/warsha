import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
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
  extractTestArtifacts,
  findPendingGateAtCurrentStage,
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
  startedAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const AWAITING_GATE_RUN: RunSummary = {
  id: 'run-gate' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'gate_a',
  status: 'awaiting_gate',
  startedAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const FAILED_RUN: RunSummary = {
  id: 'run-failed' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'failed',
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
    advanceRun: vi.fn().mockResolvedValue({ ...AWAITING_GATE_RUN, stage: 'research', status: 'running' }),
    requestChanges: vi.fn().mockResolvedValue(undefined),
    rejectGate: vi.fn().mockResolvedValue(undefined),
    followupRun: vi.fn().mockResolvedValue(RUNNING_RUN),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue({ ...RUNNING_RUN, status: 'cancelled' }),
    startRun: vi.fn().mockResolvedValue(RUNNING_RUN),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderProject(client: WarshaClient | null, path = '/p/proj-1') {
  return render(
    <ClientProvider client={client ?? undefined}>
      <CapabilitiesProvider client={client ?? undefined}>
        <I18nProvider initialLocale="en">
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

  it('computes status pill state and extracts code URL and test artifacts', () => {
    expect(computeRunStatusPill(RUNNING_RUN, null)).toBe('running');
    expect(computeRunStatusPill(AWAITING_GATE_RUN, ALL_PENDING_GATES[0])).toBe('waiting');
    expect(computeRunStatusPill(FAILED_RUN, null)).toBe('failed');

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
});

describe('ProjectPage component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__;
  });

  it('renders loading, empty, and error states honestly with retry', async () => {
    let resolveProject!: (val: ProjectSummary) => void;
    const pendingClient = createMockClient({
      getProject: vi.fn().mockImplementation(
        () => new Promise<ProjectSummary>((res) => { resolveProject = res; })
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
      getProject: vi.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(SAMPLE_PROJECT),
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

    const textarea = screen.getByTestId('project-followup-textarea').querySelector('textarea') as HTMLTextAreaElement;
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
    fireEvent.click(document.querySelector('[data-action="project.activity.toggle"]') as HTMLElement);
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
      expect(document.documentElement.getAttribute('data-mode')).toBe('advanced');
    });
  });

  it('supports capability-gated changes, reject, and cancel flows only when explicitly enabled', async () => {
    (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([AWAITING_GATE_RUN]),
    });

    renderProject(client);
    await waitFor(() => {
      expect(document.querySelector('[data-action="project.gate.changes.open"]')).not.toBeNull();
    });

    fireEvent.click(document.querySelector('[data-action="project.gate.changes.open"]') as HTMLElement);
    const changesInput = screen.getByTestId('project-changes-textarea').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(changesInput, { target: { value: 'Clarify auth scope' } });
    fireEvent.click(document.querySelector('[data-action="project.gate.changes.send"]') as HTMLElement);
    await waitFor(() => {
      expect(client.requestChanges).toHaveBeenCalledWith('run-gate', 'gate_a', 'Clarify auth scope');
    });

    fireEvent.click(document.querySelector('[data-action="project.gate.reject.open"]') as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector('[data-action="project.gate.reject.confirm"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-action="project.gate.reject.confirm"]') as HTMLElement);
    await waitFor(() => {
      expect(client.rejectGate).toHaveBeenCalledWith('run-gate', 'gate_a', 'Rejected by owner');
    });
  });
});
