// @warsha/remote — the bench's one data surface: the session this device holds, and what the daemon
// answers through it.
//
// The phone has exactly one job (docs/design/REDESIGN.md §2's "mobile checker"): *is anything waiting on
// me, and can I decide it in under ten seconds*. Everything here serves that, and it is written against
// the client rather than around it — `@warsha/client` owns the RPC and the event stream, and R5
// (`docs/ARCH_RULES.md`) keeps a screen from opening its own socket.
//
// Four of the direction's rules become code here:
//
//   * **a reading the daemon has not made is said, not invented** (§7). Every list carries its own
//     `LoadState`, an unread budget stays `null` (never `$0.00`), and a refused `gates.list` falls back
//     to the one reading the daemon *does* answer — the run's own stage — with that fallback named on
//     screen (`remote.queue_source_stage`) so the owner knows how much to trust the queue.
//   * **a decision leaves a record.** The queue only stops showing a gate when the daemon took the
//     decision, and the local record is what lets the stamp render on a device whose `gates.list` is
//     refused. A failure keeps the card, the note and the actions exactly where they were (§7: "a failed
//     gate RPC keeps the card and shows the error inline").
//   * **the queue survives a dropped feed** (§7: "work already queued is never implied lost"). A stream
//     error moves `streamState` to `closed` and says so; nothing is cleared and nothing is re-sent.
//   * **the token never reaches a message.** Every daemon failure goes through `safeMessage` before it
//     can be rendered, because the token is in the address the RPC aimed at.

import {
  type BudgetStatus,
  type DeviceId,
  type EventSubscription,
  type GateState,
  type GateSummary,
  type ProjectId,
  type ProjectSummary,
  type RunId,
  type RunSummary,
  type Stage,
  type WarshaEvent,
  createClient,
  subscribeEvents,
} from '@warsha/client';
import { useLocale, type Locale } from '@warsha/i18n';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { eventStreamUrl, safeMessage, type DaemonSession, type PairingFailure } from './session';

/** What a list the bench reads can be doing. §7: each of these has its own words on screen. */
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

/** Whether this device holds a session, and whether anything answered it. */
export type ConnectionState = 'unpaired' | 'checking' | 'online' | 'offline';

/** The event feed: not opened, open, or closed on the owner. */
export type StreamState = 'idle' | 'open' | 'closed';

/** Who said a gate is where it is: the gates list, the run's stage, or this device's own hand. */
export type GateSource = 'daemon' | 'stage' | 'device';

/** One row of the owner's queue. */
export interface BenchGate {
  stage: Stage;
  state: GateState;
  source: GateSource;
}

/** The moves the gate state machine answers to (`GateCard`'s own names). */
export type GateDecision = 'approve' | 'reject' | 'changes_requested';

/** The state of the decision this device just tried to record. */
export interface DecisionState {
  stage: Stage | null;
  status: 'idle' | 'saving' | 'done' | 'failed';
  /** The daemon's own words when a write was refused: machine evidence, never UI copy. */
  detail: string | null;
}

/**
 * The slice of `WarshaClient` the remote bench calls.
 *
 * A subset rather than the class, because `WarshaClient` satisfies it structurally while a test hands in
 * only the methods the case exercises. Every shape still comes from `@warsha/client`, so a wire type
 * cannot drift from what the screen renders.
 */
export interface BenchApi {
  health(): Promise<{ status: string; version: string }>;
  listProjects(): Promise<ProjectSummary[]>;
  listRuns(projectId: ProjectId): Promise<RunSummary[]>;
  getRunStatus(id: RunId): Promise<RunSummary>;
  getGates(runId: RunId): Promise<GateSummary[]>;
  getRunLogs(id: RunId): Promise<string[]>;
  getProjectBudget(projectId: ProjectId): Promise<BudgetStatus>;
  approveGate(runId: RunId, stage: Stage): Promise<void>;
  rejectGate(runId: RunId, stage: Stage, reason: string): Promise<void>;
  requestChanges(runId: RunId, stage: Stage, notes: string): Promise<void>;
}

