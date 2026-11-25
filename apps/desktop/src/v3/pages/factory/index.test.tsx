import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RunId, WarshaClient, WarshaEvent, ProjectSummary, RunSummary } from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ClientProvider } from '../../app/ClientContext';

import { FactoryPage } from './index';

function run(id: string, status: string, projectId = 'proj-1'): RunSummary {
  return {
    id: id as RunSummary['id'],
    projectId: projectId as RunSummary['projectId'],
    stage: 'code',
    status,
    startedAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:05:00.000Z',
    runMode: 'agent',
  };
}

const PROJECT: ProjectSummary = {
  id: 'proj-1' as ProjectSummary['id'],
  name: 'Warsha',
  createdAt: '2026-11-18T09:00:00.000Z',
} as unknown as ProjectSummary;

function event(overrides: Partial<WarshaEvent> = {}): WarshaEvent {
  return {
    id: 'e1',
    runId: 'run-1',
    stage: 'code',
    role: 'coder',
    kind: 'AgentStep',
    payload: {},
    costCents: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    deviceId: null,
    ...overrides,
  } as WarshaEvent;
}

function createMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  return {
    listProjects: vi.fn().mockResolvedValue([PROJECT]),
    listRuns: vi.fn().mockResolvedValue([run('run-1', 'running'), run('run-2', 'completed')]),
    getRunEvents: vi.fn().mockResolvedValue([]),
    subscribeRun: vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        seq: 2,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: null,
        events:
          runId === 'run-1'
            ? [
                event({ id: 'e1' }),
                event({
                  id: 'e2',
                  kind: 'ToolCall',
                  payload: { tool: 'git_status', file: 'src/main.rs' },
                  costCents: 3,
                }),
              ]
            : [],
      })
    ),
    listRunSubtasks: vi.fn().mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }, { id: 'st-3' }]),
    cancelRun: vi.fn().mockResolvedValue({ ...run('run-1', 'cancelled') }),
    ...overrides,
  } as unknown as WarshaClient;
}

function renderFactory(client: WarshaClient) {
  return render(
    <ClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <FactoryPage />
      </I18nProvider>
    </ClientProvider>
  );
}

describe('Factory floor (E3)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi
        .fn()
        .mockReturnValue({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('STOP-ALL cancels every active run exactly once', async () => {
    const cancelRun = vi.fn().mockResolvedValue(run('run-1', 'cancelled'));
    const client = createMockClient({
      listRuns: vi
        .fn()
        .mockResolvedValue([
          run('run-1', 'running'),
          run('run-3', 'paused'),
          run('run-2', 'completed'),
        ]),
      cancelRun,
    });
    renderFactory(client);
    const button = await screen.findByTestId('factory-owner-corner');
    expect(button).toBeDefined();
    await waitFor(() => expect(screen.getAllByText(/Stop All/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText(/Stop All/i));
    await waitFor(() => expect(cancelRun).toHaveBeenCalledTimes(2));
    expect((cancelRun.mock.calls[0] as unknown[])[0]).toBe('run-1');
    expect((cancelRun.mock.calls[1] as unknown[])[0]).toBe('run-3');
  });

  it('opens the agent panel with the same figures E4 derives from the event stream', async () => {
    renderFactory(createMockClient());
    await waitFor(() => expect(screen.getAllByTestId(/^factory-agent-/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId(/^factory-agent-/)[0]);
    const panel = await screen.findByTestId('factory-agent-panel');
    expect(panel).toBeDefined();
    await waitFor(() => expect(screen.getByTestId('factory-panel-cost').textContent).toBe('3¢'));
    expect(screen.getByTestId('factory-panel-action').textContent).toContain('git_status');
    expect(screen.getByTestId('factory-panel-file').textContent).toBe('src/main.rs');
  });

  it('shows the swarm banner for runs with subtasks', async () => {
    renderFactory(createMockClient());
    await waitFor(() => expect(screen.getAllByTestId(/^factory-swarm-/).length).toBeGreaterThan(0));
  });

  it('toggles the list view by keypress and the aria-live region announces it', async () => {
    renderFactory(createMockClient());
    await waitFor(() => expect(screen.getAllByTestId(/^factory-agent-/).length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() => expect(screen.getByTestId('factory-list-view')).toBeDefined());
    expect(screen.getByTestId('factory-list-status').getAttribute('aria-live')).toBe('polite');
  });

  it('places a waiting agent from persisted history when the live ring is empty', async () => {
    const client = createMockClient({
      listRuns: vi.fn().mockResolvedValue([run('run-1', 'running')]),
      getRunEvents: vi.fn().mockResolvedValue([
        event({ kind: 'AgentStep', stage: 'design', role: 'designer' }),
        event({
          id: 'e2',
          kind: 'StageStarted',
          role: null,
          stage: 'gate_a',
          payload: { from: 'design', to: 'gate_a' },
          createdAt: '2026-11-18T10:00:01.000Z',
        }),
      ]),
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 0,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: null,
        events: [],
      }),
    });
    renderFactory(client);
    await waitFor(() => expect(screen.getByTestId('factory-agent-run-1:designer')).toBeDefined());
    expect(screen.getByTestId('factory-needs-you')).toBeDefined();
  });

  it('lays out 32 concurrent agents without overlap artefacts', async () => {
    const agents32 = Array.from({ length: 32 }, (_, index) =>
      event({ id: `e${index}`, runId: 'run-1' as RunId, role: 'coder', payload: { session: `s-${index}` } })
    );
    const client = createMockClient({
      subscribeRun: vi.fn().mockResolvedValue({
        seq: 32,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: null,
        events: agents32,
      }),
    });
    renderFactory(client);
    await waitFor(() => expect(screen.getAllByTestId(/^factory-agent-/)).toHaveLength(32));
  });

  it('drops every transition under prefers-reduced-motion', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    renderFactory(createMockClient());
    await waitFor(() => expect(screen.getByTestId('factory-floor').className).toContain('reduced'));
    matchMedia.mockRestore();
  });

  it('stops the idle tick when the tab is hidden (no rAF while hidden)', async () => {
    const spy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    renderFactory(createMockClient());
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(0));
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    const afterHide = spy.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy.mock.calls.length).toBe(afterHide);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });
});
