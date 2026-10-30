import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createClient,
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type RunSummary,
  type WarshaClient,
} from '@warsha/client';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import App from './App';
import { RunView } from './screens/RunView';
import { SimpleMode } from './screens/SimpleMode';

// The shell renders its screens only once onboarding is done, and onboarding reads the
// Tauri config. `invoke` is mocked so these tests drive the shell instead of the
// onboarding screen; nothing here reaches the real Tauri bridge.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string, args?: { key?: string }) => {
    if (command === 'get_config') {
      return Promise.resolve(args?.key === 'onboarding_complete' ? 'true' : 'simple');
    }
    return Promise.resolve(undefined);
  }),
}));

// Every client the app builds lists nothing, so no test opens a socket.
vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    createClient: (baseUrl: string, token: string) => {
      const client = actual.createClient(baseUrl, token);
      client.listProjects = () => Promise.resolve([]);
      client.listRuns = () => Promise.resolve([]);
      return client;
    },
  };
});

/** The app's own client factory, with the two list calls resolving empty. */
function offlineClient(): WarshaClient {
  return createClient('http://127.0.0.1:8766', 'test-token');
}

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: 'proj-1' as ProjectId,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

function renderApp() {
  return render(
    <BrowserRouter>
      <LocaleProvider initialLocale="ar">
        <App />
      </LocaleProvider>
    </BrowserRouter>
  );
}

function renderRunView() {
  return render(
    <LocaleProvider initialLocale="ar">
      <RunView client={offlineClient()} run={run} onBack={() => undefined} />
    </LocaleProvider>
  );
}

const project: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'متجر ورشة',
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

function renderSimpleMode() {
  return render(
    <LocaleProvider initialLocale="ar">
      <SimpleMode client={offlineClient()} project={project} />
    </LocaleProvider>
  );
}

/**
 * Render the screen and wait for its async init (agent list and the welcome message) to land,
 * so the assertions below see a settled component instead of an `act(...)` warning.
 */
async function openSimpleMode(): Promise<void> {
  renderSimpleMode();
  await screen.findByText(/أهلاً بك في مشروع/);
}

/**
 * A stand-in for the DOM WebSocket: the Simple mode screen subscribes to the daemon's event
 * stream on mount, and this keeps the connection from being opened at all.
 */
class SilentWebSocket {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    void url;
    void protocols;
  }

  close(): void {
    // Nothing was opened, so there is nothing to close.
  }
}

/** One JSON-RPC result envelope, as `fetch` resolves it. */
function rpcResponse(result: unknown): { json: () => Promise<unknown> } {
  return { json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) };
}

/** The body of the last RPC request a stubbed `fetch` received. */
function lastRpcCall(fetchMock: ReturnType<typeof vi.fn>): {
  method: string;
  params?: Record<string, unknown>;
} {
  const calls = fetchMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const init = calls[calls.length - 1][1] as RequestInit;
  if (typeof init.body !== 'string') throw new Error('the RPC call sent no JSON body');
  return JSON.parse(init.body) as { method: string; params?: Record<string, unknown> };
}

