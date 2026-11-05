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
  type DeviceSummary,
  type EventSubscription,
  type GateState,
  type GateSummary,
  type HandoffApplySummary,
  type ProjectId,
  type ProjectSummary,
  type RunArtifact,
  type RunId,
  type RunStreamSync,
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
 * The paired-device row the bench lists.
 *
 * `@warsha/client` names this shape `DeviceSummary`; the bench's surface keeps the shorter name the
 * screens were written against, and the alias means the wire type cannot drift from the client's.
 */
export type DeviceInfo = DeviceSummary;

/**
 * The slice of `WarshaClient` the remote bench calls.
 *
 * A subset rather than the class, because `WarshaClient` satisfies it structurally while a test hands in
 * only the methods the case exercises. Every shape still comes from `@warsha/client`, so a wire type
 * cannot drift from what the screen renders.
 *
 * The first ten methods are the parity the bench has always had, and they stay required. The rest are
 * **optional**: the P0/P1 run-control surface (create, start, advance, cancel, follow up, artifacts,
 * resync, handoff, devices) is capability-gated, so a daemon — or a test stub — that does not answer a
 * name simply does not get a control on the screen. A `null` action in the context means "unsupported",
 * and screens render nothing for it rather than a disabled lie.
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

  createProject?(name: string, description: string, language: string): Promise<ProjectSummary>;
  startRun?(projectId: ProjectId, idea: string): Promise<RunSummary>;
  advanceRun?(runId: RunId): Promise<RunSummary>;
  cancelRun?(runId: RunId, reason?: string): Promise<RunSummary>;
  followupRun?(runId: RunId, prompt: string): Promise<RunSummary>;
  getRunArtifacts?(runId: RunId): Promise<RunArtifact[]>;
  subscribeRun?(runId?: RunId, sinceSeq?: number): Promise<RunStreamSync>;
  createHandoff?(runId: RunId, files: ReadonlyArray<readonly [string, string]>): Promise<string>;
  applyHandoff?(path: string, ownerWins: boolean): Promise<HandoffApplySummary>;
  listDevices?(): Promise<DeviceInfo[]>;
  revokeDevice?(deviceId: DeviceId): Promise<void>;
}

/** How the `/events` feed is opened. The app hands in `subscribeEvents`; a test hands in a recorder. */
export interface EventStreamOpenOptions {
  url: string;
  token: string;
  /** Replay cursor: every frame after the last `seq` this device saw, when it has seen one. */
  sinceSeq?: number;
  /** Narrow the stream to the run the owner is reading. */
  runId?: RunId;
  onEvent: (event: WarshaEvent) => void;
  onError: (error: Error) => void;
  /** The stream says frames went past unseen: rebuild from the cursor, do not pretend nothing fell. */
  onGap?: (info: { droppedCount: number; seq: number }) => void;
  /** The stream cannot resume from this cursor: same rebuild, announced reason. */
  onResyncRequired?: (info: { seq: number }) => void;
}

export type EventStreamOpener = (options: EventStreamOpenOptions) => EventSubscription;

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

/**
 * Is this gate the one the run is stopped at, right now, waiting on the owner's hand?
 *
 * One comparison, said once: `pending` **and** the stage the run stands on. The conjunction is the whole
 * rule, and `gates.list` made it necessary: `warshad` answers all four gate stages and defaults every one
 * of them to `pending` (`crates/warshad/src/lib.rs`, `list_gates` — `run.gate_states` … `unwrap_or_default()`),
 * so a row that is merely pending says only that nobody has decided it, which is true of three rows out of
 * four on any ordinary run. §1's "a lit lamp means this needs the owner's hand" is therefore about where the
 * run stands, not about the row's state, and a plate that ignores this comparison offers a decision the run
 * has not arrived at.
 *
 * That offer is not a hypothetical guard: the daemon takes it. `approve_gate` requires only that the gate is
 * pending (`crates/warsha-pipeline/src/lib.rs:620-642`) — it never compares the stage to `run.current_stage`
 * — so a pre-approval silently clears a gate before its work exists, and a pre-`reject` sets
 * `run.status = Paused` on a run that was nowhere near that gate. The UI is the only surface that can refuse
 * the claim, which is why this predicate decides whether a decision control is rendered at all.
 *
 * The desktop inbox keeps its own copy of the comparison (`apps/desktop/src/screens/GatesInbox.tsx`) because
 * an app may not import another app; both are pinned by the same truth table in their own test files, so the
 * two surfaces disagreeing is a failing test rather than a phone that lies.
 */
