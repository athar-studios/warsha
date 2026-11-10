import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  AgentState,
  AgentTurn,
  BudgetStatus,
  CustomModelRecord,
  FileEntry,
  GateSummary,
  HarnessDefinition,
  LivePreview,
  ProjectId,
  ProjectSummary,
  RoleRouting,
  RunArtifact,
  RunId,
  RunModeConfig,
  RunSummary,
  WarshaClient,
  WarshaEvent,
} from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { V3App } from '../../app/V3App';
import { RouterProvider } from '../../router';

import { AdvancedComposer } from './components/AdvancedComposer';
import { BenchDecisionCard } from './components/BenchDecisionCard';
import { BenchHeader } from './components/BenchHeader';
import { BenchRail } from './components/BenchRail';
import { BenchTabs } from './components/BenchTabs';
import { StageStrip } from './components/StageStrip';
import { ArtifactsTab } from './tabs/ArtifactsTab';
import { AssistantTab } from './tabs/AssistantTab';
import { ChangesTab } from './tabs/ChangesTab';
import { CostTab } from './tabs/CostTab';
import { FilesTab } from './tabs/FilesTab';
import { OverviewTab } from './tabs/OverviewTab';
import { PlanTab } from './tabs/PlanTab';
import { PreviewTab } from './tabs/PreviewTab';
import { TeamTab } from './tabs/TeamTab';
import { TerminalTab } from './tabs/TerminalTab';

const SAMPLE_PROJECT: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'متجر ورشة',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const SAMPLE_RUN: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-05T07:15:00.000Z',
  updatedAt: '2026-10-05T07:20:00.000Z',
};

const SAMPLE_EVENTS: WarshaEvent[] = [
  {
    id: 'evt-1',
    runId: 'run-1' as RunId,
    stage: 'code',
    role: 'coder',
    kind: 'tool_call',
    payload: { summary: 'cargo test --workspace', tokens: 1200 },
    costCents: 15,
    createdAt: '2026-10-05T07:16:00.000Z',
    deviceId: null,
  },
  {
    id: 'evt-2',
    runId: 'run-1' as RunId,
    stage: 'code',
    role: 'coder',
    kind: 'tool_result',
    payload: { summary: 'ok: all tests passed' },
    costCents: null,
    createdAt: '2026-10-05T07:17:00.000Z',
    deviceId: null,
  },
];

const SAMPLE_ARTIFACTS: RunArtifact[] = [
  {
    name: 'prd_spec',
    content: '# Spec Document\n\nDetails here.',
    stage: 'prd_spec',
    role: 'pm',
    created_at: '2026-10-05T07:10:00.000Z',
    updated_at: '2026-10-05T07:10:00.000Z',
    version: 1,
  },
];

function createMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
    listProviders: vi.fn().mockResolvedValue([{ name: 'ollama', kind: 'ollama', enabled: true }]),
    listProjects: vi.fn().mockResolvedValue([SAMPLE_PROJECT]),
    getProject: vi.fn().mockResolvedValue(SAMPLE_PROJECT),
    listRuns: vi.fn().mockResolvedValue([SAMPLE_RUN]),
    getRun: vi.fn().mockResolvedValue(SAMPLE_RUN),
    startRun: vi.fn().mockResolvedValue({ ...SAMPLE_RUN, id: 'run-2' as RunId }),
    advanceRun: vi.fn().mockResolvedValue(SAMPLE_RUN),
    cancelRun: vi.fn().mockResolvedValue({ ...SAMPLE_RUN, status: 'cancelled' }),
    followupRun: vi.fn().mockResolvedValue(SAMPLE_RUN),
    subscribeRun: vi.fn().mockResolvedValue({
      seq: 2,
      gap_detected: false,
      resync_required: false,
      dropped_count: 0,
      run: null,
      events: SAMPLE_EVENTS,
    }),
    getGates: vi.fn().mockResolvedValue([{ stage: 'gate_a', state: { state: 'pending' } }]),
    approveGate: vi.fn().mockResolvedValue(undefined),
    requestChanges: vi.fn().mockResolvedValue(undefined),
    rejectGate: vi.fn().mockResolvedValue(undefined),
    getRunArtifacts: vi.fn().mockResolvedValue(SAMPLE_ARTIFACTS),
    getProjectBudget: vi.fn().mockResolvedValue({ totalBudgetUsd: 20, spentUsd: 4, remainingUsd: 16 }),
    setProjectBudget: vi.fn().mockResolvedValue(undefined),
    listRoleRoutings: vi.fn().mockResolvedValue([
      {
        role: 'coder',
        targets: [{ provider_id: 'ollama', model_id: 'qwen-coder', weight: 100 }],
        fallback_enabled: false,
        budget_cents_per_run: null,
      },
    ]),
    setRoleConfig: vi.fn().mockResolvedValue(undefined),
    listCustomModels: vi.fn().mockResolvedValue([
      { provider: 'ollama', modelId: 'qwen-coder', displayName: 'Qwen Coder', contextWindow: null, enabled: true },
    ]),
    listHarnesses: vi.fn().mockResolvedValue([]),
    selectHarness: vi.fn().mockResolvedValue(undefined),
    listRunModes: vi.fn().mockResolvedValue([]),
    setRunMode: vi.fn().mockResolvedValue({ mode: 'local', bindHost: '127.0.0.1', allowedHosts: [], relayUrl: null }),
    getFilesTree: vi.fn().mockResolvedValue([]),
    readFileContent: vi.fn().mockResolvedValue({ path: 'src/index.ts', content: 'export const x = 1;', mimeType: 'text/typescript' }),
    createHandoff: vi.fn().mockResolvedValue('/tmp/handoff.zip'),
    applyHandoff: vi.fn().mockResolvedValue({ applied: ['src/index.ts'], conflicts: [], backups: [], resolved: [] }),
    agentState: vi.fn().mockResolvedValue({
      mode: 'plan',
      approvals: [],
      todos: [{ id: 't1', description: 'Check plan', status: 'pending' }],
      model_wired: true,
    }),
    agentTurn: vi.fn().mockResolvedValue({
      mode: 'plan',
      mentions: [],
      command: null,
      response: 'Real agent reply from daemon',
      todos: [{ id: 't1', description: 'Check plan', status: 'done' }],
      tools: [],
    }),
    approveAgentMode: vi.fn().mockResolvedValue({ from: 'plan', to: 'agent', approved_by: 'dev-1', approved_at: 100 }),
    returnAgentToPlanMode: vi.fn().mockResolvedValue({ from: 'agent', to: 'plan', approved_by: 'dev-1', approved_at: 200 }),
    previewStatus: vi.fn().mockResolvedValue({ projectId: 'proj-1', processId: 'p1', command: 'npm', args: ['run', 'dev'], status: 'stopped', url: null }),
    startPreview: vi.fn().mockResolvedValue({ projectId: 'proj-1', processId: 'p1', command: 'npm', args: ['run', 'dev'], status: 'running', url: 'http://127.0.0.1:3000' }),
    stopPreview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderWithProviders(ui: React.ReactElement, client?: WarshaClient, initialLocale: 'ar' | 'en' = 'ar') {
  const mockClient = client ?? createMockClient();
  return render(
    <ClientProvider client={mockClient}>
      <CapabilitiesProvider client={mockClient}>
        <I18nProvider initialLocale={initialLocale}>
          <DataReadyProvider>
            <RouterProvider initialPath="/p/proj-1/r/run-1/overview">{ui}</RouterProvider>
          </DataReadyProvider>
        </I18nProvider>
      </CapabilitiesProvider>
    </ClientProvider>
  );
}

