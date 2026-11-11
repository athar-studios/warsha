import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GateSummary, ProjectId, ProjectSummary, RunId, RunSummary, WarshaClient } from '@warsha/client';
// eslint-disable-next-line import/no-unresolved
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { clearToastListeners, notify } from '../../app/toast';
import { RouterProvider } from '../../router';

import { countPendingGatesAtCurrentStage, Frame } from './Frame';
import { resolveProjectStatus } from './FrameProjectSwitcher';

function makeProject(id: string, name: string): ProjectSummary {
  return {
    id: id as ProjectId,
    name,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
  };
}

function makeRun(id: string, projectId: string, stage: RunSummary['stage'], status: string): RunSummary {
  return {
    id: id as RunId,
    projectId: projectId as ProjectId,
    stage,
    status,
    startedAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T09:00:00.000Z',
  };
}

function makeMockClient(overrides: Partial<WarshaClient> = {}): WarshaClient {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
    listProjects: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
    getGates: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as WarshaClient;
}

async function renderFrame(
  options: {
    client?: WarshaClient;
    initialPath?: string;
    locale?: 'ar' | 'en';
    initialMode?: 'simple' | 'advanced';
    children?: React.ReactNode;
  } = {}
) {
  const {
    client = makeMockClient(),
    initialPath = '/',
    locale = 'ar',
    initialMode = 'simple',
    children = <div>page body</div>,
  } = options;

  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      <ClientProvider client={client}>
        <I18nProvider initialLocale={locale}>
          <DensityProvider initialMode={initialMode}>
            <DataReadyProvider>
              <RouterProvider initialPath={initialPath}>
                <Frame>{children}</Frame>
              </RouterProvider>
            </DataReadyProvider>
          </DensityProvider>
        </I18nProvider>
      </ClientProvider>
    );
    await Promise.resolve();
  });
  return utils;
}

describe('countPendingGatesAtCurrentStage (amendment §5.5-b)', () => {
  const allPending: GateSummary[] = [
    { stage: 'gate_a', state: { state: 'pending' } },
    { stage: 'gate_b', state: { state: 'pending' } },
    { stage: 'gate_c', state: { state: 'pending' } },
    { stage: 'gate_d', state: { state: 'pending' } },
  ];

  it('counts only the pending gate at the run current stage, never future gates', () => {
    expect(countPendingGatesAtCurrentStage(allPending, 'gate_a')).toBe(1);
    expect(countPendingGatesAtCurrentStage(allPending, 'gate_b')).toBe(1);
    expect(countPendingGatesAtCurrentStage(allPending, 'gate_c')).toBe(1);
    expect(countPendingGatesAtCurrentStage(allPending, 'gate_d')).toBe(1);
  });

  it('returns 0 when run stage is not a gate stage even if future gates are pending', () => {
    expect(countPendingGatesAtCurrentStage(allPending, 'idea')).toBe(0);
    expect(countPendingGatesAtCurrentStage(allPending, 'code')).toBe(0);
    expect(countPendingGatesAtCurrentStage(allPending, 'research')).toBe(0);
  });

  it('returns 0 when gate at current stage is already approved or rejected', () => {
    const decided: GateSummary[] = [
      { stage: 'gate_a', state: { state: 'approved', by: 'dev-1' as never, at: '2026-10-01T00:00:00Z' } },
      { stage: 'gate_b', state: { state: 'pending' } },
    ];
    expect(countPendingGatesAtCurrentStage(decided, 'gate_a')).toBe(0);
  });
});

describe('resolveProjectStatus', () => {
  const t = (key: string): string => key;

  it('maps awaiting_gate before other runs and falls back to idle when empty', () => {
    expect(resolveProjectStatus([], t)).toEqual({ status: 'idle', label: 'frame.status_idle' });
    const runs = [
      makeRun('r1', 'p1', 'code', 'running'),
      makeRun('r2', 'p1', 'gate_a', 'awaiting_gate'),
    ];
    expect(resolveProjectStatus(runs, t)).toEqual({ status: 'waiting', label: 'frame.status_waiting' });
  });

  it('maps running, completed, failed, and paused states', () => {
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'running')], t).status).toBe('running');
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'feedback', 'completed')], t).status).toBe('done');
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'failed')], t).status).toBe('failed');
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'paused')], t).status).toBe('paused');
  });
});

