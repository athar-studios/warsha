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
  HandoffApplySummary,
  ProjectId,
  ProjectSummary,
  Role,
  RunArtifact,
  RunId,
  RunStreamSync,
  RunSummary,
  Stage,
  WarshaEvent,
} from '@warsha/client';
import { LocaleProvider, type Locale } from '@warsha/i18n';
import React from 'react';
import { MemoryRouter, BrowserRouter } from 'react-router-dom';

import App from './App';
import {
  GATE_STAGES,
  type BenchApi,
  type DeviceInfo,
  type EventStreamOpenOptions,
  type EventStreamOpener,
} from './bench';
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
 * The answer a current `warshad` really gives: all four gate stages, and every one the run has no entry
 * for coming back `pending` — `gates.list` maps `Stage::all()` filtered to gates over
 * `run.gate_states.get(stage).unwrap_or_default()` (`crates/warshad/src/lib.rs`, `list_gates`).
 *
 * This is the shape the parked reading exists for, and the reason the fixture set needed it: `answeredGates`
 * hand-decides the neighbours of the parked stage, so a queue built from it cannot tell "the gate the run is
 * stopped at" apart from "every gate that is pending". Handed `RUN` — parked at `gate_b` — this answers with
 * one parked gate and three the run has not reached, which is what the phone must render as one lit plate
 * and three names.
 */
export function servedGateQueue(): GateSummary[] {
  return GATE_STAGES.map((stage) => gate(stage, { state: 'pending' })) as GateSummary[];
}

/**
 * A run parked at the *first* gate, with the four-stage queue a serving daemon answers for it.
 *
 * The state fixture the visual matrix was missing: `RUN` is parked at `gate_b`, and the phone's own default
 * reading takes the newest run of the newest project, so nothing in the baseline set showed a parked gate at
 * all (`bridge-io/audit/critique-round-3-states.md` §G1a). `PARKED_RUN` + `servedGateQueue()` is that state,
 * and it is the same daemon shape as the e2e `parked` scenario (`apps/desktop/e2e/harness.ts`), down to the
 * `awaiting_gate` status `warshad` gives a run stopped at a gate — a word the phone shows as machine data
 * rather than guessing at (`labels.ts:runStatusWord`).
 */
export const PARKED_RUN: RunSummary = {
  ...RUN,
  id: runId('run_5b0e9aa1'),
  stage: 'gate_a',
  status: 'awaiting_gate',
};

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

/**
 * A sequenced frame: the same event with the daemon-wide `seq` the `/events` transport carries.
 * A test that wants cursor behaviour (reconnect replay, gap rebuild) emits these.
 */
export function seqEvent(seq: number, overrides: Partial<WarshaEvent> = {}): WarshaEvent {
  return event({ id: `evt_seq_${seq}`, seq, ...overrides });
}

/** The documents the run's stages produced, as `runs.artifacts` answers them. */
export const ARTIFACTS: RunArtifact[] = [
  {
    name: 'prd.md',
    content: '# PRD\nthe product document this run wrote',
    stage: 'prd_spec',
    role: 'pm',
    created_at: '2026-11-02T09:00:00.000Z',
    updated_at: '2026-11-02T09:30:00.000Z',
    version: 1,
  },
  {
    name: 'plan.md',
    content: '# Plan\nthe task list this run planned',
    stage: 'plan_tasks',
    role: 'pm',
    created_at: '2026-11-02T09:40:00.000Z',
    updated_at: '2026-11-02T09:50:00.000Z',
    version: 2,
  },
];

/** Devices paired to the daemon, as `devices.list` answers them: the owner's desktop and one phone. */
export const DEVICES: DeviceInfo[] = [
  {
    id: 'device-desktop' as DeviceId,
    name: 'Surface',
    pairedAt: '2026-11-01T09:00:00.000Z',
    lastSeen: '2026-11-02T10:00:00.000Z',
  },
  {
    id: 'device-phone-b' as DeviceId,
    name: 'Pixel',
    pairedAt: '2026-11-01T12:00:00.000Z',
    lastSeen: '2026-11-02T08:30:00.000Z',
  },
];

/** What `handoff.apply` answers when a bundle lands clean. */
export const HANDOFF_SUMMARY: HandoffApplySummary = {
  applied: ['prd.md', 'plan.md'],
  conflicts: [],
  backups: [],
  resolved: [],
};

