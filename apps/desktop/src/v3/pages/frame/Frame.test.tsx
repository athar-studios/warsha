import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createClient,
  type GateSummary,
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type RunSummary,
  type WarshaClient,
} from '@warsha/client';
import { I18nProvider } from '@warsha/i18n/v3';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @warsha/client to prevent real network calls from createClient in ClientProvider.reloadClient
vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    createClient: vi.fn(() => ({
      health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
      listProjects: vi.fn().mockResolvedValue([]),
      listRuns: vi.fn().mockResolvedValue([]),
      getGates: vi.fn().mockResolvedValue([]),
    })),
  };
});

import { CapabilitiesProvider } from '../../app/CapabilitiesContext';
import { ClientProvider } from '../../app/ClientContext';
import { DataReadyProvider } from '../../app/DataReadyContext';
import { DensityProvider } from '../../app/DensityContext';
import { clearToastListeners, notify } from '../../app/toast';
import { RouterProvider } from '../../router';
import OnboardingPage from '../onboarding';

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

function makeRun(
  id: string,
  projectId: string,
  stage: RunSummary['stage'],
  status: string
): RunSummary {
  return {
    id: id as RunId,
    projectId: projectId as ProjectId,
    stage,
    status,
    runMode: 'agent',
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
    client?: WarshaClient | null;
    initialPath?: string;
    locale?: 'ar' | 'en';
    initialMode?: 'simple' | 'developers';
    children?: React.ReactNode;
  } = {}
) {
  const client = options.client !== undefined ? options.client : makeMockClient();
  const {
    initialPath = '/',
    locale = 'ar',
    initialMode = 'simple',
    children = <div>page body</div>,
  } = options;

  if (typeof window !== 'undefined') {
    window.location.hash = `#${initialPath}`;
  }

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
      {
        stage: 'gate_a',
        state: { state: 'approved', by: 'dev-1' as never, at: '2026-10-01T00:00:00Z' },
      },
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
    expect(resolveProjectStatus(runs, t)).toEqual({
      status: 'waiting',
      label: 'frame.status_waiting',
    });
  });

  it('maps running, completed, failed, paused, and cancelled states (F4)', () => {
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'running')], t).status).toBe(
      'running'
    );
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'feedback', 'completed')], t).status).toBe(
      'done'
    );
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'failed')], t).status).toBe('failed');
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'paused')], t).status).toBe('paused');
    expect(resolveProjectStatus([makeRun('r1', 'p1', 'code', 'cancelled')], t)).toEqual({
      status: 'cancelled',
      label: 'frame.status_cancelled',
    });
  });
});

describe('frame pending gate status', () => {
  it.each([['en', 'Waiting'], ['ar', 'ينتظرك']] as const)('uses the current pending gate for %s frame and menu chips', async (locale, label) => {
    const { container } = await renderFrame({
      locale,
      initialPath: '/p/p1',
      client: makeMockClient({
        listProjects: vi.fn().mockResolvedValue([makeProject('p1', 'Test')]),
        listRuns: vi.fn().mockResolvedValue([makeRun('r1', 'p1', 'gate_a', 'running')]),
        getGates: vi.fn().mockResolvedValue([
          { stage: 'gate_a', state: { state: 'pending' } },
          { stage: 'gate_b', state: { state: 'pending' } },
        ]),
      }),
    });
    const trigger = container.querySelector('[data-action="frame.project.open"]') as HTMLElement;
    await waitFor(() => expect(trigger).toHaveTextContent(label));
    fireEvent.click(trigger);
    expect(screen.getByRole('option')).toHaveTextContent(label);
  });
});