/** How the `/events` feed is opened. The app hands in `subscribeEvents`; a test hands in a recorder. */
export type EventStreamOpener = (options: {
  url: string;
  token: string;
  onEvent: (event: WarshaEvent) => void;
  onError: (error: Error) => void;
}) => EventSubscription;

/** The stages that are gates, in pipeline order — the queue the phone is built to answer. */
export const GATE_STAGES: readonly Stage[] = ['gate_a', 'gate_b', 'gate_c', 'gate_d'];

/** The label this device's own records carry. The daemon records the authenticated session, never this. */
const ACTING_DEVICE = 'device-remote' as DeviceId;

/** A daemon refusal, in the text the owner may be shown (after `safeMessage` redacts the token). */
function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The most recently touched row of a list the daemon ordered by nothing at all. */
function newestBy<T>(rows: readonly T[], updatedAt: (row: T) => string): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => updatedAt(right).localeCompare(updatedAt(left)))[0] ?? null;
}

/**
 * The queue a refused `gates.list` still allows.
 *
 * A run parked at `gate_b` is a run stopped pending the owner's decision — that is the pipeline's own
 * state, read from `runs.list`, and it is enough to answer "is anything waiting on me". Decisions this
 * device recorded are layered on top, so the queue goes quiet the moment the owner acts.
 */
export function stageQueue(run: RunSummary | null, local: Readonly<Record<string, GateState>>): BenchGate[] {
  if (run === null) return [];
  const rows: BenchGate[] = [];
  for (const stage of GATE_STAGES) {
    const recorded = local[stage as string];
    if (recorded !== undefined) {
      rows.push({ stage, state: recorded, source: 'device' });
    } else if (stage === run.stage) {
      rows.push({ stage, state: { state: 'pending' }, source: 'stage' });
    }
  }
  return rows;
}

/** The note a refusal carries. `GateCard` will not send an empty one, so this is a narrowing, not a default. */
function noteText(note: string | undefined): string {
  return note ?? '';
}

export interface RemoteProviderProps {
  children: React.ReactNode;
  /** The session this device holds, or `null` until the owner pairs. */
  session: DaemonSession | null;
  /** Offer a pairing link; the owner of the session state answers whether it was accepted. */
  onPair: (link: string) => PairingFailure | null;
  /** End this device's session. */
  onUnpair: () => void;
  /** The run the URL asked for, honoured as soon as the project's runs have answered. */
  initialRunId?: RunId | null;
  /** The project the URL asked for: a deep link is a reading the owner already chose. */
  initialProjectId?: ProjectId | null;
  /** Override the RPC surface (a test hands in a recorder). */
  api?: BenchApi | null;
  /** Override the event feed (a test hands in a recorder). */
  openEvents?: EventStreamOpener;
}

export interface RemoteContextValue {
  session: DaemonSession | null;
  connection: ConnectionState;
  daemonVersion: string | null;
  pair: (link: string) => PairingFailure | null;
  unpair: () => void;

  projects: ProjectSummary[];
  projectsState: LoadState;
  projectId: ProjectId | null;
  project: ProjectSummary | null;
  setProjectId: (id: ProjectId) => void;

  runs: RunSummary[];
  runsState: LoadState;
  run: RunSummary | null;
  setRunId: (id: RunId) => void;

  /** Everything the bench believes about this run's gates, in pipeline order. */
  gates: BenchGate[];
  pendingGates: BenchGate[];
  /** The one gate the phone puts under the owner's thumb: the oldest still waiting. */
  topPendingGate: BenchGate | null;
  gatesState: LoadState;
  gatesSource: GateSource | null;

  budget: BudgetStatus | null;
  budgetState: LoadState;
  logs: string[];
  logsState: LoadState;
  events: WarshaEvent[];
  streamState: StreamState;
  reconnectStream: () => void;

