// @warsha/remote — the fixtures the tests drive the bench with.
//
// Not a product module: nothing in `main.tsx`'s graph imports it, so it never reaches the bundle. It is a
// `.ts` rather than a `.test.ts` so the eight screens' tests can share one set of fixtures instead of
// each planting its own copy of a run.
//
// The defaults are the *real* daemon's behavior as `@warsha/client` documents it: `gates.list` is served
// from the run's gate states (DECISIONS.md 2026-11-03), so the default stub answers it with the queue of
// the run it is asked about — `gatesForRun(runId)`. A case that wants the older daemon's refusal passes
// `refuseGates()`, and a case that wants a fuller queue passes `answeredGates()`.
import { act, render } from '@testing-library/react';
import type {
  BudgetStatus,
  DeviceId,
  GateState,
  GateSummary,
  ProjectId,
  ProjectSummary,
  Role,
  RunId,
  RunSummary,
  Stage,
  WarshaEvent,
} from '@warsha/client';
import { LocaleProvider, type Locale } from '@warsha/i18n';
import React from 'react';
import { MemoryRouter, BrowserRouter } from 'react-router-dom';

import App from './App';
import { GATE_STAGES, type BenchApi, type EventStreamOpener } from './bench';
import type { DaemonSession } from './session';
import type { ThemePreference } from './theme';

/** A branded id from a literal: the narrowing tests use, and the only place it happens outside the client. */
export const projectId = (value: string): ProjectId => value as ProjectId;
export const runId = (value: string): RunId => value as RunId;

export const PROJECT: ProjectSummary = {
  id: projectId('prj_9f3a2b7c'),
  name: 'متجر ورشة',
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

export const RUN: RunSummary = {
  id: runId('run_4c10be57'),
  projectId: PROJECT.id,
  stage: 'gate_b',
  status: 'running',
  startedAt: '2026-11-02T08:00:00.000Z',
  updatedAt: '2026-11-02T10:04:00.000Z',
};

/** A second run, so a ledger with two rows is a thing a test can actually assert on. */
export const RUN_OLD: RunSummary = {
  ...RUN,
  id: runId('run_11aa22bb'),
  stage: 'code',
  status: 'failed',
  updatedAt: '2026-11-01T18:00:00.000Z',
};

export const BUDGET: BudgetStatus = { totalBudgetUsd: 20, spentUsd: 4.2, remainingUsd: 15.8 };

/** The session a paired phone holds. The token is deliberately distinctive: a test asserts it is redacted. */
export const SESSION = { baseUrl: 'http://127.0.0.1:8766', token: 'sekrit-token-abcdef' };

export function gate(stage: Stage, state: GateState): GateSummary {
  return { stage, state };
}

/** A decided gate, as the daemon records it: the acting device and the instant are part of the record. */
export function decided(stage: Stage, decision: 'approved' | 'rejected', at = '2026-11-02T10:00:00.000Z'): GateState {
  const by = 'device-desktop' as DeviceId;
  return decision === 'approved'
    ? { state: 'approved', by, at }
    : { state: 'rejected', reason: 'السبب', by, at };
}

/**
 * The queue a serving `warshad` answers with for one run, built the way the daemon builds it: from the
 * run's own standing. A run parked at a gate has that gate pending and nothing else invented; a run
 * parked past its gates (or before them) has nothing waiting. This is the default `getGates` answer, so
 * a case that selects a different run is served *that* run's queue — the old fixture answered `RUN`'s
 * gate for whichever run id it was handed, which let a screen pass on a gate of a run it was not showing.
 * A run this file does not know answers empty: the stub invents a queue for no one.
 */
export function gatesForRun(id: RunId): GateSummary[] {
  const run = [RUN, RUN_OLD].find((candidate) => candidate.id === id);
  if (run === undefined || !GATE_STAGES.includes(run.stage)) return [];
  return [gate(run.stage, { state: 'pending' })];
}

/** The queue of the default fixture run, named for the cases that spell it out. */
export const DEFAULT_GATES: GateSummary[] = gatesForRun(RUN.id);

/**
 * A fuller answer, for a case that wants to see a queue with more than one row: the first gate decided,
 * the run parked at the second, the later two still waiting. Same principle as `gatesForRun` — the gates
 * listed are ones this run has reached, and `RUN` is parked at `gate_b`.
 */
export function answeredGates(): GateSummary[] {
  return [
    gate('gate_a', decided('gate_a', 'approved')),
    gate('gate_b', { state: 'pending' }),
    gate('gate_c', { state: 'pending' }),
    gate('gate_d', { state: 'pending' }),
  ] as GateSummary[];
}

/**
 * The refusal a phone meets against a daemon that does not serve `gates.list`. A case that wants to
 * be shown the stage fallback passes this; it is no longer the default, because `warshad` answers
 * the name now (DECISIONS.md 2026-11-03).
 */
export function refuseGates(): () => Promise<GateSummary[]> {
  return () => Promise.reject(new Error('Method not found: gates.list'));
}

export function event(overrides: Partial<WarshaEvent> = {}): WarshaEvent {
  return {
    id: 'evt_1',
    runId: RUN.id,
    stage: 'gate_b',
    role: 'coder' as Role,
    kind: 'stage_started',
    payload: null,
    costCents: null,
    createdAt: '2026-11-02T10:00:00.000Z',
    deviceId: null,
    ...overrides,
  };
}

/** The RPC surface with the daemon's real defaults, and one seam per case. */
export function stubApi(overrides: Partial<BenchApi> = {}): BenchApi {
  const calls: string[] = [];
  /** Name the write or the read the test is asserting on. */
  const call = (name: string): void => {
    calls.push(name);
  };

  const api: BenchApi = {
    health: () => {
      call('health');
      return Promise.resolve({ status: 'ok', version: '0.2.0' });
    },
    listProjects: () => {
      call('listProjects');
      return Promise.resolve([PROJECT]);
    },
    listRuns: () => {
      call('listRuns');
      return Promise.resolve([RUN, RUN_OLD]);
    },
    getRunStatus: () => {
      call('getRunStatus');
      return Promise.resolve(RUN);
    },
    // `gates.list` is a method `warshad` now serves (DECISIONS.md 2026-11-03), so the default answers —
    // and it answers for the run it was asked about (`gatesForRun`), not for the fixture's first run.
    // A case that wants the older daemon's refusal passes `refuseGates()`, and a case that wants a
    // fuller queue passes `answeredGates()`, defined in this file above.
    getGates: (requestedRunId) => {
      call('getGates');
      return Promise.resolve(gatesForRun(requestedRunId));
    },
    getRunLogs: () => {
      call('getRunLogs');
      return Promise.resolve(['cargo test', '14 passed']);
    },
    getProjectBudget: () => {
      call('getProjectBudget');
      return Promise.resolve(BUDGET);
    },
    approveGate: (_runId, stage) => {
      call(`approve:${stage}`);
      return Promise.resolve();
    },
    rejectGate: (_runId, stage) => {
      call(`reject:${stage}`);
      return Promise.resolve();
    },
    requestChanges: (_runId, stage) => {
      call(`changes:${stage}`);
      return Promise.resolve();
    },
    ...overrides,
  };

  return Object.assign(api, { calls });
}

/** The RPC names a stub answered — so a test asserts the write happened rather than that a colour changed. */
export function callsOf(api: BenchApi): string[] {
  return (api as BenchApi & { calls: string[] }).calls;
}

/** A feed a test can push into, fail, and count the closes of. */
export function fakeStream(): {
  opener: EventStreamOpener;
  emit: (event: WarshaEvent) => void;
  fail: (message?: string) => void;
  closes: () => number;
  urls: string[];
} {
  const sinks: { onEvent: (event: WarshaEvent) => void; onError: (error: Error) => void }[] = [];
  const urls: string[] = [];
  let closes = 0;

  return {
    opener: ({ url, onEvent, onError }) => {
      urls.push(url);
      sinks.push({ onEvent, onError });
      return {
        close: () => {
          closes += 1;
        },
      };
    },
    // A frame that arrives from the socket is an update React must see inside `act`, or the test that
    // asserted on it would be asserting on a render that had not happened yet.
    emit: (next) => {
      act(() => {
        for (const sink of sinks) sink.onEvent(next);
      });
    },
    fail: (message = 'Event stream connection error') => {
      act(() => {
        for (const sink of sinks) sink.onError(new Error(message));
      });
    },
    closes: () => closes,
    urls,
  };
}

/** A `Storage` stand-in, so a test never depends on what the previous one left in jsdom. */
export function memoryStore(initial: Record<string, string> = {}): {
  values: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    },
  };
}