/** The P0/P1 capability methods, spelled out once so `fullApi` and a case can each name them. */
function capabilityDefaults(call: (name: string) => void): Partial<BenchApi> {
  return {
    createProject: (name, _description) => {
      call('createProject');
      return Promise.resolve({ ...PROJECT, id: projectId('prj_new001'), name });
    },
    startRun: (ownerId, _idea) => {
      call('startRun');
      return Promise.resolve({
        ...RUN,
        id: runId('run_new001'),
        projectId: ownerId,
        stage: 'idea' as Stage,
        status: 'running',
      });
    },
    advanceRun: (id) => {
      call('advanceRun');
      return Promise.resolve({ ...RUN, id, stage: 'research' as Stage });
    },
    cancelRun: (id) => {
      call('cancelRun');
      return Promise.resolve({ ...RUN, id, status: 'cancelled' });
    },
    followupRun: (id, _prompt) => {
      call('followupRun');
      return Promise.resolve({ ...RUN, id });
    },
    getRunArtifacts: (_id) => {
      call('getRunArtifacts');
      return Promise.resolve(ARTIFACTS);
    },
    subscribeRun: (_runId, sinceSeq) => {
      call('subscribeRun');
      const sync: RunStreamSync = {
        seq: 12,
        gap_detected: false,
        resync_required: false,
        dropped_count: 0,
        run: RUN,
        events: [seqEvent(11), seqEvent(12)],
      };
      // The cursor the bench asked to resume from is part of the answer's honesty in tests too.
      return Promise.resolve(sinceSeq === undefined ? sync : { ...sync, events: sync.events.filter((e) => (e.seq ?? 0) > sinceSeq) });
    },
    createHandoff: (_id, _files) => {
      call('createHandoff');
      return Promise.resolve('/srv/warsha/handoff/handoff.zip');
    },
    applyHandoff: (_path, _ownerWins) => {
      call('applyHandoff');
      return Promise.resolve(HANDOFF_SUMMARY);
    },
    listDevices: () => {
      call('listDevices');
      return Promise.resolve(DEVICES);
    },
    revokeDevice: (_deviceId) => {
      call('revokeDevice');
      return Promise.resolve();
    },
  };
}

/**
 * The RPC surface with the daemon's real defaults, and one seam per case.
 *
 * By default it answers **only** the ten methods the bench has always called: the P0/P1 capability
 * panels must stay hidden against it, which is exactly what the capability-gating tests assert.
 * `fullApi` below is the same stub with the capability methods answered too.
 */
export function stubApi(overrides: Partial<BenchApi> = {}, capabilities = false): BenchApi {
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
    // The optional P0/P1 surface is only there when the case asked for the full daemon.
    ...(capabilities ? capabilityDefaults(call) : {}),
    ...overrides,
  };

  return Object.assign(api, { calls });
}

/** The same stub with the capability methods answered: a daemon that serves the P0/P1 surface. */
export function fullApi(overrides: Partial<BenchApi> = {}): BenchApi {
  return stubApi(overrides, true);
}

/** The RPC names a stub answered — so a test asserts the write happened rather than that a colour changed. */
export function callsOf(api: BenchApi): string[] {
  return (api as BenchApi & { calls: string[] }).calls;
}

/** One recorded open: what the bench asked the feed to resume from, and on which run. */
export interface StreamOpenRecord {
  url: string;
  sinceSeq: number | undefined;
  runId: RunId | undefined;
}

/** A feed a test can push into, fail, announce loss on, and count the closes of. */
export function fakeStream(): {
  opener: EventStreamOpener;
  emit: (event: WarshaEvent) => void;
  fail: (message?: string) => void;
  /** The stream announces lost frames (what the client calls `onGap` with). */
  gap: (info?: { droppedCount: number; seq: number }) => void;
  /** The stream says it cannot resume from this cursor (what the client calls `onResyncRequired` with). */
  resync: (info?: { seq: number }) => void;
  closes: () => number;
  urls: string[];
  opens: StreamOpenRecord[];
} {
  const sinks: EventStreamOpenOptions[] = [];
  const urls: string[] = [];
  const opens: StreamOpenRecord[] = [];
  let closes = 0;

  return {
    opener: (options) => {
      urls.push(options.url);
      opens.push({ url: options.url, sinceSeq: options.sinceSeq, runId: options.runId });
      sinks.push(options);
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
    gap: (info = { droppedCount: 3, seq: 10 }) => {
      act(() => {
        for (const sink of sinks) sink.onGap?.(info);
      });
    },
    resync: (info = { seq: 10 }) => {
      act(() => {
        for (const sink of sinks) sink.onResyncRequired?.(info);
      });
    },
    closes: () => closes,
    urls,
    opens,
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