  decision: DecisionState;
  decide: (stage: Stage, next: GateDecision, note?: string) => void;

  /** Read the bench again — the banner's `Retry now` (§7). */
  reloadAll: () => void;
  /** Read the queue again, on its own. */
  reloadGates: () => void;

  /** The locale the machine readings are formatted for. */
  locale: Locale;
}

const RemoteContext = createContext<RemoteContextValue | null>(null);

/** Every screen under this provider reads the same session, the same lists and the same queue. */
export function RemoteProvider({
  children,
  session,
  onPair,
  onUnpair,
  initialRunId = null,
  initialProjectId = null,
  api: apiOverride,
  openEvents = subscribeEvents,
}: RemoteProviderProps) {
  const locale = useLocale();

  const api = useMemo<BenchApi | null>(
    () => (apiOverride !== undefined ? apiOverride : session === null ? null : createClient(session.baseUrl, session.token)),
    [apiOverride, session]
  );

  const [connection, setConnection] = useState<ConnectionState>(session === null ? 'unpaired' : 'checking');
  const [daemonVersion, setDaemonVersion] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsState, setProjectsState] = useState<LoadState>('idle');
  const [projectId, setProjectIdState] = useState<ProjectId | null>(initialProjectId);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsState, setRunsState] = useState<LoadState>('idle');
  const [runId, setRunIdState] = useState<RunId | null>(initialRunId);

  const [gates, setGates] = useState<BenchGate[] | null>(null);
  const [gatesState, setGatesState] = useState<LoadState>('idle');
  const [gatesSource, setGatesSource] = useState<GateSource | null>(null);
  const [localDecisions, setLocalDecisions] = useState<Record<string, GateState>>({});

  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [budgetState, setBudgetState] = useState<LoadState>('idle');

  const [logs, setLogs] = useState<string[]>([]);
  const [logsState, setLogsState] = useState<LoadState>('idle');

  const [events, setEvents] = useState<WarshaEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [streamNonce, setStreamNonce] = useState(0);

  const [decision, setDecision] = useState<DecisionState>({ stage: null, status: 'idle', detail: null });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [gatesNonce, setGatesNonce] = useState(0);

  /** The run the URL asked for, kept until the project's runs have answered. */
  const pendingRunId = useRef<RunId | null>(initialRunId);

  // ---------------------------------------------------------------- the daemon's one health reading
  useEffect(() => {
    if (api === null) {
      setConnection('unpaired');
      setDaemonVersion(null);
      return undefined;
    }
    let cancelled = false;
    setConnection('checking');
    api
      .health()
      .then((answer) => {
        if (cancelled) return;
        setConnection('online');
        setDaemonVersion(answer.version);
      })
      .catch(() => {
        if (cancelled) return;
        // The bench is not broken; it has no live data. That difference is the banner's job (§7).
        setConnection('offline');
        setDaemonVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, reloadNonce]);

  // ----------------------------------------------------------------------------------- the projects
  useEffect(() => {
    if (api === null) {
      setProjects([]);
      setProjectsState('idle');
      return undefined;
    }
    let cancelled = false;
    setProjectsState('loading');
    api
      .listProjects()
      .then((answer) => {
        if (cancelled) return;
        setProjects(answer);
        setProjectsState('ready');
        setProjectIdState((current) => {
          if (current !== null && answer.some((project) => project.id === current)) return current;
          return newestBy(answer, (row) => row.updatedAt)?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setProjectsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, reloadNonce]);

  // --------------------------------------------------------------------------------------- the runs
  useEffect(() => {
    if (api === null || projectId === null) {
      setRuns([]);
      setRunsState('idle');
      setRunIdState(null);
      return undefined;
    }
    let cancelled = false;
    setRunsState('loading');
    api
      .listRuns(projectId)
      .then((answer) => {
        if (cancelled) return;
        setRuns(answer);
        setRunsState('ready');
        setRunIdState((current) => {
          if (current !== null && answer.some((candidate) => candidate.id === current)) return current;
          const wanted = pendingRunId.current;
          if (wanted !== null && answer.some((candidate) => candidate.id === wanted)) {
            pendingRunId.current = null;
            return wanted;
          }
          return newestBy(answer, (row) => row.updatedAt)?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRunsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, reloadNonce]);

  // A fresh project is a fresh run: what the previous project streamed is not this one's evidence, and a
  // decision recorded there is not a reading here (§7).
  const setProjectId = useCallback((next: ProjectId) => {
    setProjectIdState(next);
    setRunIdState(null);
    setEvents([]);
    setLocalDecisions({});
    setDecision({ stage: null, status: 'idle', detail: null });
  }, []);

  const setRunId = useCallback((next: RunId) => {
    pendingRunId.current = null;
    setRunIdState(next);
    setEvents([]);
    setLocalDecisions({});
    setDecision({ stage: null, status: 'idle', detail: null });
  }, []);

  const run = useMemo(
    () => (runId === null ? null : runs.find((candidate) => candidate.id === runId) ?? null),
    [runId, runs]
  );

  const project = useMemo(
    () => (projectId === null ? null : projects.find((candidate) => candidate.id === projectId) ?? null),
    [projectId, projects]
  );

  // ------------------------------------------------------------------------- gates, budget and the log
  useEffect(() => {
    if (api === null || run === null) {
      setGates(null);
      setGatesState('idle');
      setGatesSource(null);
      return undefined;
    }
    // A stale answer must not paint the queue of a run the owner already left behind, so each read is
    // cancelled when its run, project or retry changes under it.
    let cancelled = false;
    setGatesState('loading');
    api
      .getGates(run.id)
      .then((answer) => {
        if (cancelled) return;
        setGates(
          answer.map((row) => {
            const recorded = localDecisions[row.stage as string];
            return recorded === undefined
              ? { stage: row.stage, state: row.state, source: 'daemon' as const }
              : { stage: row.stage, state: recorded, source: 'device' as const };
          })
        );
        setGatesSource('daemon');
        setGatesState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        // `gates.list` is not a method `warshad` serves (see the note on `WarshaClient.getGates`): the
        // queue a phone can still build is the run's own stage plus this device's records. The screen
        // says which reading it is showing.
        setGates(stageQueue(run, localDecisions));
        setGatesSource('stage');
        setGatesState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, localDecisions, run, gatesNonce]);

  useEffect(() => {
    if (api === null || projectId === null) {
      setBudget(null);
      setBudgetState('idle');
      return undefined;
    }
    let cancelled = false;
    setBudgetState('loading');
    api
      .getProjectBudget(projectId)
      .then((answer) => {
        if (cancelled) return;
        setBudget(answer);
        setBudgetState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        // A budget the daemon did not answer is no budget at all — `$0.00` would claim "free" (§7).
        setBudget(null);
        setBudgetState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, reloadNonce]);

  useEffect(() => {
    if (api === null || run === null) {
      setLogs([]);
      setLogsState('idle');
      return undefined;
    }
    let cancelled = false;
    setLogsState('loading');
    api
      .getRunLogs(run.id)
      .then((answer) => {
        if (cancelled) return;
        setLogs(answer);
        setLogsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setLogsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, run, reloadNonce]);

  // -------------------------------------------------------------------------------- the live feed
  useEffect(() => {
    if (session === null || run === null) {
      setStreamState('idle');
      return undefined;
    }
    setStreamState('idle');
    const subscription = openEvents({
      url: eventStreamUrl(session.baseUrl),
      token: session.token,
      onEvent: (event) => {
        setStreamState('open');
        // A 500-line ceiling: the phone is a glance surface, and an unbounded feed is a leak on the
        // least capable device in the house.
        setEvents((previous) => [...previous, event].slice(-500));
      },
      onError: () => {
        // The feed is down; the queue is not (§7). Nothing here is cleared.
        setStreamState('closed');
      },
    });
    return () => {
      subscription.close();
    };
  }, [openEvents, run, session, streamNonce]);

  const reconnectStream = useCallback(() => setStreamNonce((nonce) => nonce + 1), []);

  // ------------------------------------------------------------------------------------ the decision
  const decide = useCallback(
    (stage: Stage, next: GateDecision, note?: string) => {
      if (api === null || run === null) return;
      setDecision({ stage, status: 'saving', detail: null });

      const write = (): Promise<void> => {
        if (next === 'approve') return api.approveGate(run.id, stage);
        if (next === 'reject') return api.rejectGate(run.id, stage, noteText(note));
        return api.requestChanges(run.id, stage, noteText(note));
      };

      void write()
        .then(() => {
          const at = new Date().toISOString();
          const state: GateState =
            next === 'approve'
              ? { state: 'approved', by: ACTING_DEVICE, at }
              : next === 'reject'
                ? { state: 'rejected', reason: noteText(note), by: ACTING_DEVICE, at }
                : { state: 'changes_requested', notes: noteText(note), by: ACTING_DEVICE, at };

          setLocalDecisions((previous) => ({ ...previous, [stage as string]: state }));
          setDecision({ stage, status: 'done', detail: null });
          setGatesNonce((nonce) => nonce + 1);

          // The run moves when a gate clears, and the stage is the reading the queue is built from.
          api
            .getRunStatus(run.id)
            .then((answer) => setRuns((previous) => previous.map((row) => (row.id === answer.id ? answer : row))))
            .catch(() => {
              // A stage refresh that did not land is not a failed decision: the write already happened.
            });
        })
        .catch((error: unknown) => {
          // The card keeps its note and its actions (§7): the decision is unsent, not lost.
          setDecision({ stage, status: 'failed', detail: safeMessage(failureDetail(error), session) });
        });
    },
    [api, run, session]
  );

  const reloadAll = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);
  const reloadGates = useCallback(() => setGatesNonce((nonce) => nonce + 1), []);

  // -------------------------------------------------------------------------------------- the queue
  const queue = useMemo<BenchGate[]>(
    () => (gates !== null ? gates : stageQueue(run, localDecisions)),
    [gates, localDecisions, run]
  );

  const pendingGates = useMemo(() => queue.filter((gate) => gate.state.state === 'pending'), [queue]);

  const value = useMemo<RemoteContextValue>(
    () => ({
      session,
      connection,
      daemonVersion,
      pair: onPair,
      unpair: onUnpair,

      projects,
      projectsState,
      projectId,
      project,
      setProjectId,

      runs,
      runsState,
      run,
      setRunId,

      gates: queue,
      pendingGates,
      topPendingGate: pendingGates[0] ?? null,
      gatesState,
      gatesSource,

      budget,
      budgetState,
      logs,
      logsState,
      events,
      streamState,
      reconnectStream,

      decision,
      decide,

      reloadAll,
      reloadGates,
      locale,
    }),
    [
      budget,
      budgetState,
      connection,
      daemonVersion,
      decide,
      decision,
      events,
      gatesSource,
      gatesState,
      locale,
      logs,
      logsState,
      onPair,
      onUnpair,
      pendingGates,
      project,
      projectId,
      projects,
      projectsState,
      queue,
      reconnectStream,
      reloadAll,
      reloadGates,
      run,
      runs,
      runsState,
      session,
      setProjectId,
      setRunId,
      streamState,
    ]
  );

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
}

/** The bench, from the nearest `RemoteProvider`. */
export function useRemote(): RemoteContextValue {
  const context = useContext(RemoteContext);
  if (context === null) {
    throw new Error('useRemote must be used within RemoteProvider');
  }
  return context;
}