describe('desktop app', () => {
  it('renders without crashing', () => {
    renderApp();
    expect(true).toBe(true);
  });

  it('mounts the status strip, the permission chip and the plan badge in the top bar', async () => {
    renderApp();

    await waitFor(() => expect(screen.getByTestId('status-strip')).toBeInTheDocument());
    expect(screen.getByTestId('plan-mode-badge')).toHaveAttribute('data-mode', 'plan');
    // The permission chip's aria-label is `<label> — <hint>`; the label is the ar text.
    expect(screen.getByRole('button', { name: /اسأل عند الخطر/ })).toBeInTheDocument();
  });

  it('flips the plan badge to agent mode when the owner asks for it', async () => {
    renderApp();

    const badge = await screen.findByTestId('plan-mode-badge');
    fireEvent.click(badge);

    await waitFor(() =>
      expect(screen.getByTestId('plan-mode-badge')).toHaveAttribute('data-mode', 'agent')
    );
  });

  it('reaches every settings sub-screen from the settings tab strip', async () => {
    renderApp();

    const settingsButton = await screen.findByTestId('settings-open');
    fireEvent.click(settingsButton);

    expect(screen.getByTestId('settings-tabs')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-tab-routines'));
    expect(screen.getByTestId('routines')).toBeInTheDocument();
    expect(screen.getByTestId('routines-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-tab-settings-providers'));
    expect(screen.getByTestId('settings-providers')).toBeInTheDocument();
    // The one-click setup wizard is mounted under Settings → Providers.
    expect(screen.getByRole('button', { name: /اختبر الاتصال|Test connection/ })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-tab-crash-reports'));
    expect(screen.getByTestId('crash-reports')).toBeInTheDocument();
    expect(screen.getByTestId('crash-reports-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-tab-store-reviews'));
    expect(screen.getByTestId('store-reviews')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-tab-backend-kit'));
    expect(screen.getByTestId('backend-kit-panel')).toBeInTheDocument();
    // The payments gate is shut until the owner approves it.
    expect(screen.getByTestId('payments-gate')).toHaveAttribute('data-enabled', 'false');
  });
});

describe('run view mounts', () => {
  it('shows the live preview on the preview tab and runs it', () => {
    renderRunView();

    expect(screen.getByTestId('run-view-tabs')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('run-tab-preview'));

    expect(screen.getByTestId('live-preview')).toHaveAttribute('data-status', 'idle');
    expect(screen.getByTestId('live-preview-placeholder')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('preview-run-button'));

    expect(screen.getByTestId('live-preview')).toHaveAttribute('data-status', 'running');
  });

  it('opens the handoff dialog from the run view header and closes it again', () => {
    renderRunView();

    fireEvent.click(screen.getByTestId('handoff-open'));

    expect(screen.getByTestId('handoff-dialog')).toHaveAttribute('data-phase', 'idle');

    fireEvent.click(screen.getByTestId('handoff-close'));
    expect(screen.queryByTestId('handoff-dialog')).not.toBeInTheDocument();
  });

  it('mounts the review & apply panel on the handoff tab', () => {
    renderRunView();

    fireEvent.click(screen.getByTestId('run-tab-handoff'));

    expect(screen.getByTestId('review-apply-panel')).toBeInTheDocument();
    expect(screen.getByTestId('review-apply-empty')).toBeInTheDocument();
    // Nothing has come back from a remote run yet, so both apply buttons stay off.
    expect(screen.getByTestId('review-apply-all')).toBeDisabled();
    expect(screen.getByTestId('review-apply-selected')).toBeDisabled();
  });

  it('mounts eco mode and the local/cloud badges on the router & cost tab', () => {
    renderRunView();

    fireEvent.click(screen.getByTestId('run-tab-router'));

    const eco = screen.getByRole('switch', { name: /الوضع الاقتصادي|Eco mode/ });
    expect(eco).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(eco);
    expect(screen.getByRole('switch', { name: /الوضع الاقتصادي|Eco mode/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    // No router targets are reported yet, so the empty line is what shows.
    expect(screen.getByText(/لا توجد أهداف توجيه بعد|No router targets yet/)).toBeInTheDocument();
  });
});

describe('simple mode composer', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', SilentWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the mention picker on @ and inserts the picked kind', async () => {
    await openSimpleMode();

    const input = screen.getByTestId('simple-composer-input');
    fireEvent.change(input, { target: { value: '@fi' } });

    const picker = await screen.findByTestId('mention-picker');
    expect(picker).toHaveAttribute('data-query', 'fi');
    // Only one autocomplete at a time.
    expect(screen.queryByTestId('slash-command-picker')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /@file/ }));

    expect(input).toHaveValue('@file ');
    expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument();
  });

  it('opens the slash command picker on / and inserts the picked command', async () => {
    await openSimpleMode();

    const input = screen.getByTestId('simple-composer-input');
    fireEvent.change(input, { target: { value: '/re' } });

    const picker = await screen.findByTestId('slash-command-picker');
    expect(picker).toHaveAttribute('data-query', 're');
    expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /\/review/ }));

    expect(input).toHaveValue('/review ');
    expect(screen.queryByTestId('slash-command-picker')).not.toBeInTheDocument();
  });

  it('keeps the pickers shut for an address and an already-resolved mention', async () => {
    await openSimpleMode();

    const input = screen.getByTestId('simple-composer-input');

    fireEvent.change(input, { target: { value: 'dev@example.com' } });
    expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'please read @file:src/main.rs' } });
    expect(screen.queryByTestId('mention-picker')).not.toBeInTheDocument();
  });
});