export function gateWaitsOnOwner(gate: Pick<BenchGate, 'stage' | 'state'>, runStage: Stage | null): boolean {
  return runStage !== null && gate.state.state === 'pending' && gate.stage === runStage;
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
  /**
   * The pending gate the run is stopped at, or `null` when no gate is.
   *
   * This, not `pendingGates`, is the queue §1 means by "waiting on the owner": a serving daemon reports four
   * pending stages for a run standing anywhere, and only one of them is the reason the run is not moving.
   */
  parkedGate: BenchGate | null;
  /** The one gate the phone puts under the owner's thumb: the parked one, else the oldest pending. */
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

  /** The last daemon sequence number this device saw; the cursor a reconnect resumes from. */
  lastSeq: number | null;

  /** The run's artifacts, read from `runs.artifacts` — `idle` on a daemon that does not serve it. */
  artifacts: RunArtifact[];
  artifactsState: LoadState;

  /** Devices paired to this daemon, read from `devices.list`. */
  devices: DeviceInfo[];
  devicesState: LoadState;

  /** The bundle path the last `handoff.create` wrote on the server, or `null`. */
  handoffPath: string | null;
  /** The summary the last `handoff.apply` answered with, or `null`. */
  handoffSummary: HandoffApplySummary | null;

  /** The daemon's own words when a run-control write was refused, token-redacted; `null` when clean. */
  actionError: string | null;
  /** Forget the action error, once the owner has read it. */
  clearActionError: () => void;

  // The P0/P1 run-control actions. Each is `null` when the daemon (or the stub) does not answer its
  // RPC name — capability gating, not a disabled control: the screen renders nothing it cannot honour.
  createNewProject: ((name: string, description: string) => Promise<void>) | null;
  startNewRun: ((idea: string) => Promise<void>) | null;
  advanceCurrentRun: (() => Promise<void>) | null;
  cancelCurrentRun: (() => Promise<void>) | null;
  sendFollowup: ((prompt: string) => Promise<void>) | null;
  triggerHandoff: (() => Promise<void>) | null;
  applyHandoffBundle: (() => Promise<void>) | null;
  revokePairedDevice: ((deviceId: DeviceId) => Promise<void>) | null;

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

  const api = useMemo<BenchApi | null>(() => {
    if (apiOverride !== undefined) return apiOverride;
    if (session === null) return null;
    const client = createClient(session.baseUrl, session.token);
    // The client spells revocation `removeDevice` (RPC `devices.revoke`); the bench surface — and the
    // screens built on it — call it by what it does. One adapter line, so the names cannot drift.
    return Object.assign(client, {
      revokeDevice: (deviceId: DeviceId): Promise<void> => client.removeDevice(deviceId),
    });
  }, [apiOverride, session]);

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

  // The sequence cursor. `lastSeq` is the rendering half (the strip and tests read it); `lastSeqRef`
  // is the half the socket is opened *from* — a ref, because putting the state into the stream
  // effect's dependencies would tear down and re-open the socket on every frame the daemon sends.
  const [lastSeq, setLastSeq] = useState<number | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const streamStateRef = useRef<StreamState>('idle');

  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [artifactsState, setArtifactsState] = useState<LoadState>('idle');
  const [artifactsNonce, setArtifactsNonce] = useState(0);

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [devicesState, setDevicesState] = useState<LoadState>('idle');

  const [handoffPath, setHandoffPath] = useState<string | null>(null);
  const [handoffSummary, setHandoffSummary] = useState<HandoffApplySummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
        // `gates.list` is served now (see the note on `WarshaClient.getGates`), so this path is the
        // older daemon's: a phone paired against a `warshad` that does not answer the name still
        // builds the queue from the run's own stage plus this device's records. The screen says
        // which reading it is showing.
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

  // ------------------------------------------------------------------------------------ the artifacts
  // Capability-gated twice over: a daemon (or stub) without `runs.artifacts` never gets asked, and
  // the state stays `idle` — the screen reads `idle` as "this surface does not exist here" and
  // renders nothing, rather than an empty list that claims the run has produced nothing.
  useEffect(() => {
    if (api === null || api.getRunArtifacts === undefined || run === null) {
      setArtifacts([]);
      setArtifactsState('idle');
      return undefined;
    }
    let cancelled = false;
    setArtifactsState('loading');
    api
      .getRunArtifacts(run.id)
      .then((answer) => {
        if (cancelled) return;
        setArtifacts(answer);
        setArtifactsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setArtifactsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, run, artifactsNonce]);

  // ------------------------------------------------------------------------------------- the devices
  useEffect(() => {
    if (api === null || api.listDevices === undefined || session === null) {
      setDevices([]);
      setDevicesState('idle');
      return undefined;
    }
    let cancelled = false;
    setDevicesState('loading');
    api
      .listDevices()
      .then((answer) => {
        if (cancelled) return;
        setDevices(answer);
        setDevicesState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setDevicesState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, session, reloadNonce]);

  // -------------------------------------------------------------------------------- the live feed
  // A new session is a new daemon: its sequence numbers mean nothing to the last one, so the cursor
  // starts over. Declared before the feed effect, so on a session change the reset lands first.
  useEffect(() => {
    lastSeqRef.current = null;
    setLastSeq(null);
  }, [session]);

  useEffect(() => {
    streamStateRef.current = streamState;
  }, [streamState]);

  // The rebuild a gap or a refused cursor calls for: ask the daemon for the run's whole current view
  // (`runs.subscribe` → `RunStreamSync`) and make the on-screen feed what it answers, then adopt its
  // sequence as the new cursor. A daemon without `runs.subscribe` gets the older treatment — read
  // everything again — because a gap the bench cannot bridge is a reason to reload, not to lie.
  const resyncFromCursor = useCallback(() => {
    if (api === null) return;
    if (api.subscribeRun === undefined) {
      setReloadNonce((nonce) => nonce + 1);
      return;
    }
    void api
      .subscribeRun(run === null ? undefined : run.id, lastSeqRef.current ?? undefined)
      .then((sync) => {
        setEvents(sync.events.slice(-500));
        lastSeqRef.current = sync.seq;
        setLastSeq(sync.seq);
      })
      .catch(() => {
        setReloadNonce((nonce) => nonce + 1);
      });
  }, [api, run]);

  useEffect(() => {
    if (session === null || run === null) {
      setStreamState('idle');
      return undefined;
    }
    setStreamState('idle');
    const subscription = openEvents({
      url: eventStreamUrl(session.baseUrl),
      token: session.token,
      // Resume where this device last saw a frame, and narrow the feed to the run on screen: a phone
      // that slept through forty frames should get them back, not a wall of silence.
      sinceSeq: lastSeqRef.current ?? undefined,
      runId: run.id,
      onEvent: (event) => {
        setStreamState('open');
        if (typeof event.seq === 'number') {
          lastSeqRef.current = event.seq;
          setLastSeq(event.seq);
        }
        // An artifact frame is a standing invitation to read the artifact list again.
        if (event.kind.includes('artifact')) setArtifactsNonce((nonce) => nonce + 1);
        // A 500-line ceiling: the phone is a glance surface, and an unbounded feed is a leak on the
        // least capable device in the house.
        setEvents((previous) => [...previous, event].slice(-500));
      },
      onError: () => {
        // The feed is down; the queue is not (§7). Nothing here is cleared.
        setStreamState('closed');
      },
      // Loss announced is loss answered: rebuild from the cursor rather than show a feed with a hole
      // in it (§7's "never imply"; a silent gap is exactly that).
      onGap: () => resyncFromCursor(),
      onResyncRequired: () => resyncFromCursor(),
    });
    return () => {
      subscription.close();
    };
  }, [openEvents, resyncFromCursor, run, session, streamNonce]);

  const reconnectStream = useCallback(() => setStreamNonce((nonce) => nonce + 1), []);

  // A phone wakes when its owner looks at it. If the feed died while the tab was in a pocket — the
  // WebView suspends sockets, and the daemon eventually drops them — the first look back is the
  // reconnect, not a stale "offline" the owner has to press twice to clear.
  useEffect(() => {
    if (session === null) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && streamStateRef.current === 'closed') {
        reconnectStream();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reconnectStream, session]);

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

  // ------------------------------------------------------------------------ the run-control actions
  // One shape for every P0/P1 write: the daemon's method is *bound* to the surface before the screen
  // ever sees it (a class client's methods need their `this`), the answer is merged into the lists
  // the bench already renders, and a refusal lands in `actionError` as the token-redacted words the
  // screens already have a slot for. A method the daemon (or the stub) does not answer yields `null`
  // — capability gating, not a control that lies about working.
  const runAction = useCallback(
    (call: () => Promise<unknown>): Promise<void> =>
      call()
        .then(() => {
          setActionError(null);
        })
        .catch((error: unknown) => {
          setActionError(safeMessage(failureDetail(error), session));
        }),
    [session]
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  const createNewProject = useMemo(() => {
    const create = api?.createProject?.bind(api);
    if (create === undefined) return null;
    return (name: string, description: string): Promise<void> =>
      runAction(async () => {
        const answer = await create(name, description, locale);
        setProjects((previous) => [answer, ...previous.filter((row) => row.id !== answer.id)]);
        // A created project is the one the owner just made: open it, and let its (empty) runs reload.
        setProjectIdState(answer.id);
        setRunIdState(null);
      });
  }, [api, locale, runAction]);

  const startNewRun = useMemo(() => {
    const start = api?.startRun?.bind(api);
    if (start === undefined) return null;
    return (idea: string): Promise<void> => {
      if (projectId === null) return Promise.resolve();
      return runAction(async () => {
        const answer = await start(projectId, idea);
        setRuns((previous) => [answer, ...previous.filter((row) => row.id !== answer.id)]);
        pendingRunId.current = null;
        setRunIdState(answer.id);
      });
    };
  }, [api, projectId, runAction]);

  const advanceCurrentRun = useMemo(() => {
    const advance = api?.advanceRun?.bind(api);
    if (advance === undefined) return null;
    return (): Promise<void> => {
      if (run === null) return Promise.resolve();
      return runAction(async () => {
        // The daemon's own new row replaces the stale one; every panel keyed on the run re-reads.
        const answer = await advance(run.id);
        setRuns((previous) => previous.map((row) => (row.id === answer.id ? answer : row)));
      });
    };
  }, [api, run, runAction]);

  const cancelCurrentRun = useMemo(() => {
    const cancel = api?.cancelRun?.bind(api);
    if (cancel === undefined) return null;
    return (): Promise<void> => {
      if (run === null) return Promise.resolve();
      return runAction(async () => {
        const answer = await cancel(run.id);
        setRuns((previous) => previous.map((row) => (row.id === answer.id ? answer : row)));
      });
    };
  }, [api, run, runAction]);

  const sendFollowup = useMemo(() => {
    const followup = api?.followupRun?.bind(api);
    if (followup === undefined) return null;
    return (prompt: string): Promise<void> => {
      if (run === null) return Promise.resolve();
      return runAction(async () => {
        const answer = await followup(run.id, prompt);
        setRuns((previous) => previous.map((row) => (row.id === answer.id ? answer : row)));
      });
    };
  }, [api, run, runAction]);

  const triggerHandoff = useMemo(() => {
    const createBundle = api?.createHandoff?.bind(api);
    if (createBundle === undefined) return null;
    return (): Promise<void> => {
      if (run === null) return Promise.resolve();
      return runAction(async () => {
        // The bundle carries exactly what this bench has read for this run — the daemon's own
        // artifacts, by name and content, nothing invented on the phone.
        const files = artifacts.map((artifact): readonly [string, string] => [artifact.name, artifact.content]);
        const path = await createBundle(run.id, files);
        setHandoffPath(path);
        setHandoffSummary(null);
      });
    };
  }, [api, artifacts, run, runAction]);

  const applyHandoffBundle = useMemo(() => {
    const apply = api?.applyHandoff?.bind(api);
    if (apply === undefined) return null;
    return (): Promise<void> => {
      if (handoffPath === null) return Promise.resolve();
      const path = handoffPath;
      return runAction(async () => {
        // The phone is the owner's hand: `owner_wins` resolves conflicts toward the owner's side,
        // and the summary the daemon answers says what landed, what clashed, what was backed up.
        const summary = await apply(path, true);
        setHandoffSummary(summary);
        // An applied bundle rewrote the run's documents: read the bench again, artifacts included.
        setReloadNonce((nonce) => nonce + 1);
        setArtifactsNonce((nonce) => nonce + 1);
      });
    };
  }, [api, handoffPath, runAction]);

  const revokePairedDevice = useMemo(() => {
    const revoke = api?.revokeDevice?.bind(api);
    if (revoke === undefined) return null;
    return (deviceId: DeviceId): Promise<void> =>
      runAction(async () => {
        await revoke(deviceId);
        setDevices((previous) => previous.filter((row) => row.id !== deviceId));
      });
  }, [api, runAction]);

  // -------------------------------------------------------------------------------------- the queue
  const queue = useMemo<BenchGate[]>(
    () => (gates !== null ? gates : stageQueue(run, localDecisions)),
    [gates, localDecisions, run]
  );

  const pendingGates = useMemo(() => queue.filter((gate) => gate.state.state === 'pending'), [queue]);

  // The gate the phone puts under the owner's thumb is the one the run is stopped at; `pendingGates[0]` is
  // the fallback for the queue a serving daemon reports whole (all four stages, all four defaulting to
  // pending), where the oldest pending row is three stages away from the run and is not waiting on anyone.
  const parkedGate = useMemo(
    () => pendingGates.find((gate) => gateWaitsOnOwner(gate, run === null ? null : run.stage)) ?? null,
    [pendingGates, run]
  );

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
      parkedGate,
      topPendingGate: parkedGate ?? pendingGates[0] ?? null,
      gatesState,
      gatesSource,

      budget,
      budgetState,
      logs,
      logsState,
      events,
      streamState,
      reconnectStream,

      lastSeq,
      artifacts,
      artifactsState,
      devices,
      devicesState,
      handoffPath,
      handoffSummary,
      actionError,
      clearActionError,
      createNewProject,
      startNewRun,
      advanceCurrentRun,
      cancelCurrentRun,
      sendFollowup,
      triggerHandoff,
      applyHandoffBundle,
      revokePairedDevice,

      decision,
      decide,

      reloadAll,
      reloadGates,
      locale,
    }),
    [
      actionError,
      advanceCurrentRun,
      applyHandoffBundle,
      artifacts,
      artifactsState,
      budget,
      budgetState,
      cancelCurrentRun,
      clearActionError,
      connection,
      createNewProject,
      daemonVersion,
      decide,
      decision,
      devices,
      devicesState,
      events,
      gatesSource,
      gatesState,
      handoffPath,
      handoffSummary,
      lastSeq,
      locale,
      logs,
      logsState,
      onPair,
      onUnpair,
      pendingGates,
      parkedGate,
      project,
      projectId,
      projects,
      projectsState,
      queue,
      reconnectStream,
      reloadAll,
      reloadGates,
      revokePairedDevice,
      run,
      runs,
      runsState,
      sendFollowup,
      session,
      setProjectId,
      setRunId,
      startNewRun,
      streamState,
      triggerHandoff,
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
