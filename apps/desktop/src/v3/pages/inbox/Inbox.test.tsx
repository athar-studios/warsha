import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  GateSummary,
  ProjectId,
  ProjectSummary,
  RunId,
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

import InboxPage, {
  collectPendingDecisions,
  extractGateCode,
  findPendingGateAtCurrentStage,
  formatTime24,
  isRunEndingEnabled,
} from './index';

function ReadyInspector(): React.ReactElement {
  const { isReady } = useDataReady();
  return <div data-testid="ready-inspector">{String(isReady)}</div>;
}

const PROJ_1: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'متجر ورشة',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

const PROJ_2: ProjectSummary = {
  id: 'proj-2' as ProjectId,
  name: 'Warsha Store',
  createdAt: '2026-10-03T08:00:00.000Z',
  updatedAt: '2026-10-04T09:00:00.000Z',
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
  id: 'run-gate-a' as RunId,
  projectId: 'proj-2' as ProjectId,
  stage: 'gate_a',
  status: 'awaiting_gate',
  startedAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T09:30:00.000Z',
};

const ALL_PENDING_GATES: GateSummary[] = [
  { stage: 'gate_a', state: { state: 'pending' } },
  { stage: 'gate_b', state: { state: 'pending' } },
  { stage: 'gate_c', state: { state: 'pending' } },
  { stage: 'gate_d', state: { state: 'pending' } },
];