describe('wiring rpc', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the two path-returning methods with the daemon’s snake_case params', async () => {
    const client = offlineClient();

    fetchMock.mockResolvedValueOnce(rpcResponse('/tmp/export/schema.sql'));
    await expect(client.exportBackend('run-1' as RunId, '/tmp/export')).resolves.toBe(
      '/tmp/export/schema.sql'
    );
    expect(lastRpcCall(fetchMock)).toMatchObject({
      method: 'backend.export',
      params: { run_id: 'run-1', output_dir: '/tmp/export' },
    });

    fetchMock.mockResolvedValueOnce(rpcResponse('/data/handoff/handoff-run-1.json'));
    await expect(
      client.createHandoff('run-1' as RunId, [['src/main.ts', 'export const a = 1;']])
    ).resolves.toBe('/data/handoff/handoff-run-1.json');
    expect(lastRpcCall(fetchMock)).toMatchObject({
      method: 'handoff.create',
      params: { run_id: 'run-1', files: [['src/main.ts', 'export const a = 1;']] },
    });
  });

  it('decodes the handoff summary and the two post-launch lists', async () => {
    const client = offlineClient();

    const summary = {
      applied: ['src/a.ts'],
      conflicts: [{ path: 'src/a.ts', local_checksum: 'aaa', remote_checksum: 'bbb' }],
      backups: ['src/a.ts'],
      resolved: ['src/a.ts'],
      backup_dir: '/repo/.warsha-backup/1',
    };
    fetchMock.mockResolvedValueOnce(rpcResponse(JSON.stringify(summary)));
    await expect(client.applyHandoff('/data/handoff-run-1.json', true)).resolves.toEqual(summary);
    expect(lastRpcCall(fetchMock)).toMatchObject({
      method: 'handoff.apply',
      params: { path: '/data/handoff-run-1.json', owner_wins: true },
    });

    fetchMock.mockResolvedValueOnce(rpcResponse([]));
    await expect(client.listCrashReports()).resolves.toEqual([]);
    expect(lastRpcCall(fetchMock)).toMatchObject({
      method: 'postlaunch.crashes',
      params: { run_id: '' },
    });

    const review = {
      id: 'rev-1',
      store: 'microsoft_store',
      rating: 4,
      body: 'سريع ومفيد',
      author: 'owner',
      received_at: 1_700_000_000,
    };
    fetchMock.mockResolvedValueOnce(rpcResponse([review]));
    await expect(client.listStoreReviews('microsoft_store')).resolves.toEqual([review]);
    expect(lastRpcCall(fetchMock)).toMatchObject({
      method: 'postlaunch.reviews',
      params: { store: 'microsoft_store' },
    });
  });

  it('rejects a malformed result instead of handing a screen undefined', async () => {
    const client = offlineClient();

    fetchMock.mockResolvedValueOnce(rpcResponse({ not: 'a list' }));
    await expect(client.listCrashReports('run-1' as RunId)).rejects.toThrow(
      /Malformed RPC result from postlaunch\.crashes/
    );

    fetchMock.mockResolvedValueOnce(rpcResponse('not json at all'));
    await expect(client.applyHandoff('/data/handoff-run-1.json', false)).rejects.toThrow(
      /Malformed RPC result from handoff\.apply: not valid JSON/
    );
  });
});
