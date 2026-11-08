import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type RunSummary,
} from '@warsha/client';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

// The two list reads the shell makes at start-up; a test sets them before rendering so the deep link
// can resolve a project and a run without a socket.
const wiring = vi.hoisted(() => ({ projects: [] as unknown[], runs: [] as unknown[] }));

vi.mock('@tauri-apps/api/core', () => {
  const configAnswers: Record<string, string> = {
    onboarding_complete: 'true',
    app_mode: 'simple',
    daemon_url: 'http://127.0.0.1:8766',
    daemon_ws_url: 'ws://127.0.0.1:8765',
    daemon_token: 'real-session-token',
  };
  return {
    invoke: vi.fn((command: string, args?: { key?: string }) =>
      command === 'get_config'
        ? Promise.resolve(configAnswers[args?.key ?? ''] ?? '')
        : Promise.resolve(undefined)
    ),
  };
});

vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    createClient: (baseUrl: string, token: string) => {
      const client = actual.createClient(baseUrl, token);
      client.listProjects = () => Promise.resolve(wiring.projects as ProjectSummary[]);
      client.listRuns = () => Promise.resolve(wiring.runs as RunSummary[]);
      return client;
    },
  };
});

const project: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'shop',
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

type Handler = (params: Record<string, unknown> | undefined) => unknown;

function rpcResponse(result: unknown) {
  return { json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) };
}

function rpcError(message: string) {
  return {
    json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, error: { code: -32000, message } }),
  };
}