function createMockClient(overrides: Partial<Record<string, unknown>> = {}): WarshaClient {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.3.0' }),
    listProjects: vi.fn().mockResolvedValue([PROJ_1, PROJ_2]),
    listRuns: vi.fn().mockImplementation((projectId: string) => {
      if (projectId === 'proj-1') return Promise.resolve([RUNNING_RUN]);
      if (projectId === 'proj-2') return Promise.resolve([AWAITING_GATE_RUN]);
      return Promise.resolve([]);
    }),
    getGates: vi.fn().mockResolvedValue(ALL_PENDING_GATES),
    approveGate: vi.fn().mockResolvedValue(undefined),
    advanceRun: vi.fn().mockResolvedValue({ ...AWAITING_GATE_RUN, stage: 'research', status: 'running' }),
    requestChanges: vi.fn().mockResolvedValue(undefined),
    rejectGate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderInbox(client: WarshaClient | null, path = '/inbox') {
  return render(
    <ClientProvider client={client ?? undefined}>
      <CapabilitiesProvider client={client ?? undefined}>
        <I18nProvider initialLocale="en">
          <DensityProvider initialMode="simple">
            <DataReadyProvider>
              <RouterProvider initialPath={path}>
                <ReadyInspector />
                <InboxPage />
              </RouterProvider>
            </DataReadyProvider>
          </DensityProvider>
        </I18nProvider>
      </CapabilitiesProvider>
    </ClientProvider>
  );
}

describe('InboxPage helpers', () => {
  it('extractGateCode maps gate stages correctly', () => {
    expect(extractGateCode('gate_a')).toBe('a');
    expect(extractGateCode('gate_b')).toBe('b');
    expect(extractGateCode('gate_c')).toBe('c');
    expect(extractGateCode('gate_d')).toBe('d');
    expect(extractGateCode('unknown')).toBe('a');
  });

  it('formatTime24 formats valid ISO strings and handles invalid inputs gracefully', () => {
    expect(formatTime24('')).toBe('');
    expect(formatTime24('not-a-date')).toBe('');
    const formatted = formatTime24('2026-10-04T09:30:00.000Z');
    expect(formatted).toBe('09:30');
  });

  it('findPendingGateAtCurrentStage enforces Amendment §5.5-b', () => {
    // When run is at 'code', none of the 4 pending gates match current stage
    expect(findPendingGateAtCurrentStage(ALL_PENDING_GATES, RUNNING_RUN)).toBeNull();

    // When run is at 'gate_a', only gate_a matches
    const match = findPendingGateAtCurrentStage(ALL_PENDING_GATES, AWAITING_GATE_RUN);
    expect(match).not.toBeNull();
    expect(match?.stage).toBe('gate_a');

    // Terminal runs return null even if gate is pending
    const completedRun: RunSummary = { ...AWAITING_GATE_RUN, status: 'completed' };
    expect(findPendingGateAtCurrentStage(ALL_PENDING_GATES, completedRun)).toBeNull();
  });

  it('collectPendingDecisions collects only matching current-stage gates and sorts newest first', () => {
    const runsMap = {
      'proj-1': [RUNNING_RUN],
      'proj-2': [AWAITING_GATE_RUN],
    };
    const gatesMap = {
      'run-code': ALL_PENDING_GATES,
      'run-gate-a': ALL_PENDING_GATES,
    };

    const decisions = collectPendingDecisions([PROJ_1, PROJ_2], runsMap, gatesMap);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].projectId).toBe('proj-2');
    expect(decisions[0].runId).toBe('run-gate-a');
    expect(decisions[0].gateStage).toBe('gate_a');
  });

  it('isRunEndingEnabled detects capability flag', () => {
    expect(isRunEndingEnabled(null)).toBe(false);
    expect(isRunEndingEnabled({})).toBe(false);
    expect(isRunEndingEnabled({ 'runs.resume': true })).toBe(true);

    const prev = (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__;
    (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    expect(isRunEndingEnabled({})).toBe(true);
    (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = prev;
  });
});

describe('InboxPage component journeys and states', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__;
  });

  it('renders loading skeleton and synchronizes data-ready', async () => {
    const resolvers: Array<(v: RunSummary[]) => void> = [];
    const slowClient = createMockClient({
      listRuns: vi.fn().mockImplementation(() => {
        return new Promise<RunSummary[]>((res) => {
          resolvers.push(res);
        });
      }),
    });

    renderInbox(slowClient);

    expect(screen.getByTestId('inbox-loading')).toBeDefined();
    expect(screen.getByTestId('ready-inspector').textContent).toBe('false');

    await waitFor(() => {
      expect(resolvers.length).toBe(2);
    });
    for (const r of resolvers) {
      r([AWAITING_GATE_RUN]);
    }

    await waitFor(() => {
      expect(screen.getByTestId('ready-inspector').textContent).toBe('true');
    });
    expect(screen.getByTestId('inbox-ready')).toBeDefined();
  });

  it('renders empty state when no decisions wait', async () => {
    const emptyClient = createMockClient({
      listProjects: vi.fn().mockResolvedValue([PROJ_1]),
      listRuns: vi.fn().mockResolvedValue([RUNNING_RUN]),
    });

    renderInbox(emptyClient);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-empty')).toBeDefined();
    });
    expect(screen.getByText('Nothing is waiting for you right now')).toBeDefined();
  });

  it('renders error banner and retries via inbox.retry', async () => {
    let shouldFail = true;
    const retryClient = createMockClient({
      listProjects: vi.fn().mockImplementation(() => {
        if (shouldFail) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve([PROJ_2]);
      }),
    });

    renderInbox(retryClient);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-error')).toBeDefined();
    });
    expect(screen.getByText('Failed to load pending decisions')).toBeDefined();

    shouldFail = false;
    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });
  });

  it('renders waiting decisions with gate question and project name, hiding run-ending controls by default', async () => {
    const client = createMockClient();
    renderInbox(client);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });

    expect(screen.getByText('Do we approve the idea and brief?')).toBeDefined();
    expect(screen.getByText('Warsha Store')).toBeDefined();

    // Run-ending controls remain hidden by default
    expect(screen.queryByTestId('inbox-changes-textarea')).toBeNull();
    expect(screen.queryByTestId('inbox-reject-reason')).toBeNull();
  });

  it('calls approveGate then advanceRun IN THAT EXACT ORDER on inbox.gate.approve', async () => {
    const callOrder: string[] = [];
    const client = createMockClient({
      approveGate: vi.fn().mockImplementation((runId: string, stage: string) => {
        callOrder.push(`gates.approve:${runId}:${stage}`);
        return Promise.resolve(undefined);
      }),
      advanceRun: vi.fn().mockImplementation((runId: string) => {
        callOrder.push(`runs.advance:${runId}`);
        return Promise.resolve({ id: runId, stage: 'research', status: 'running' });
      }),
    });

    renderInbox(client);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });

    const approveBtn = screen.getAllByRole('button', { name: /Approve and continue/i })[0];
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(callOrder).toEqual([
        'gates.approve:run-gate-a:gate_a',
        'runs.advance:run-gate-a',
      ]);
    });
  });

  it('opens decision sheet on inbox.decision.open and allows approving from within sheet', async () => {
    const client = createMockClient();
    renderInbox(client);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });

    const reviewBtn = screen.getByRole('button', { name: /Review decision/i });
    fireEvent.click(reviewBtn);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-decision-sheet')).toBeDefined();
    });

    // Approve from inside sheet
    const sheetApproveBtn = screen.getAllByRole('button', { name: /Approve and continue/i })[0];
    fireEvent.click(sheetApproveBtn);

    await waitFor(() => {
      expect(client.approveGate).toHaveBeenCalledWith('run-gate-a', 'gate_a');
      expect(client.advanceRun).toHaveBeenCalledWith('run-gate-a');
    });
  });

  it('renders changes and reject controls when capability enabled', async () => {
    (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    const client = createMockClient();
    renderInbox(client);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });

    const reviewBtn = screen.getByRole('button', { name: /Review decision/i });
    fireEvent.click(reviewBtn);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-changes-textarea')).toBeDefined();
      expect(screen.getByTestId('inbox-reject-reason')).toBeDefined();
    });

    const changesInput = screen.getByPlaceholderText('Describe requested adjustments precisely...');
    fireEvent.change(changesInput, { target: { value: 'Revise idea' } });

    const sendChangesBtn = screen.getByRole('button', { name: /Send change requests/i });
    fireEvent.click(sendChangesBtn);

    await waitFor(() => {
      expect(client.requestChanges).toHaveBeenCalledWith('run-gate-a', 'gate_a', 'Revise idea');
    });
  });

  it('navigates to project route on inbox.project.open', async () => {
    const client = createMockClient();
    renderInbox(client);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });

    const openProjBtn = screen.getByRole('button', { name: /Open project/i });
    fireEvent.click(openProjBtn);

    await waitFor(() => {
      expect(window.location.hash).toBe('#/p/proj-2');
    });
  });

  it('calls rejectGate on inbox.gate.reject.confirm when capability enabled', async () => {
    (window as unknown as Record<string, unknown>).__WARSHA_RUN_ENDING_ENABLED__ = true;
    const client = createMockClient();
    renderInbox(client);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-ready')).toBeDefined();
    });

    const reviewBtn = screen.getByRole('button', { name: /Review decision/i });
    fireEvent.click(reviewBtn);

    await waitFor(() => {
      expect(screen.getByTestId('inbox-reject-reason')).toBeDefined();
    });

    const reasonInput = screen.getByPlaceholderText('Reason for rejection (optional)...');
    fireEvent.change(reasonInput, { target: { value: 'Out of scope' } });

    const confirmRejectBtn = screen.getByRole('button', { name: /Confirm rejection/i });
    fireEvent.click(confirmRejectBtn);

    await waitFor(() => {
      expect(client.rejectGate).toHaveBeenCalledWith('run-gate-a', 'gate_a', 'Out of scope');
    });
  });
});