describe('frame live run status', () => {
  it.each([
    ['en', 'cancelled', 'Cancelled'],
    ['ar', 'cancelled', 'ملغاة'],
    ['en', 'paused', 'Paused'],
    ['ar', 'paused', 'متوقّف'],
  ] as const)('refreshes %s %s without remounting', async (locale, status, label) => {
    vi.useFakeTimers();
    try {
      const listRuns = vi.fn().mockResolvedValue([makeRun('r1', 'p1', 'idea', 'running')]);
      const { container } = await renderFrame({
        locale,
        initialPath: '/p/p1',
        client: makeMockClient({
          listProjects: vi.fn().mockResolvedValue([makeProject('p1', 'Test')]),
          listRuns,
        }),
      });
      listRuns.mockResolvedValue([makeRun('r1', 'p1', 'idea', status)]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(container.querySelector('[data-action="frame.project.open"]')).toHaveTextContent(
        label
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Frame component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockImplementation(
      () =>
        ({
          health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
          listProjects: vi.fn().mockResolvedValue([]),
          listRuns: vi.fn().mockResolvedValue([]),
          getGates: vi.fn().mockResolvedValue([]),
        }) as unknown as WarshaClient
    );
    clearToastListeners();
    try {
      window.localStorage?.clear();
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      window.location.hash = '#/';
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
    expect(screen.getByText('المطورون')).toBeDefined();
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
    const projects = [makeProject(uuid, uuid), makeProject('p-named', 'Furniture App')];
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

    const trigger = container.querySelector(
      '[data-action="frame.project.open"]'
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeDefined();

    // Escape closes listbox and returns focus to trigger
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const search = screen.getByPlaceholderText('Search projects');
    fireEvent.change(search, { target: { value: 'Furniture' } });

    const option = container.querySelector(
      '[data-action="frame.project.switch"]'
    ) as HTMLButtonElement;
    expect(option).not.toBeNull();
    fireEvent.click(option);
    expect(window.location.hash).toBe('#/p/p-named');

    fireEvent.click(trigger);
    const newBtn = container.querySelector(
      '[data-action="frame.project.new"]'
    ) as HTMLButtonElement;
    fireEvent.click(newBtn);
    expect(window.location.hash).toBe('#/');
  });

  it('renders distinct cancelled status pill in ProjectSwitcher trigger for cancelled run (F4)', async () => {
    const projects = [makeProject('proj-c', 'Cancelled Project')];
    const client = makeMockClient({
      listProjects: vi.fn().mockResolvedValue(projects),
      listRuns: vi.fn().mockResolvedValue([makeRun('run-c', 'proj-c', 'code', 'cancelled')]),
    });

    const { container } = await renderFrame({
      client,
      initialPath: '/p/proj-c',
      locale: 'ar',
      children: <div>body</div>,
    });

    await waitFor(() => {
      expect(screen.getByText('Cancelled Project')).toBeDefined();
    });

    const trigger = container.querySelector('[data-action="frame.project.open"]');
    expect(trigger).not.toBeNull();
    const pill = trigger?.querySelector('[data-status="cancelled"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('ملغاة');
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

    const advBtn = container.querySelector(
      '[data-action="frame.mode.advanced"]'
    ) as HTMLButtonElement;
    fireEvent.click(advBtn);
    expect(root?.getAttribute('data-density')).toBe('compact');
    expect(advBtn.getAttribute('aria-checked')).toBe('true');

    expect(
      invokeCalls.some(
        (c) =>
          c.cmd === 'set_config' && c.args?.key === 'app_mode' && c.args?.value === 'developers'
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

    const retryBtn = container.querySelector(
      '[data-action="frame.daemon.retry"]'
    ) as HTMLButtonElement;

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

  it('shows danger Banner when client is null (daemon offline) and notifies on retry', async () => {
    const { container } = await renderFrame({ client: null, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });

    const retryBtn = container.querySelector(
      '[data-action="frame.daemon.retry"]'
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getAllByText('Cannot reach Warsha daemon — retry').length
      ).toBeGreaterThanOrEqual(1);
      expect(container.querySelector('.v3-frame-banner')).not.toBeNull();
    });
  });

  it('shows danger Banner when daemon health status is offline, preventing silent green', async () => {
    const client = makeMockClient({
      health: vi.fn().mockResolvedValue({ status: 'offline', version: '0.2.1' }),
    });
    await renderFrame({ client, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });
  });

  // RR-1: Retry recovers/rediscovers daemon - Tauri runtime with client null
  it('RR-1: Tauri retry invokes retry_daemon, reloads client, and succeeds when client is null', async () => {
    const invokeCalls: { cmd: string; args?: Record<string, unknown> }[] = [];
    let retried = false;
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokeCalls.push({ cmd, args });
        if (cmd === 'retry_daemon') {
          retried = true;
          return undefined;
        }
        if (cmd === 'get_config' && args?.key === 'daemon_url') {
          return retried ? 'http://127.0.0.1:9999' : '';
        }
        if (cmd === 'get_config' && args?.key === 'daemon_ws_url') {
          return retried ? 'ws://127.0.0.1:9998' : '';
        }
        if (cmd === 'get_config' && args?.key === 'daemon_token') {
          return retried ? 'test-token' : '';
        }
        return undefined;
      },
    };

    // Client starts as null (get_config returns '' before retry_daemon)
    const { container } = await renderFrame({ client: null, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });

    const retryBtn = container.querySelector(
      '[data-action="frame.daemon.retry"]'
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    // Click retry - should invoke retry_daemon, then reload client, then health succeeds
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // Verify retry_daemon was invoked
    expect(invokeCalls.some((c) => c.cmd === 'retry_daemon')).toBe(true);
    // Verify get_config was called for new endpoint
    expect(invokeCalls.some((c) => c.cmd === 'get_config' && c.args?.key === 'daemon_url')).toBe(
      true
    );

    // Banner should clear after successful health
    await waitFor(() => {
      expect(screen.queryByText('Cannot reach Warsha daemon — retry')).toBeNull();
    });
  });

  // RR-1: Retry when retry_daemon rejects - surfaces error cleanly
  it('RR-1: Tauri retry surfaces error when retry_daemon rejects', async () => {
    const invokeCalls: { cmd: string; args?: Record<string, unknown> }[] = [];
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokeCalls.push({ cmd, args });
        if (cmd === 'retry_daemon') throw new Error('Warsha is already running as pid 123');
        return undefined;
      },
    };

    const { container } = await renderFrame({ client: null, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });

    const retryBtn = container.querySelector(
      '[data-action="frame.daemon.retry"]'
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    // Click retry - retry_daemon rejects, error should surface
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // Verify retry_daemon was invoked
    expect(invokeCalls.some((c) => c.cmd === 'retry_daemon')).toBe(true);

    // Error toast should appear with the shell reason
    await waitFor(() => {
      expect(screen.getByText('Warsha is already running as pid 123')).toBeDefined();
    });
  });

  // RR-1: Retry when health initially fails but retry_daemon works
  it('RR-1: Tauri retry invokes retry_daemon when health fails, then succeeds', async () => {
    const invokeCalls: { cmd: string; args?: Record<string, unknown> }[] = [];
    let retried = false;

    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        invokeCalls.push({ cmd, args });
        if (cmd === 'retry_daemon') {
          retried = true;
          return undefined;
        }
        if (cmd === 'get_config' && args?.key === 'daemon_url') {
          return retried ? 'http://127.0.0.1:9999' : 'http://127.0.0.1:1111';
        }
        if (cmd === 'get_config' && args?.key === 'daemon_ws_url') {
          return retried ? 'ws://127.0.0.1:9998' : 'ws://127.0.0.1:1112';
        }
        if (cmd === 'get_config' && args?.key === 'daemon_token') return 'test-token';
        return undefined;
      },
    };

    vi.mocked(createClient).mockImplementation((baseUrl: string) => {
      if (baseUrl === 'http://127.0.0.1:1111') {
        return {
          health: vi.fn().mockRejectedValue(new Error('Daemon down')),
          listProjects: vi.fn().mockResolvedValue([]),
          listRuns: vi.fn().mockResolvedValue([]),
          getGates: vi.fn().mockResolvedValue([]),
        } as unknown as WarshaClient;
      }
      return {
        health: vi.fn().mockResolvedValue({ status: 'ok', version: '0.2.1' }),
        listProjects: vi.fn().mockResolvedValue([]),
        listRuns: vi.fn().mockResolvedValue([]),
        getGates: vi.fn().mockResolvedValue([]),
      } as unknown as WarshaClient;
    });

    const { container } = await renderFrame({ client: null, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });

    const retryBtn = container.querySelector(
      '[data-action="frame.daemon.retry"]'
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    // Click retry - should invoke retry_daemon because health failed, then reload client
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // Verify retry_daemon was invoked (because health failed)
    expect(invokeCalls.some((c) => c.cmd === 'retry_daemon')).toBe(true);
    // Verify get_config was called for new endpoint
    expect(invokeCalls.some((c) => c.cmd === 'get_config' && c.args?.key === 'daemon_url')).toBe(
      true
    );

    // Banner should clear after successful health
    await waitFor(() => {
      expect(screen.queryByText('Cannot reach Warsha daemon — retry')).toBeNull();
    });
  });

  // RR-1: Non-Tauri/browser mode retry still works
  it('RR-1: Non-Tauri retry calls reloadClient + health cleanly', async () => {
    // Ensure no Tauri internals
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const healthMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ status: 'ok', version: '0.2.1' });

    const client = makeMockClient({ health: healthMock });
    const { container } = await renderFrame({ client, locale: 'en' });

    await waitFor(() => {
      expect(screen.getByText('Cannot reach Warsha daemon — retry')).toBeDefined();
    });

    const retryBtn = container.querySelector(
      '[data-action="frame.daemon.retry"]'
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    // Click retry - should just call reloadClient (which will return the same client) and health
    await act(async () => {
      fireEvent.click(retryBtn);
      await Promise.resolve();
    });

    // Health should have been called
    expect(healthMock).toHaveBeenCalled();

    // Banner should clear
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

    const inboxBtn = container.querySelector(
      '[data-action="frame.inbox.open"]'
    ) as HTMLButtonElement;
    fireEvent.click(inboxBtn);
    expect(window.location.hash).toBe('#/inbox');

    const settingsBtn = container.querySelector(
      '[data-action="frame.settings.open"]'
    ) as HTMLButtonElement;
    fireEvent.click(settingsBtn);
    expect(window.location.hash).toBe('#/settings/general');
  });

  it('navigates to mode routes when mode tabs are clicked (G2/N4)', async () => {
    const { container } = await renderFrame({ locale: 'ar', initialPath: '/' });

    const factoryBtn = container.querySelector(
      '[data-action="frame.mode.factory"]'
    ) as HTMLButtonElement;
    expect(factoryBtn).not.toBeNull();
    fireEvent.click(factoryBtn);
    expect(window.location.hash).toBe('#/factory');
    expect(factoryBtn.getAttribute('aria-checked')).toBe('true');

    const advBtn = container.querySelector(
      '[data-action="frame.mode.advanced"]'
    ) as HTMLButtonElement;
    expect(advBtn).not.toBeNull();
    fireEvent.click(advBtn);
    expect(window.location.hash).toBe('#/developers');
    expect(advBtn.getAttribute('aria-checked')).toBe('true');

    const simpleBtn = container.querySelector(
      '[data-action="frame.mode.simple"]'
    ) as HTMLButtonElement;
    expect(simpleBtn).not.toBeNull();
    fireEvent.click(simpleBtn);
    expect(window.location.hash).toBe('#/');
    expect(simpleBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('leaves the run view (/p/:id) when clicking simple or other mode tabs (N10)', async () => {
    // 1. On /p/proj-run-view with simple mode active: clicking simple leaves run view to /
    const { container } = await renderFrame({ locale: 'ar', initialPath: '/p/proj-run-view' });
    expect(window.location.hash).toBe('#/p/proj-run-view');

    const simpleBtn = container.querySelector(
      '[data-action="frame.mode.simple"]'
    ) as HTMLButtonElement;
    expect(simpleBtn).not.toBeNull();
    fireEvent.click(simpleBtn);
    expect(window.location.hash).toBe('#/');
    expect(simpleBtn.getAttribute('aria-checked')).toBe('true');

    // 2. On /p/proj-2: clicking factory leaves run view to /factory
    const { container: c2 } = await renderFrame({ locale: 'ar', initialPath: '/p/proj-2' });
    expect(window.location.hash).toBe('#/p/proj-2');
    const factoryBtn = c2.querySelector('[data-action="frame.mode.factory"]') as HTMLButtonElement;
    fireEvent.click(factoryBtn);
    expect(window.location.hash).toBe('#/factory');

    // 3. On /p/proj-3: clicking advanced leaves run view to /developers
    const { container: c3 } = await renderFrame({ locale: 'ar', initialPath: '/p/proj-3' });
    expect(window.location.hash).toBe('#/p/proj-3');
    const advBtn = c3.querySelector('[data-action="frame.mode.advanced"]') as HTMLButtonElement;
    fireEvent.click(advBtn);
    expect(window.location.hash).toBe('#/developers');
  });

  it('supports keyboard navigation cycling through modes with consistent data-actions', async () => {
    const { container } = await renderFrame({ locale: 'en', initialPath: '/' });

    const simpleBtn = container.querySelector(
      '[data-action="frame.mode.simple"]'
    ) as HTMLButtonElement;
    const factoryBtn = container.querySelector(
      '[data-action="frame.mode.factory"]'
    ) as HTMLButtonElement;
    const advBtn = container.querySelector(
      '[data-action="frame.mode.advanced"]'
    ) as HTMLButtonElement;

    expect(simpleBtn).not.toBeNull();
    expect(factoryBtn).not.toBeNull();
    expect(advBtn).not.toBeNull();

    // In LTR, ArrowRight moves simple -> factory -> developers -> simple
    simpleBtn.focus();
    fireEvent.keyDown(simpleBtn, { key: 'ArrowRight' });
    expect(window.location.hash).toBe('#/factory');
    expect(document.activeElement).toBe(factoryBtn);

    fireEvent.keyDown(factoryBtn, { key: 'ArrowRight' });
    expect(window.location.hash).toBe('#/developers');
    expect(document.activeElement).toBe(advBtn);

    fireEvent.keyDown(advBtn, { key: 'ArrowRight' });
    expect(window.location.hash).toBe('#/');
    expect(document.activeElement).toBe(simpleBtn);
  });

  it('syncs mode when route changes to a mode-specific area', async () => {
    const { container } = await renderFrame({ locale: 'ar', initialPath: '/factory' });
    const factoryBtn = container.querySelector(
      '[data-action="frame.mode.factory"]'
    ) as HTMLButtonElement;
    await waitFor(() => {
      expect(factoryBtn.getAttribute('aria-checked')).toBe('true');
    });

    const { container: c2 } = await renderFrame({ locale: 'ar', initialPath: '/developers' });
    const advBtn = c2.querySelector('[data-action="frame.mode.advanced"]') as HTMLButtonElement;
    await waitFor(() => {
      expect(advBtn.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('renders sticky toolbar header using design system tokens (N6)', async () => {
    const { container } = await renderFrame({ locale: 'en' });

    const header = container.querySelector('header.w-app-frame__header');
    expect(header).not.toBeNull();

    const cssPath = resolve(__dirname, 'frame.css');
    const css = readFileSync(cssPath, 'utf8');
    const start = css.indexOf('.w-app-frame__header');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf('}', start);
    const rule = css.slice(start, end);

    expect(rule).toContain('position: sticky');
    expect(rule).toContain('top: 0');
    expect(rule).toContain('inset-block-start: 0');
    expect(rule).toContain('z-index: var(--w-layer-sticky)');
    expect(rule).toContain('background-color: var(--w-surface)');
  });

  it('B2 proving test: chooser updates and lists newly created projects after onboarding startAction completes', async () => {
    let listProjectsCalls = 0;
    const client = makeMockClient({
      listProjects: vi.fn().mockImplementation(async () => {
        listProjectsCalls++;
        if (listProjectsCalls === 1) {
          return [];
        }
        return [makeProject('p1', 'Alpha Project'), makeProject('p2', 'Beta Project')];
      }),
      listProviders: vi.fn().mockResolvedValue([]),
      listPreferences: vi.fn().mockResolvedValue([]),
      createProject: vi.fn().mockResolvedValue(makeProject('p1', 'Alpha Project')),
      startRun: vi.fn().mockResolvedValue(makeRun('r1', 'p1', 'idea', 'running')),
      setProjectBudget: vi.fn().mockResolvedValue(undefined),
    });

    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === 'get_config') return 'simple';
        if (cmd === 'set_config') return undefined;
        return undefined;
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
      convertFileSrc: (p: string) => p,
    };

    window.location.hash = '#/onboarding?step=idea';
    const { container } = await renderFrame({
      client,
      initialPath: '/onboarding?step=idea',
      locale: 'en',
      children: (
        <CapabilitiesProvider client={client}>
          <OnboardingPage />
        </CapabilitiesProvider>
      ),
    });

    // Initial state: projects.list returned empty array, chooser shows no projects
    expect(listProjectsCalls).toBe(1);
    const trigger = container.querySelector(
      '[data-action="frame.project.open"]'
    ) as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText('No projects found')).toBeDefined();
    fireEvent.click(trigger);

    // Complete onboarding wizard startAction
    const ideaInput = screen.getByLabelText(/Your first idea/i);
    fireEvent.change(ideaInput, { target: { value: 'Alpha Project Idea' } });

    const startBtn = screen.getByTestId('onboarding-start-btn');
    await act(async () => {
      fireEvent.click(startBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(client.createProject).toHaveBeenCalled();
    });

    // After startAction completes, open the chooser: it must now list the projects!
    fireEvent.click(trigger);
    const menu = container.querySelector('[role="listbox"]') as HTMLElement;
    expect(menu).not.toBeNull();
    await waitFor(() => {
      expect(within(menu).getByText('Alpha Project')).toBeDefined();
      expect(within(menu).getByText('Beta Project')).toBeDefined();
    });
    expect(within(menu).queryByText('No projects found')).toBeNull();
  });
});