describe('Advanced Workbench (U4)', () => {
  beforeEach(() => {
    delete (window as unknown as { __ENABLE_RESUME__?: boolean }).__ENABLE_RESUME__;
  });

  it('BenchRail renders projects and runs and handles new project click', () => {
    const onNewProject = vi.fn();
    const onSelectRun = vi.fn();
    renderWithProviders(
      <BenchRail
        projects={[SAMPLE_PROJECT]}
        projectsStatus="ready"
        runsByProject={{ 'proj-1': [SAMPLE_RUN] }}
        activeProjectId="proj-1"
        activeRunId="run-1"
        onNewProject={onNewProject}
        onSelectRun={onSelectRun}
        onRetryProjects={vi.fn()}
      />
    );

    expect(screen.getByText('متجر ورشة')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bench-new-project-btn'));
    expect(onNewProject).toHaveBeenCalledTimes(1);

    const runBtn = screen.getByRole('button', { name: /التشغيل/ });
    fireEvent.click(runBtn);
    expect(onSelectRun).toHaveBeenCalledWith('proj-1', 'run-1');
  });

  it('BenchRail shows empty runs and error retry state', () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithProviders(
      <BenchRail
        projects={[SAMPLE_PROJECT]}
        projectsStatus="ready"
        runsByProject={{}}
        activeProjectId="proj-1"
        activeRunId=""
        onNewProject={vi.fn()}
        onSelectRun={vi.fn()}
        onRetryProjects={onRetry}
      />
    );
    expect(screen.getByText('لا توجد تشغيلات لهذا المشروع')).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="ar">
        <BenchRail
          projects={[]}
          projectsStatus="error"
          runsByProject={{}}
          activeProjectId=""
          activeRunId=""
          onNewProject={vi.fn()}
          onSelectRun={vi.fn()}
          onRetryProjects={onRetry}
        />
      </I18nProvider>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('BenchHeader hides gate pill when pending gate is NOT at current stage (Amendment b)', () => {
    const gates: GateSummary[] = [{ stage: 'gate_a', state: { state: 'pending' } }];
    renderWithProviders(
      <BenchHeader
        project={SAMPLE_PROJECT}
        run={{ ...SAMPLE_RUN, stage: 'code' }}
        gates={gates}
        onAdvance={vi.fn()}
        onStartNewRun={vi.fn()}
        onCancelRun={vi.fn()}
        onReconnect={vi.fn()}
      />
    );
    expect(screen.queryByTestId('header-gate-pill')).toBeNull();
  });

  it('BenchHeader shows gate pill ONLY when pending gate equals current stage (Amendment b)', () => {
    const gates: GateSummary[] = [{ stage: 'gate_b', state: { state: 'pending' } }];
    renderWithProviders(
      <BenchHeader
        project={SAMPLE_PROJECT}
        run={{ ...SAMPLE_RUN, stage: 'gate_b', status: 'awaiting_gate' }}
        gates={gates}
        onAdvance={vi.fn()}
        onStartNewRun={vi.fn()}
        onCancelRun={vi.fn()}
        onReconnect={vi.fn()}
      />
    );
    expect(screen.getByTestId('header-gate-pill')).toBeInTheDocument();
  });

  it('BenchHeader triggers advance, start new run, reconnect, and cancel dialog confirmation', () => {
    const onAdvance = vi.fn();
    const onStartNewRun = vi.fn();
    const onCancelRun = vi.fn();
    const onReconnect = vi.fn();

    renderWithProviders(
      <BenchHeader
        project={SAMPLE_PROJECT}
        run={SAMPLE_RUN}
        gates={[]}
        onAdvance={onAdvance}
        onStartNewRun={onStartNewRun}
        onCancelRun={onCancelRun}
        onReconnect={onReconnect}
      />
    );

    fireEvent.click(screen.getByTestId('bench-run-advance-btn'));
    expect(onAdvance).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('bench-run-start-btn'));
    expect(onStartNewRun).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('bench-stream-reconnect-btn'));
    expect(onReconnect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('bench-run-cancel-open-btn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bench-run-cancel-confirm-btn'));
    expect(onCancelRun).toHaveBeenCalledTimes(1);
  });

  it('StageStrip renders all 14 stages and highlights current stage', () => {
    renderWithProviders(<StageStrip currentStage="code" />);
    const strip = screen.getByTestId('bench-stage-strip');
    const items = strip.querySelectorAll('li');
    expect(items.length).toBe(14);
    const currentItem = strip.querySelector('li[data-current="true"]');
    expect(currentItem?.getAttribute('data-stage')).toBe('code');
  });

  it('BenchTabs renders all 10 tabs and handles click and keyboard navigation', () => {
    const onChange = vi.fn();
    renderWithProviders(<BenchTabs activeTab="overview" onChange={onChange} />, undefined, 'en');

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(10);

    fireEvent.click(tabs[2]);
    expect(onChange).toHaveBeenCalledWith('files');

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('plan');

    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  it('BenchDecisionCard hides request-changes and reject by default (Amendment a)', () => {
    renderWithProviders(
      <BenchDecisionCard
        question="هل نعتمد الفكرة؟"
        rationale="مراجعة الخطة"
        onApprove={vi.fn()}
      />
    );

    const approveBtn = screen.getByTestId('bench-gate-approve-btn');
    expect(approveBtn).toHaveAttribute('data-variant', 'primary');
    expect(screen.queryByTestId('bench-gate-changes-btn')).toBeNull();
    expect(screen.queryByTestId('bench-gate-reject-btn')).toBeNull();
  });

  it('BenchDecisionCard shows request-changes and reject when capability flag is enabled', () => {
    (window as unknown as { __ENABLE_RESUME__?: boolean }).__ENABLE_RESUME__ = true;
    const onRequestChanges = vi.fn();
    const onReject = vi.fn();

    renderWithProviders(
      <BenchDecisionCard
        question="هل نعتمد الفكرة؟"
        rationale="مراجعة الخطة"
        onApprove={vi.fn()}
        onRequestChanges={onRequestChanges}
        onReject={onReject}
      />
    );

    fireEvent.click(screen.getByTestId('bench-gate-changes-btn'));
    const changesInput = screen.getByTestId('decision-changes-textarea').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(changesInput, { target: { value: 'Add tests' } });
    fireEvent.click(screen.getByTestId('decision-submit-changes-btn'));
    expect(onRequestChanges).toHaveBeenCalledWith('Add tests');

    fireEvent.click(screen.getByTestId('bench-gate-reject-btn'));
    const rejectInput = screen.getByTestId('decision-reject-reason-input').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(rejectInput, { target: { value: 'Incomplete' } });
    fireEvent.click(screen.getByTestId('bench-confirm-reject-btn'));
    expect(onReject).toHaveBeenCalledWith('Incomplete');
  });

  it('OverviewTab only renders DecisionCard when pending gate matches current stage', () => {
    const onApproveGate = vi.fn();
    const { rerender } = renderWithProviders(
      <OverviewTab
        run={{ ...SAMPLE_RUN, stage: 'code' }}
        gates={[{ stage: 'gate_a', state: { state: 'pending' } }]}
        events={SAMPLE_EVENTS}
        artifacts={SAMPLE_ARTIFACTS}
        onApproveGate={onApproveGate}
      />
    );
    expect(screen.queryByTestId('bench-decision-card')).toBeNull();

    rerender(
      <I18nProvider initialLocale="ar">
        <OverviewTab
          run={{ ...SAMPLE_RUN, stage: 'gate_a', status: 'awaiting_gate' }}
          gates={[{ stage: 'gate_a', state: { state: 'pending' } }]}
          events={SAMPLE_EVENTS}
          artifacts={SAMPLE_ARTIFACTS}
          onApproveGate={onApproveGate}
        />
      </I18nProvider>
    );
    expect(screen.getByTestId('bench-decision-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bench-gate-approve-btn'));
    expect(onApproveGate).toHaveBeenCalledWith('gate_a');
  });

  it('PlanTab renders honest EmptyState when no plan artifact exists (Amendment c)', () => {
    const { rerender } = renderWithProviders(<PlanTab artifacts={[]} />);
    expect(screen.getByTestId('bench-plan-empty')).toBeInTheDocument();

    rerender(
      <I18nProvider initialLocale="ar">
        <PlanTab artifacts={SAMPLE_ARTIFACTS} />
      </I18nProvider>
    );
    expect(screen.getByText('prd_spec')).toBeInTheDocument();
    expect(screen.getByText(/Spec Document/)).toBeInTheDocument();
  });

  it('FilesTab renders honest EmptyState when empty and opens/copies files when ready (Amendment c)', async () => {
    const mockClient = createMockClient({
      getFilesTree: vi.fn().mockResolvedValue([
        { name: 'index.ts', path: 'src/index.ts', isDir: false, sizeBytes: 120 },
      ]),
    });

    const { rerender } = renderWithProviders(
      <FilesTab projectId="proj-1" files={[]} status="empty" onReload={vi.fn()} />,
      mockClient
    );
    expect(screen.getByTestId('bench-files-empty')).toBeInTheDocument();

    const files: FileEntry[] = [
      { name: 'src', path: 'src', isDir: true, sizeBytes: 0 },
      { name: 'README.md', path: 'README.md', isDir: false, sizeBytes: 42 },
    ];
    rerender(
      <ClientProvider client={mockClient}>
        <I18nProvider initialLocale="ar">
          <FilesTab projectId="proj-1" files={files} status="ready" onReload={vi.fn()} />
        </I18nProvider>
      </ClientProvider>
    );

    fireEvent.click(screen.getByTestId('file-tree-dir-src'));
    await waitFor(() => {
      expect(mockClient.getFilesTree).toHaveBeenCalledWith('proj-1', 'src');
    });

    fireEvent.click(screen.getByTestId('file-tree-file-README.md'));
    await waitFor(() => {
      expect(mockClient.readFileContent).toHaveBeenCalledWith('proj-1', 'README.md');
    });
    expect(screen.getByTestId('bench-code-copy-btn')).toBeInTheDocument();
  });

  it('ChangesTab renders honest EmptyState when no diff artifact exists and handles handoff RPCs (Amendment c)', async () => {
    const mockClient = createMockClient();
    renderWithProviders(<ChangesTab runId="run-1" artifacts={[]} />, mockClient);

    expect(screen.getByTestId('bench-changes-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bench-handoff-create-btn'));
    await waitFor(() => {
      expect(mockClient.createHandoff).toHaveBeenCalledWith('run-1', []);
    });

    fireEvent.click(screen.getByTestId('bench-handoff-apply-btn'));
    await waitFor(() => {
      expect(mockClient.applyHandoff).toHaveBeenCalledWith('/tmp/handoff.zip', true);
    });
  });

  it('ChangesTab renders DiffView when diff artifact exists', () => {
    const diffArt: RunArtifact = {
      name: 'diff',
      content: '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
      stage: 'code',
      role: 'coder',
      created_at: '2026-10-05T07:10:00.000Z',
      updated_at: '2026-10-05T07:10:00.000Z',
      version: 1,
    };
    renderWithProviders(<ChangesTab runId="run-1" artifacts={[diffArt]} />);
    expect(screen.queryByTestId('bench-changes-empty')).toBeNull();
    expect(screen.getByText('new')).toBeInTheDocument();
  });

  it('TerminalTab is strictly read-only and toggles follow and copy', () => {
    renderWithProviders(<TerminalTab events={SAMPLE_EVENTS} />);
    expect(screen.getByTestId('bench-terminal-transcript')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();

    const followBtn = screen.getByTestId('bench-terminal-follow-btn');
    expect(followBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(followBtn);
    expect(followBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('bench-terminal-copy-btn'));
  });

  it('TeamTab renders all 12 roles with metrics and triggers role routing change', () => {
    const onSetRoleModel = vi.fn();
    const routings: RoleRouting[] = [
      {
        role: 'coder',
        targets: [{ provider_id: 'ollama', model_id: 'qwen-coder', weight: 100 }],
        fallback_enabled: false,
        budget_cents_per_run: null,
      },
    ];
    const models: CustomModelRecord[] = [
      { provider: 'ollama', modelId: 'qwen-coder', displayName: 'Qwen Coder', contextWindow: null, enabled: true },
    ];

    renderWithProviders(
      <TeamTab
        roles={routings}
        models={models}
        events={SAMPLE_EVENTS}
        onSetRoleModel={onSetRoleModel}
      />
    );

    const rows = document.querySelectorAll('tr[data-role-row]');
    expect(rows.length).toBe(12);
    expect(screen.getByText('$0.15')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('team-model-apply-btn-coder'));
    expect(onSetRoleModel).toHaveBeenCalledWith('coder', 'ollama', 'qwen-coder');
  });

  it('AssistantTab wires real agent.turn, agent.plan_mode, and agent.approve_mode without fake replies', async () => {
    const state: AgentState = {
      mode: 'plan',
      approvals: [],
      todos: [{ id: 't1', description: 'Review spec', status: 'pending' }],
      model_wired: true,
    };
    const turnResult: AgentTurn = {
      mode: 'plan',
      mentions: [],
      command: null,
      response: 'Verified plan ready for execution.',
      todos: [{ id: 't1', description: 'Review spec', status: 'done' }],
      tools: [],
    };
    const onSendTurn = vi.fn().mockResolvedValue(turnResult);
    const onSwitchToPlan = vi.fn();
    const onSwitchToAgent = vi.fn();

    renderWithProviders(
      <AssistantTab
        agentState={state}
        status="ready"
        onSendTurn={onSendTurn}
        onSwitchToPlan={onSwitchToPlan}
        onSwitchToAgent={onSwitchToAgent}
        onReload={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('bench-assistant-mode-agent-btn'));
    expect(onSwitchToAgent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('bench-assistant-mode-plan-btn'));
    expect(onSwitchToPlan).toHaveBeenCalledTimes(1);

    const textarea = screen.getByTestId('bench-assistant-input').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Check coverage' } });
    fireEvent.click(screen.getByTestId('bench-assistant-send-btn'));

    await waitFor(() => {
      expect(onSendTurn).toHaveBeenCalledWith('Check coverage');
      expect(screen.getByText('Verified plan ready for execution.')).toBeInTheDocument();
    });
  });

  it('AssistantTab shows unwired model banner and surfaces RPC error honestly', async () => {
    const state: AgentState = { mode: 'plan', approvals: [], todos: [], model_wired: false };
    const onSendTurn = vi.fn().mockRejectedValue(new Error('Provider not configured'));

    renderWithProviders(
      <AssistantTab
        agentState={state}
        status="ready"
        onSendTurn={onSendTurn}
        onSwitchToPlan={vi.fn()}
        onSwitchToAgent={vi.fn()}
        onReload={vi.fn()}
      />
    );

    expect(screen.getByText('لم يتم ربط نموذج بالوكيل بعد')).toBeInTheDocument();
    const textarea = screen.getByTestId('bench-assistant-input').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('bench-assistant-send-btn'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Provider not configured');
    });
  });

  it('CostTab shows budget meter, cost breakdowns, and saves budget', () => {
    const budget: BudgetStatus = { totalBudgetUsd: 25, spentUsd: 5, remainingUsd: 20 };
    const onSaveBudget = vi.fn();

    renderWithProviders(
      <CostTab
        budget={budget}
        status="ready"
        events={SAMPLE_EVENTS}
        onSaveBudget={onSaveBudget}
        onReload={vi.fn()}
      />
    );

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
    const input = screen.getByTestId('bench-cost-budget-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('bench-cost-budget-save-btn'));
    expect(onSaveBudget).toHaveBeenCalledWith(5000);
  });

  it('ArtifactsTab lists artifacts, opens Sheet, and copies path', () => {
    renderWithProviders(<ArtifactsTab artifacts={SAMPLE_ARTIFACTS} />);
    expect(screen.getByTestId('bench-artifact-item-prd_spec')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bench-artifact-copy-btn-prd_spec'));
    fireEvent.click(screen.getByTestId('bench-artifact-open-btn-prd_spec'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('PreviewTab triggers preview.start, preview.stop, and preview.open honestly (Amendment c)', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const onOpen = vi.fn();

    const stoppedPreview: LivePreview = {
      projectId: 'proj-1',
      processId: 'p1',
      command: 'npm',
      args: ['run', 'dev'],
      status: 'stopped',
      url: null,
    };

    const { rerender } = renderWithProviders(
      <PreviewTab
        preview={stoppedPreview}
        onStart={onStart}
        onStop={onStop}
        onOpen={onOpen}
      />
    );

    fireEvent.click(screen.getByTestId('bench-preview-start-btn'));
    expect(onStart).toHaveBeenCalledTimes(1);

    const runningPreview: LivePreview = {
      ...stoppedPreview,
      status: 'running',
      url: 'http://127.0.0.1:4173',
    };
    rerender(
      <CapabilitiesProvider>
        <I18nProvider initialLocale="ar">
          <PreviewTab
            preview={runningPreview}
            onStart={onStart}
            onStop={onStop}
            onOpen={onOpen}
          />
        </I18nProvider>
      </CapabilitiesProvider>
    );

    fireEvent.click(screen.getByTestId('bench-preview-open-btn'));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('bench-preview-stop-btn'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('AdvancedComposer sends followup, selects harness and runmode, and saves budget with zero fake controls', () => {
    const harnesses: HarnessDefinition[] = [
      {
        id: 'h-1',
        version: '1.0',
        name: 'Standard Flow',
        description: '',
        stages: [],
        rules: { maxRepairIterations: 2, budgetCapCents: null, allowParallelSubagents: false, requireVerificationReceipt: false },
        preset: true,
        active: true,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ];
    const runModes: RunModeConfig[] = [
      { mode: 'local', bindHost: '127.0.0.1', allowedHosts: [], relayUrl: null },
    ];
    const onSendFollowup = vi.fn();
    const onSelectHarness = vi.fn();
    const onSetRunMode = vi.fn();
    const onSaveBudget = vi.fn();

    renderWithProviders(
      <AdvancedComposer
        harnesses={harnesses}
        runModes={runModes}
        budgetUsd={10}
        onSendFollowup={onSendFollowup}
        onSelectHarness={onSelectHarness}
        onSetRunMode={onSetRunMode}
        onSaveBudget={onSaveBudget}
      />
    );

    const textarea = screen.getByTestId('bench-composer-textarea').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Add validation' } });
    fireEvent.click(screen.getByTestId('bench-followup-send-btn'));
    expect(onSendFollowup).toHaveBeenCalledWith('Add validation');

    fireEvent.click(screen.getByTestId('bench-harness-apply-btn'));
    expect(onSelectHarness).toHaveBeenCalledWith('h-1');

    fireEvent.click(screen.getByTestId('bench-runmode-apply-btn'));
    expect(onSetRunMode).toHaveBeenCalledWith(runModes[0]);

    const budgetInput = screen.getByTestId('bench-composer-budget-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(budgetInput, { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('bench-composer-budget-save-btn'));
    expect(onSaveBudget).toHaveBeenCalledWith(3000);
  });

  it('BenchPage integration renders Workbench via V3App with main[data-ready="true"]', async () => {
    const client = createMockClient();
    const { container } = render(<V3App client={client} initialRoute="/p/proj-1/r/run-1/overview" />);

    await waitFor(() => {
      expect(screen.getByTestId('bench-container')).toBeInTheDocument();
    });

    const main = container.querySelector('main');
    expect(main?.getAttribute('data-ready')).toBe('true');
    expect(screen.getByTestId('bench-stage-strip')).toBeInTheDocument();
    expect(screen.getByTestId('bench-tabs')).toBeInTheDocument();
  });

  it('BenchPage displays error banner when getRun fails', async () => {
    const client = createMockClient({
      getRun: vi.fn().mockRejectedValue(new Error('Daemon offline')),
    });
    render(<V3App client={client} initialRoute="/p/proj-1/r/run-1/overview" />);

    await waitFor(() => {
      expect(screen.getByTestId('bench-error')).toBeInTheDocument();
      expect(screen.getByText('Daemon offline')).toBeInTheDocument();
    });
  });

  it('BenchPage displays empty state when run is null', async () => {
    const client = createMockClient({
      getRun: vi.fn().mockResolvedValue(null),
    });
    render(<V3App client={client} initialRoute="/p/proj-1/r/run-1/overview" />);

    await waitFor(() => {
      expect(screen.getByTestId('bench-empty')).toBeInTheDocument();
    });
  });

  it('BenchRail handles no projects state', () => {
    renderWithProviders(
      <BenchRail
        projects={[]}
        projectsStatus="empty"
        runsByProject={{}}
        activeProjectId=""
        activeRunId=""
        onNewProject={vi.fn()}
        onSelectRun={vi.fn()}
        onRetryProjects={vi.fn()}
      />
    );
    expect(screen.getByText('لا توجد مشاريع')).toBeInTheDocument();
  });

  it('StageStrip marks failed stage with danger styling', () => {
    renderWithProviders(<StageStrip currentStage="code" isFailed={true} />);
    const item = screen.getByTestId('bench-stage-strip').querySelector('li[data-stage="code"]');
    expect(item?.getAttribute('data-current')).toBe('true');
  });

  it('StageStrip marks waiting gate stage with attention styling', () => {
    renderWithProviders(<StageStrip currentStage="gate_c" isWaitingGate={true} />);
    const item = screen.getByTestId('bench-stage-strip').querySelector('li[data-stage="gate_c"]');
    expect(item?.getAttribute('data-current')).toBe('true');
  });

  it('TerminalTab shows honest EmptyState when no terminal events exist', () => {
    renderWithProviders(<TerminalTab events={[]} />);
    expect(screen.getByTestId('bench-terminal-empty')).toBeInTheDocument();
  });

  it('ArtifactsTab shows honest EmptyState when no artifacts exist', () => {
    renderWithProviders(<ArtifactsTab artifacts={[]} />);
    expect(screen.getByTestId('bench-artifacts-empty')).toBeInTheDocument();
  });

  it('PreviewTab shows unavailable message when preview capability is off', () => {
    render(
      <CapabilitiesProvider initialCapabilities={{
        daemon: true,
        provider: true,
        devices: true,
        integrations: true,
        plugins: true,
        skills: true,
        harnesses: true,
        routines: true,
        preview: false,
        backend: true,
      }}>
        <I18nProvider initialLocale="ar">
          <PreviewTab preview={null} onStart={vi.fn()} onStop={vi.fn()} onOpen={vi.fn()} />
        </I18nProvider>
      </CapabilitiesProvider>
    );
    expect(screen.getByText('خدمة المعاينة غير متاحة في هذا النظام')).toBeInTheDocument();
  });

  it('BenchTabs handles Home and Space keyboard navigation', () => {
    const onChange = vi.fn();
    renderWithProviders(<BenchTabs activeTab="team" onChange={onChange} />, undefined, 'en');
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[5], { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('overview');
    fireEvent.keyDown(tabs[2], { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('files');
  });

  it('CostTab handles loading and error states cleanly', () => {
    const onReload = vi.fn();
    const { rerender } = renderWithProviders(
      <CostTab budget={null} status="loading" events={[]} onSaveBudget={vi.fn()} onReload={onReload} />
    );
    expect(document.querySelectorAll('.w-skeleton').length).toBeGreaterThan(0);

    rerender(
      <I18nProvider initialLocale="ar">
        <CostTab budget={null} status="error" events={[]} onSaveBudget={vi.fn()} onReload={onReload} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('FilesTab handles loading and error states cleanly', () => {
    const onReload = vi.fn();
    const { rerender } = renderWithProviders(
      <FilesTab projectId="proj-1" files={[]} status="loading" onReload={onReload} />
    );
    expect(document.querySelectorAll('.w-skeleton').length).toBeGreaterThan(0);

    rerender(
      <I18nProvider initialLocale="ar">
        <FilesTab projectId="proj-1" files={[]} status="error" onReload={onReload} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('AssistantTab handles loading and error states cleanly', () => {
    const onReload = vi.fn();
    const { rerender } = renderWithProviders(
      <AssistantTab
        agentState={null}
        status="loading"
        onSendTurn={vi.fn()}
        onSwitchToPlan={vi.fn()}
        onSwitchToAgent={vi.fn()}
        onReload={onReload}
      />
    );
    expect(document.querySelectorAll('.w-skeleton').length).toBeGreaterThan(0);

    rerender(
      <I18nProvider initialLocale="ar">
        <AssistantTab
          agentState={null}
          status="error"
          onSendTurn={vi.fn()}
          onSwitchToPlan={vi.fn()}
          onSwitchToAgent={vi.fn()}
          onReload={onReload}
        />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