export interface RemoteRenderOptions {
  /** The route to open, so a test can reach a screen without walking the nav. */
  route?: string;
  /** The locale the app starts in. Arabic is the product's default. */
  locale?: Locale;
  /** `browser` mounts the router a real PWA uses, so a test can read and write the address bar. */
  router?: 'memory' | 'browser';
  /** The owner's stored theme choice. */
  theme?: ThemePreference;
  /** `null` starts the bench unpaired; a session object starts it paired. */
  session?: DaemonSession | null;
  api?: BenchApi;
  stream?: EventStreamOpener;
}

/** What a rendered bench gave the test: the RPC recorder, the feed, and the stores it wrote into. */
export interface RemoteRenderResult {
  api: BenchApi;
  calls: string[];
  localeStore: ReturnType<typeof memoryStore>;
  themeStore: ReturnType<typeof memoryStore>;
  sessionStore: ReturnType<typeof memoryStore>;
}

/**
 * Render the whole app — locale provider, theme provider, router, shell — the way `main.tsx` does.
 *
 * Every screen is rendered through the real shell rather than in isolation: the instrument strip, the
 * navigation and the queue read the same provider, and a test that mounted a screen alone would miss the
 * one thing the redesign is about (that a lamp in the strip and a lamp in the card say the same thing).
 */
export function renderRemote(options: RemoteRenderOptions = {}): RemoteRenderResult {
  const api = options.api ?? stubApi();
  const localeStore = memoryStore();
  const themeStore = memoryStore(options.theme ? { 'warsha.theme': options.theme } : {});
  const sessionStore = memoryStore();

  const app = (
    <App
      initialSession={options.session === undefined ? null : options.session}
      store={sessionStore}
      themeStore={themeStore}
      api={api}
      openEvents={options.stream}
    />
  );

  // `browser` is the router the deployed PWA uses; `memory` keeps a screen test off the address bar.
  const routed =
    options.router === 'browser' ? (
      <BrowserRouter>{app}</BrowserRouter>
    ) : (
      <MemoryRouter initialEntries={[options.route ?? '/']}>{app}</MemoryRouter>
    );

  render(
    <LocaleProvider initialLocale={options.locale ?? 'ar'} storage={localeStore}>
      {routed}
    </LocaleProvider>
  );

  return { api, calls: callsOf(api), localeStore, themeStore, sessionStore };
}

/**
 * Let the reads a render started land before an assertion runs.
 *
 * The bench's lists are promises the provider chains on promises; a `setTimeout` turn drains that whole
 * microtask queue, and doing it inside `act` is what keeps React from warning about an update that
 * arrived outside a test's own scope.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}