/** One fetch stub that routes by JSON-RPC method; an unregistered method is a daemon refusal. */
function stubRpc(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      method: string;
      params?: Record<string, unknown>;
    };
    const handler = handlers[body.method];
    if (handler === undefined) return rpcError(`no stub for ${body.method}`);
    try {
      return rpcResponse(handler(body.params));
    } catch (error) {
      return rpcError(error instanceof Error ? error.message : String(error));
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsFor(fetchMock: ReturnType<typeof vi.fn>, method: string) {
  return fetchMock.mock.calls
    .map(
      (call) =>
        JSON.parse(String((call[1] as RequestInit).body)) as {
          method: string;
          params?: Record<string, unknown>;
        }
    )
    .filter((body) => body.method === method);
}

function renderApp(search = '') {
  window.history.pushState({}, '', `/${search}`);
  return render(
    <BrowserRouter>
      <LocaleProvider initialLocale="en">
        <App />
      </LocaleProvider>
    </BrowserRouter>
  );
}

function routineWire(overrides: Record<string, unknown> = {}) {
  return {
    id: 'routine-1',
    name: 'Nightly build',
    description: 'Run the build every night',
    schedule: { cron: '0 2 * * *' },
    state: 'idle',
    last_run_unix: null,
    ...overrides,
  };
}

const backendKitWire = {
  config: {
    kind: 'supabase',
    url: 'https://shop.supabase.co',
    project_name: 'shop',
    enabled_features: ['auth'],
  },
  tables: [{ name: 'users', columns: [{ name: 'id', col_type: 'uuid', nullable: false }] }],
  rls_policies: [],
  storage_buckets: [],
  functions: [],
};

beforeEach(() => {
  wiring.projects = [];
  wiring.runs = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('routines wiring', () => {
  it('lists the daemon routines when the screen mounts', async () => {
    stubRpc({
      'routines.list': () => [
        routineWire(),
        routineWire({
          id: 'routine-2',
          name: 'Poll',
          schedule: { interval_seconds: 30 },
          state: 'paused',
        }),
      ],
    });

    renderApp('?screen=routines');

    await screen.findByTestId('routine-row-routine-1');
    expect(screen.getByTestId('routine-row-routine-1-schedule')).toHaveTextContent('0 2 * * *');
    expect(screen.getByTestId('routine-row-routine-2-schedule')).toHaveTextContent('Every 30s');
    expect(screen.getByTestId('routines-count')).toHaveTextContent('2 routines');
  });

  it('runs a routine now with the daemon id and replaces the row with its answer', async () => {
    const fetchMock = stubRpc({
      'routines.list': () => [routineWire()],
      'routines.run_now': () => routineWire({ state: 'running' }),
    });

    renderApp('?screen=routines');
    fireEvent.click(await screen.findByTestId('routine-row-routine-1-run'));

    await waitFor(() =>
      expect(screen.getByTestId('routine-row-routine-1')).toHaveAttribute('data-state', 'running')
    );
    expect(callsFor(fetchMock, 'routines.run_now')).toHaveLength(1);
    expect(callsFor(fetchMock, 'routines.run_now')[0].params).toEqual({ id: 'routine-1' });
    expect(screen.getByTestId('routine-row-routine-1-pause')).toBeInTheDocument();
  });

  it('pauses a running routine and replaces the row with its answer', async () => {
    const fetchMock = stubRpc({
      'routines.list': () => [routineWire({ state: 'running' })],
      'routines.pause': () => routineWire({ state: 'paused' }),
    });

    renderApp('?screen=routines');
    fireEvent.click(await screen.findByTestId('routine-row-routine-1-pause'));

    await waitFor(() =>
      expect(screen.getByTestId('routine-row-routine-1')).toHaveAttribute('data-state', 'paused')
    );
    expect(callsFor(fetchMock, 'routines.pause')[0].params).toEqual({ id: 'routine-1' });
  });

  it('resumes a paused routine and replaces the row with its answer', async () => {
    const fetchMock = stubRpc({
      'routines.list': () => [routineWire({ state: 'paused' })],
      'routines.resume': () => routineWire({ state: 'running' }),
    });

    renderApp('?screen=routines');
    fireEvent.click(await screen.findByTestId('routine-row-routine-1-resume'));

    await waitFor(() =>
      expect(screen.getByTestId('routine-row-routine-1')).toHaveAttribute('data-state', 'running')
    );
    expect(callsFor(fetchMock, 'routines.resume')[0].params).toEqual({ id: 'routine-1' });
  });

  it('shows the catalog error and keeps the list when an action fails', async () => {
    stubRpc({
      'routines.list': () => [routineWire({ state: 'running' })],
      'routines.pause': () => {
        throw new Error('daemon said no');
      },
    });

    renderApp('?screen=routines');
    fireEvent.click(await screen.findByTestId('routine-row-routine-1-pause'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The daemon could not pause the routine.'
    );
    expect(screen.getByTestId('routine-row-routine-1')).toHaveAttribute(
      'data-state',
      'running'
    );
  });

  it('shows the catalog error and the empty state when the read fails', async () => {
    stubRpc({
      'routines.list': () => {
        throw new Error('down');
      },
    });

    renderApp('?screen=routines');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The daemon could not read the routines.'
    );
    expect(screen.getByTestId('routines-empty')).toBeInTheDocument();
  });
});

async function openBackendKit() {
  fireEvent.click(await screen.findByTestId('settings-open'));
  fireEvent.click(await screen.findByTestId('settings-tab-backend-kit'));
  return screen.findByTestId('backend-kit-panel');
}

describe('backend kit wiring', () => {
  beforeEach(() => {
    wiring.projects = [project];
    wiring.runs = [run];
  });

  it('reads the kit of the selected run', async () => {
    stubRpc({ 'backend.get': () => backendKitWire });

    renderApp('?screen=run');
    await screen.findByTestId('run-view-tabs');
    await openBackendKit();

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Supabase' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    );
    expect(screen.getByRole('checkbox', { name: 'Auth' })).toBeChecked();
    expect(screen.getByText('users')).toBeInTheDocument();
  });

  it('keeps the local defaults when the daemon answers null', async () => {
    stubRpc({ 'backend.get': () => null });

    renderApp('?screen=run');
    await screen.findByTestId('run-view-tabs');
    await openBackendKit();

    expect(screen.getByRole('radio', { name: 'PocketBase' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('checkbox', { name: 'Auth' })).not.toBeChecked();
    expect(screen.getByText('No tables yet')).toBeInTheDocument();
  });

  it('writes the kit back when the kind changes', async () => {
    const fetchMock = stubRpc({ 'backend.get': () => null, 'backend.set': () => null });

    renderApp('?screen=run');
    await screen.findByTestId('run-view-tabs');
    await openBackendKit();
    fireEvent.click(screen.getByRole('radio', { name: 'Supabase' }));

    await waitFor(() => expect(callsFor(fetchMock, 'backend.set')).toHaveLength(1));
    const call = callsFor(fetchMock, 'backend.set')[0];
    expect(call.params?.run_id).toBe('run-1');
    expect((call.params?.kit as { config: { kind: string } }).config.kind).toBe('supabase');
    expect(screen.getByRole('radio', { name: 'Supabase' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('disables export with the catalog reason when no directory is derivable', async () => {
    stubRpc({ 'backend.get': () => backendKitWire });

    renderApp('?screen=run');
    await screen.findByTestId('run-view-tabs');
    await openBackendKit();

    const button = screen.getByRole('button', { name: 'Export' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      'Export needs a workspace folder the daemon has not reported.'
    );
  });

  it('shows the catalog error and keeps the local edit when the write fails', async () => {
    stubRpc({
      'backend.get': () => null,
      'backend.set': () => {
        throw new Error('refused');
      },
    });

    renderApp('?screen=run');
    await screen.findByTestId('run-view-tabs');
    await openBackendKit();
    fireEvent.click(screen.getByRole('radio', { name: 'Supabase' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The daemon did not save the backend kit.'
    );
    expect(screen.getByRole('radio', { name: 'Supabase' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});
