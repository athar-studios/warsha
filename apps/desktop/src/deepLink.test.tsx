// @warsha/desktop — opening a screen directly (`?screen=…`).
//
// The shell routes on state, so a screen has no address of its own. The query parameter is the one
// way in, and `apps/desktop/e2e/` depends on it to screenshot every screen without clicking through
// the app first — so it is tested here at the level it breaks: which names are accepted, and what
// the shell has to select before a screen that renders a project or a run can mount.
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ProjectId, ProjectSummary, RunId, RunSummary } from '@warsha/client';
import { LocaleProvider } from '@warsha/i18n';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import App, { requestedScreen } from './App';

const project: ProjectSummary = {
  id: 'proj-1' as ProjectId,
  name: 'متجر ورشة',
  createdAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

const run: RunSummary = {
  id: 'run-1' as RunId,
  projectId: project.id,
  stage: 'code',
  status: 'running',
  startedAt: '2026-10-31T10:00:00.000Z',
  updatedAt: '2026-10-31T10:00:00.000Z',
};

// Onboarding is done and the mode is Simple, exactly as the browser suite stubs it. One project with
// one run exists, so a screen that needs one has something to select. The daemon keys are what a
// real shell reports (see `App.test.tsx` / `daemon.ts`): the App stays offline with no RPC base.
vi.mock('@tauri-apps/api/core', () => {
  const configAnswers: Record<string, string> = {
    onboarding_complete: 'true',
    app_mode: 'simple',
    daemon_url: 'http://127.0.0.1:8766',
    daemon_ws_url: 'ws://127.0.0.1:8765',
    daemon_token: 'real-session-token',
  };
  return {
    invoke: vi.fn((command: string, args?: { key?: string }) => {
      if (command === 'get_config') {
        return Promise.resolve(configAnswers[args?.key ?? ''] ?? '');
      }
      return Promise.resolve(undefined);
    }),
  };
});

vi.mock('@warsha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@warsha/client')>();
  return {
    ...actual,
    createClient: (baseUrl: string, token: string) => {
      const client = actual.createClient(baseUrl, token);
      client.listProjects = () => Promise.resolve([project]);
      client.listRuns = () => Promise.resolve([run]);
      client.getGates = () => Promise.resolve([]);
      // The shell's own readings, so no deep-link case opens a socket or reaches a port (§7 states are
      // exercised at the screen level, not by a live daemon here).
      client.getProjectBudget = () =>
        Promise.resolve({ totalBudgetUsd: 10, spentUsd: 2.5, remainingUsd: 7.5 });
      client.agentState = () => Promise.resolve({ mode: 'plan', approvals: [], todos: [], model_wired: false });
      client.getRunLogs = () => Promise.resolve([]);
      client.listCrashReports = () => Promise.resolve([]);
      client.listStoreReviews = () => Promise.resolve([]);
      return client;
    },
  };
});

/**
 * A stand-in for the DOM WebSocket: Simple mode subscribes to the daemon's event stream on mount,
 * and this keeps the connection from being opened at all.
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

/** Load the app at `search`, e.g. `?screen=routines`. */
function renderAt(search: string) {
  window.history.replaceState({}, '', `/${search}`);
  return render(
    <BrowserRouter>
      <LocaleProvider initialLocale="ar" storage={null}>
        <App />
      </LocaleProvider>
    </BrowserRouter>
  );
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', SilentWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('requestedScreen', () => {
  it('accepts every screen the shell can render', () => {
    expect(requestedScreen('?screen=projects')).toBe('projects');
    expect(requestedScreen('?screen=run')).toBe('run');
    expect(requestedScreen('?screen=simple')).toBe('simple');
    expect(requestedScreen('?screen=routines')).toBe('routines');
    expect(requestedScreen('?screen=settings')).toBe('settings');
    expect(requestedScreen('?screen=crash-reports')).toBe('crash-reports');
    expect(requestedScreen('?screen=store-reviews')).toBe('store-reviews');
  });

  it('returns nothing for a missing, unknown or onboarding name', () => {
    expect(requestedScreen('')).toBeNull();
    expect(requestedScreen('?screen=')).toBeNull();
    expect(requestedScreen('?screen=nowhere')).toBeNull();
    // Onboarding is decided by `get_config`, never by a URL.
    expect(requestedScreen('?screen=onboarding')).toBeNull();
  });
});

describe('opening a screen from the query parameter', () => {
  it('opens the run view, selecting the project and its first run first', async () => {
    renderAt('?screen=run');

    expect(await screen.findByTestId('run-view-tabs')).toBeInTheDocument();
    // The bench's contextual identity names what the deep link selected (§4).
    expect(screen.getByTestId('bench-project-id')).toHaveTextContent(project.id);
    expect(screen.getByTestId('bench-run-id')).toHaveTextContent(run.id);
  });

  it('opens the advanced bench with the project selected', async () => {
    renderAt('?screen=advanced');

    expect(await screen.findByTestId('advanced-mode')).toBeInTheDocument();
    expect(screen.getByTestId('advanced-project-name')).toHaveTextContent(project.name);
    // The rail and the pane strip are the bench's own regions (§5).
    expect(screen.getByTestId('advanced-rail')).toBeInTheDocument();
    expect(screen.getByTestId('advanced-tabs')).toHaveAttribute('role', 'tablist');
  });

  it('opens a settings screen', async () => {
    renderAt('?screen=crash-reports');

    expect(await screen.findByTestId('crash-reports')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tabs')).toBeInTheDocument();
    // The tab that opened is the panel's named label, and only one tab is in the Tab order (§9).
    expect(screen.getByTestId('settings-tab-crash-reports')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'settings-panel-crash-reports-tab');
  });

  it('opens simple mode with the project selected', async () => {
    renderAt('?screen=simple');

    // The sidebar header names the project, which only renders once one is selected.
    expect(await screen.findByText(project.name)).toBeInTheDocument();
  });

  it('falls back to the saved mode, not to a broken screen, when the link names nothing real', async () => {
    renderAt('?screen=nowhere');

    // Saved mode is `simple` and nothing is selected, so the board is what shows.
    expect(await screen.findByText('لوحة المشاريع')).toBeInTheDocument();
  });
});