describe('Frame component', () => {
  beforeEach(() => {
    clearToastListeners();
    try {
      window.localStorage?.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('renders TopBar controls, skip link, and main[data-ready="true"] in English and Arabic', async () => {
    const { container, unmount } = await renderFrame({ locale: 'en' });

    expect(screen.getByText('Warsha')).toBeDefined();
    expect(container.querySelector('[data-action="frame.skip-to-main"]')).not.toBeNull();
    expect(container.querySelector('[data-action="frame.project.open"]')).not.toBeNull();
    expect(container.querySelector('[data-action="frame.mode.simple"]')).not.toBeNull();
    expect(container.querySelector('[data-action="frame.mode.advanced"]')).not.toBeNull();
    expect(container.querySelector('[data-action="frame.inbox.open"]')).not.toBeNull();
    expect(container.querySelector('[data-action="frame.settings.open"]')).not.toBeNull();

    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect(main?.getAttribute('data-ready')).toBe('true');

    unmount();

    await renderFrame({ locale: 'ar' });
    expect(screen.getByText('ورشة')).toBeDefined();
    expect(screen.getByText('بسيط')).toBeDefined();
    expect(screen.getByText('متقدّم')).toBeDefined();
  });

  it('counts inbox decisions strictly at each run current stage from gates.list', async () => {
    const projects = [makeProject('p1', 'Store'), makeProject('p2', 'Clinic')];
    const runsByProj: Record<string, RunSummary[]> = {
      p1: [makeRun('r1', 'p1', 'gate_a', 'awaiting_gate')],
      p2: [makeRun('r2', 'p2', 'code', 'running')],
    };
    const allPending: GateSummary[] = [
      { stage: 'gate_a', state: { state: 'pending' } },
      { stage: 'gate_b', state: { state: 'pending' } },
      { stage: 'gate_c', state: { state: 'pending' } },
      { stage: 'gate_d', state: { state: 'pending' } },
    ];
    const client = makeMockClient({
      listProjects: vi.fn().mockResolvedValue(projects),
      listRuns: vi.fn().mockImplementation(async (pid: ProjectId) => runsByProj[pid] ?? []),
      getGates: vi.fn().mockResolvedValue(allPending),
    });

    await renderFrame({ client, locale: 'en' });

    await waitFor(() => {
      const inboxBtn = screen.getByRole('button', { name: 'Decisions waiting: 1' });
      expect(inboxBtn).toBeDefined();
    });
  });

  it('never displays raw UUIDs in ProjectSwitcher, supports switching, Escape close, and new project', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const projects = [
      makeProject(uuid, uuid),
      makeProject('p-named', 'Furniture App'),
    ];
    const client = makeMockClient({
      listProjects: vi.fn().mockResolvedValue(projects),
      listRuns: vi.fn().mockResolvedValue([]),
    });

    const { container } = await renderFrame({
      client,
      initialPath: `/p/${uuid}`,
      locale: 'en',
      children: <textarea aria-label="Idea" />,
    });

    await waitFor(() => {
      expect(screen.getByText('Unnamed project')).toBeDefined();
    });
    expect(screen.queryByText(uuid)).toBeNull();

    const trigger = container.querySelector('[data-action="frame.project.open"]') as HTMLButtonElement;
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeDefined();

    // Escape closes listbox and returns focus to trigger
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const search = screen.getByPlaceholderText('Search projects');
    fireEvent.change(search, { target: { value: 'Furniture' } });

    const option = container.querySelector('[data-action="frame.project.switch"]') as HTMLButtonElement;
    expect(option).not.toBeNull();
    fireEvent.click(option);
    expect(window.location.hash).toBe('#/p/p-named');

    fireEvent.click(trigger);
    const newBtn = container.querySelector('[data-action="frame.project.new"]') as HTMLButtonElement;
    fireEvent.click(newBtn);
    expect(window.location.hash).toBe('#/');
  });

  it('switches between simple and advanced modes, persists app_mode via Tauri invoke, and supports arrows', async () => {
    const invokeCalls: { cmd: string; args?: Record<string, unknown> }[] = [];
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokeCalls.push({ cmd, args });
        if (cmd === 'get_config' && args?.key === 'app_mode') return 'simple';
        return undefined;
      },
    };

    const { container } = await renderFrame({ locale: 'ar', initialMode: 'simple' });

    const root = container.querySelector('.v3-frame-root');
    expect(root?.getAttribute('data-density')).toBe('comfortable');

    const advBtn = container.querySelector('[data-action="frame.mode.advanced"]') as HTMLButtonElement;
    fireEvent.click(advBtn);
    expect(root?.getAttribute('data-density')).toBe('compact');
    expect(advBtn.getAttribute('aria-checked')).toBe('true');

    expect(
      invokeCalls.some(
        (c) => c.cmd === 'set_config' && c.args?.key === 'app_mode' && c.args?.value === 'advanced'
      )
    ).toBe(true);

    fireEvent.keyDown(advBtn, { key: 'ArrowLeft' });
    expect(root?.getAttribute('data-density')).toBe('comfortable');
  });

  it('wires ToastProvider to U2 notify() for error and success notifications', async () => {
    await renderFrame({ locale: 'en' });

    act(() => {
      notify({ type: 'error', message: 'Network error occurred' });
    });
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Network error occurred')).toBeDefined();

    act(() => {
      notify({ type: 'success', message: 'Saved successfully' });
    });
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText('Saved successfully')).toBeDefined();
  });

  it('shows danger Banner when daemon health fails, notifies on retry failure, and clears on recovery', async () => {
    const healthMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Daemon down'))
      .mockRejectedValueOnce(new Error('Still unreachable'))
      .mockResolvedValue({ status: 'ok', version: '0.2.1' });

    const client = makeMockClient({ health: healthMock });
    const { container } = await renderFrame({ client, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });

    const retryBtn = container.querySelector('[data-action="frame.daemon.retry"]') as HTMLButtonElement;

    // First retry fails -> error toast rendered via ToastProvider
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('Still unreachable')).toBeDefined();
    });

    // Second retry succeeds -> health.reload clears banner
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText('Cannot reach Warsha daemon — retry')).toBeNull();
    });
  });

  it('focuses #main on skip-to-main click and navigates on inbox/settings clicks', async () => {
    const { container } = await renderFrame({ locale: 'en' });

    const skip = container.querySelector('[data-action="frame.skip-to-main"]') as HTMLAnchorElement;
    const main = container.querySelector('#main') as HTMLElement;
    fireEvent.click(skip);
    expect(document.activeElement).toBe(main);

    const inboxBtn = container.querySelector('[data-action="frame.inbox.open"]') as HTMLButtonElement;
    fireEvent.click(inboxBtn);
    expect(window.location.hash).toBe('#/inbox');

    const settingsBtn = container.querySelector('[data-action="frame.settings.open"]') as HTMLButtonElement;
    fireEvent.click(settingsBtn);
    expect(window.location.hash).toBe('#/settings/general');
  });
});
