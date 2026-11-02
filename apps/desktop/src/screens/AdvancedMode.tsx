// Advanced mode — the deeper rung of the same bench (PLAN.md M20, docs/design/REDESIGN.md §3, §5).
//
// What this screen is for is the reviewing developer's question: *prove the run is reproducible*. So it
// shows the lanes the team actually ran, the event stream with its filters, the task board the loop
// recorded, the run's log, the cost the run spent, and the ship status of what it produced. Simple mode
// says the same state in plain words; nothing here changes the pipeline, the gates or the data model (§3),
// and switching mode keeps the project, the run and the pane the owner was reading.
//
// The bench shape:
//
//   * the start rail (§4, §1.2) is lanes, then runs, then the two controls the owner sets here — one row,
//     one lamp, one name, one cost. Below 768px `index.css` lays the rail down as a horizontal strip, so
//     the phone bench never grows a second column that overflows (§10);
//   * at ≥1024 the bench splits the stream (main) from the panes (side) — §10's "Advanced splits
//     stream/panes";
//   * machine data is mono with tabular numerals and `translate="no"`, prose is sans (§11); the stream is
//     a `role="log"` polite region, so a hundred tool calls narrate instead of interrupting (§9);
//   * a filter never hides a gate event (§3), and every plate has its loading, empty, error and offline
//     reading in words rather than in a colour (§7).
//
// Every word is `@warsha/i18n` (`advanced.*`, `bench.*`, `status_strip.*`). The local `{ ar, en }` tab
// table, the `t(...) || 'literal'` fallbacks, the `ROLE_COLORS` map, the mock command runner and the
// invented cost cards are gone. The data path is the client's own: `runs.list`, `agent.state`,
// `runs.logs`, `budget.project` and the `/events` socket — nothing here pretends at an RPC the daemon
// does not have.
import {
  subscribeEvents,
  type AgentTodo,
  type BudgetStatus,
  type ProjectSummary,
  type Role,
  type RunSummary,
  type WarshaClient,
  type WarshaEvent,
} from '@warsha/client';
import { t, useDirection, useLocale, type Locale } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  DiffView,
  EmptyState,
  Lamp,
  Ledger,
  Meter,
  Panel,
  RailHead,
  RailRow,
  Skeleton,
  Stream,
  TerminalDock,
  TerminalLine,
  tabPanelProps,
  type LampState,
  type StreamKind,
} from '@warsha/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PermissionModeChip, type PermissionMode } from '../components/PermissionModeChip';
import { PlanModeBadge, type AgentMode } from '../components/PlanModeBadge';
import {
  preflightCheckNames,
  preflightReady,
  ReleasePreflight,
  type PreflightCheck,
} from '../components/ReleasePreflight';
import { RunModeBadge, type RunMode } from '../components/RunModeBadge';
import { SnapshotRestoreButton } from '../components/SnapshotRestoreButton';
import { initialDeliveryStages, StatusStrip, type DeliveryStage } from '../components/StatusStrip';
import { WebDeployButton, type DeployStatus } from '../components/WebDeployButton';

interface AdvancedModeProps {
  client: WarshaClient;
  project: ProjectSummary;
  onBack?: () => void;
  /**
   * Where the daemon is: the HTTP base it answers on and the token that reaches it.
   *
   * The shell resolves both from the Tauri config (`daemon_url` / `daemon_token` in
   * `apps/desktop/src-tauri/src/lib.rs`) and passes them down, so this screen never names a port or a
   * secret of its own.
   */
  endpoint: { baseUrl: string; token: string };
}

/** Which pane the side column shows. */
type AdvancedPane = 'board' | 'files' | 'diff' | 'terminal' | 'costs' | 'ship';

const ADVANCED_PANES: readonly AdvancedPane[] = ['board', 'files', 'diff', 'terminal', 'costs', 'ship'];

/** Which subset of the event stream the owner asked for (§3's filter chips). */
type StreamFilter = 'all' | 'tools' | 'errors' | 'costs' | 'gates';

const STREAM_FILTERS: readonly StreamFilter[] = ['all', 'tools', 'errors', 'costs', 'gates'];

/** A lane: one role's worth of events, folded out of the live stream (§3's first rung). */
interface Lane {
  /** The rail's key for this lane — the role, or `unassigned` for events with no role yet. */
  key: string;
  role: Role | null;
  events: number;
  costCents: number;
  waiting: boolean;
  failed: boolean;
}

/** The lane's rail key: a role names itself; an event with no role joins the unassigned lane. */
function laneKeyOf(event: WarshaEvent): string {
  return event.role ?? 'unassigned';
}

/** A lane is waiting on the owner, blocked, or moving — the three readings the lamp knows. */
function laneLamp(lane: Lane): LampState {
  if (lane.waiting) return 'waiting';
  if (lane.failed) return 'fail';
  return 'working';
}

/** The catalog word for a role (§11: the role is prose, so it is translated). */
function roleWord(lane: Lane, locale: Locale): string {
  return lane.role === null
    ? t('advanced.lane_unassigned', {}, locale)
    : t(`role.${lane.role}`, {}, locale);
}

/** The stage's word: the four gates keep their own labels, the pipeline stages read from `run.stage.*`. */
function stageWord(stage: string, locale: Locale): string {
  return t(stage.startsWith('gate_') ? `gates.label.${stage}` : `run.stage.${stage}`, {}, locale);
}

/** The three run states the bench names; anything else is the daemon's own word, in mono. */
export function runStateWord(status: string, locale: Locale): string {
  const known = ['running', 'completed', 'failed'];
  return known.includes(status) ? t(`run.state_${status}`, {}, locale) : status;
}

/** A gate event is the stage's own name or a kind that says gate (§3: the one event a filter keeps). */
export function isGateEvent(event: WarshaEvent): boolean {
  return event.stage.startsWith('gate_') || /gate|approval|decision/i.test(event.kind);
}

/**
 * Whether an event passes a filter — and gate events always pass (§3).
 *
 * The rule is in the direction because a hidden gate is a hidden decision: an owner who filtered to
 * "tools" must still see the line that says the run is waiting on them.
 */
export function eventPassesFilter(event: WarshaEvent, filter: StreamFilter): boolean {
  if (isGateEvent(event)) return true;
  switch (filter) {
    case 'all':
      return true;
    case 'tools':
      return /tool|exec|command|spawn/i.test(event.kind);
    case 'errors':
      return /error|fail|refus|denied|timeout/i.test(event.kind);
    case 'costs':
      return event.costCents !== null && event.costCents > 0;
    case 'gates':
      return false;
  }
}

/** The glyph a stream line takes for this event (§9: the kind is said without colour). */
export function eventStreamKind(event: WarshaEvent): StreamKind {
  if (isGateEvent(event)) return 'gate';
  if (/error|fail|refus|denied|timeout/i.test(event.kind)) return 'fail';
  if (/pass|ok|done|complete/i.test(event.kind)) return 'ok';
  if (/tool|exec|command|spawn/i.test(event.kind)) return 'tool';
  return 'default';
}

/** A todo's bench state: done, running, or still to do (§5's task board columns). */
export function todoState(status: AgentTodo['status']): 'done' | 'running' | 'todo' {
  if (status === 'done') return 'done';
  if (status === 'in_progress') return 'running';
  return 'todo';
}

/**
 * The `/events` address for a daemon base URL.
 *
 * `subscribeEvents` appends `/events` to whatever it is given and opens a WebSocket, so an `http://`
 * base has to become `ws://` (and `https://` → `wss://`) before it gets there — a socket to an `http:`
 * URL is rejected by the browser, which is the difference between a live bench and a permanently
 * offline one.
 */
export function eventStreamUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws');
}

/** `$4.20` — Western digits, two decimals, mono upstream (§11). */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** The six release checks before any of them has run. */
function pendingChecks(): PreflightCheck[] {
  return preflightCheckNames.map((name) => ({ name, status: 'pending' as const }));
}

export function AdvancedMode({ client, project, onBack, endpoint }: AdvancedModeProps) {
  const dir = useDirection();
  const locale = useLocale();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsState, setRunsState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [run, setRun] = useState<RunSummary | null>(null);
  const [events, setEvents] = useState<WarshaEvent[]>([]);
  const [streamOffline, setStreamOffline] = useState(false);
  const [streamNonce, setStreamNonce] = useState(0);
  const [filter, setFilter] = useState<StreamFilter>('all');
  const [laneFilter, setLaneFilter] = useState<string | null>(null);
  const [pane, setPane] = useState<AdvancedPane>('board');
  const [todos, setTodos] = useState<AgentTodo[] | null>(null);
  const [todosState, setTodosState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logsState, setLogsState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  // Work protection (M14a) and the agent workflow (M18): per-session choices the owner sets here.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask_for_risky');
  const [agentMode, setAgentMode] = useState<AgentMode>('plan');
  const [runMode] = useState<RunMode>('local');
  // Ship status (M5a): the checks and stages start pending because nothing has reported yet, and the
  // daemon has no preflight or deploy RPC on this branch, so a press records intent (§7).
  const [deliveryStages] = useState<DeliveryStage[]>(initialDeliveryStages);
  const [checks] = useState<PreflightCheck[]>(pendingChecks);
  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const tablistRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------------ the run the bench is showing
  useEffect(() => {
    let cancelled = false;
    setRunsState('loading');
    client
      .listRuns(project.id)
      .then((list) => {
        if (cancelled) return;
        setRuns(list);
        setRun(list[0] ?? null);
        setRunsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setRunsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [client, project.id]);

  // The project's budget: the same reading the instrument strip shows (§4), from `budget.project`.
  useEffect(() => {
    let cancelled = false;
    client
      .getProjectBudget(project.id)
      .then((status) => {
        if (!cancelled) setBudget(status);
      })
      .catch(() => {
        if (!cancelled) setBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, project.id]);

  // The loop's task board: `agent.state` is the daemon's own record of what it said it would do.
  useEffect(() => {
    let cancelled = false;
    setTodosState('loading');
    client
      .agentState()
      .then((state) => {
        if (cancelled) return;
        setTodos(state.todos);
        setTodosState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setTodos(null);
        setTodosState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // The run's log, for the read-only terminal transcript (§6: the dock's prompt is absent on purpose —
  // there is no process-spawn RPC reachable from the UI).
  useEffect(() => {
    if (run === null) {
      setLogs([]);
      setLogsState('ready');
      return undefined;
    }
    let cancelled = false;
    setLogsState('loading');
    client
      .getRunLogs(run.id)
      .then((lines) => {
        if (cancelled) return;
        setLogs(lines);
        setLogsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setLogs(null);
        setLogsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [client, run]);

  // --------------------------------------------------------------------- the live event stream
  useEffect(() => {
    if (run === null) return undefined;
    // A fresh subscription for a fresh run: what the previous run streamed is not this run's evidence.
    setEvents([]);
    setStreamOffline(false);

    const subscription = subscribeEvents({
      url: eventStreamUrl(endpoint.baseUrl),
      token: endpoint.token,
      onEvent: (event) => {
        setStreamOffline(false);
        setEvents((previous) => [...previous, event].slice(-500));
      },
      onError: () => {
        // §7: the queue is not lost, the feed is — say that, and offer the reconnect.
        setStreamOffline(true);
      },
    });
    return () => subscription.close();
  }, [endpoint.baseUrl, endpoint.token, run, streamNonce]);

  const lanes: Lane[] = useMemo(() => {
    const byKey = new Map<string, Lane>();
    for (const event of events) {
      const key = laneKeyOf(event);
      const lane = byKey.get(key) ?? { key, role: event.role, events: 0, costCents: 0, waiting: false, failed: false };
      lane.events += 1;
      lane.costCents += event.costCents ?? 0;
      if (isGateEvent(event)) lane.waiting = true;
      if (/error|fail|refus|denied/i.test(event.kind)) {
        lane.failed = true;
        lane.waiting = false;
      }
      byKey.set(key, lane);
    }
    return [...byKey.values()];
  }, [events]);

  const visibleEvents = useMemo(
    () =>
      events.filter((event) => {
        if (laneFilter !== null && laneKeyOf(event) !== laneFilter) return false;
        return eventPassesFilter(event, filter);
      }),
    [events, filter, laneFilter]
  );

  const spentCents = useMemo(() => lanes.reduce((sum, lane) => sum + lane.costCents, 0), [lanes]);

  /** The lane the filter chip names, or `null` when its lane left the stream. */
  const laneFilterLane = useMemo(
    () => (laneFilter === null ? null : lanes.find((lane) => lane.key === laneFilter) ?? null),
    [laneFilter, lanes]
  );

  /** `14:22:07.318` — Arabic keeps 0–9 so two lines of a feed compare (§11). */
  const formatTime = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
      }).format(new Date(iso)),
    [locale]
  );

  /** `2026-10-05 07:15` in UTC, so a run's start reads the same in every timezone. */
  const formatStart = useCallback(
    (iso: string) => {
      const date = new Date(iso);
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    },
    []
  );

  // ------------------------------------------------------------------ the pane tab strip (§9 roving)
  const onTabsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const nodes = tablistRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    if (!nodes || nodes.length === 0) return;
    const rtl = dir === 'rtl';
    const forward = event.key === 'ArrowRight' ? !rtl : event.key === 'ArrowLeft' ? rtl : false;
    const back = event.key === 'ArrowLeft' ? !rtl : event.key === 'ArrowRight' ? rtl : false;
    const order = [...nodes];
    const current = order.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (forward) next = (current + 1) % order.length;
    else if (back) next = (current - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next === null) return;
    // Manual activation: the arrow moves focus, Enter or Space (this button's own keys) selects.
    event.preventDefault();
    order[next]?.focus();
  };

  const title = t('advanced.title', {}, locale);

  const todosByState = useMemo(() => {
    const empty = { done: [], running: [], todo: [] } as Record<'done' | 'running' | 'todo', AgentTodo[]>;
    if (todos === null) return empty;
    for (const todo of todos) empty[todoState(todo.status)].push(todo);
    return empty;
  }, [todos]);

  return (
    <div dir={dir} className="bench-screen-stack" data-testid="advanced-mode" style={{ gap: 'var(--warsha-space-3)' }}>
      <Box
        dir={dir}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', minInlineSize: 0 }}
      >
        {onBack && (
          // §4: every pushed screen keeps a back control at its inline start.
          <Button variant="ghost" size="sm" dir={dir} data-testid="advanced-back" onClick={onBack}>
            {t('common.back', {}, locale)}
          </Button>
        )}
        <h1
          dir={dir}
          style={{
            margin: 0,
            fontSize: 'var(--warsha-font-size-xl)',
            fontWeight: 'var(--warsha-font-weight-bold)',
            color: 'var(--warsha-color-text)',
            minInlineSize: 0,
          }}
        >
          {title}
        </h1>
        <span dir={dir} data-testid="advanced-project-name" style={{ fontSize: 'var(--warsha-font-size-sm)', minInlineSize: 0 }}>
          {project.name}
        </span>
        <RunModeBadge mode={runMode} />
      </Box>

      {streamOffline && (
        <Banner
          tone="offline"
          action={
            <Button
              variant="secondary"
              size="sm"
              dir={dir}
              data-testid="advanced-reconnect"
              onClick={() => setStreamNonce((nonce) => nonce + 1)}
            >
              {t('simple.stream_retry', {}, locale)}
            </Button>
          }
        >
          {t('simple.stream_offline', {}, locale)}
        </Banner>
      )}

      {/* ======================================================================== rail and panes */}
      <div className="bench-advanced">
        {/* ------------------------------------------------------------------------------ the rail */}
        <div className="bench-rail" data-testid="advanced-rail">
          <Panel
            title={t('advanced.lanes_label', {}, locale)}
            label={t('advanced.lanes_label', {}, locale)}
            actions={
              <span style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--warsha-font-size-xs)' }}>
                {`${lanes.length} ${t('bench.lanes_active', {}, locale)}`}
              </span>
            }
            style={{ borderBlockEnd: 'none', minInlineSize: 0 }}
          >
            {lanes.length === 0 ? (
              <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
                {t('advanced.no_lanes', {}, locale)}
              </p>
            ) : (
              lanes.map((lane, index) => (
                <RailRow
                  key={lane.key}
                  selected={laneFilter === lane.key}
                  leading={<Lamp state={laneLamp(lane)} size="xs" bare>{`${index + 1}`}</Lamp>}
                  sublabel={t('advanced.lane_of', { number: index + 1 }, locale)}
                  meta={`$${(lane.costCents / 100).toFixed(4)}`}
                  onSelect={() => setLaneFilter((current) => (current === lane.key ? null : lane.key))}
                >
                  {roleWord(lane, locale)}
                </RailRow>
              ))
            )}
          </Panel>

          <Panel
            title={t('advanced.runs_label', {}, locale)}
            label={t('advanced.runs_label', {}, locale)}
            style={{ borderBlockEnd: 'none', minInlineSize: 0 }}
          >
            {runsState === 'loading' ? (
              <Skeleton label={t('advanced.runs_loading', {}, locale)} lines={2} variant="row" />
            ) : runsState === 'failed' ? (
              <Lamp state="fail" size="sm">
                {t('advanced.runs_failed', {}, locale)}
              </Lamp>
            ) : runs.length === 0 ? (
              <EmptyState
                title={t('projects.empty_title', {}, locale)}
                description={t('advanced.no_lanes', {}, locale)}
                action={
                  onBack ? (
                    <Button variant="primary" size="sm" dir={dir} onClick={onBack}>
                      {t('projects.new_project', {}, locale)}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              runs.map((candidate) => (
                <RailRow
                  key={candidate.id}
                  selected={candidate.id === run?.id}
                  meta={<span dir="ltr" translate="no">{formatStart(candidate.startedAt)}</span>}
                  sublabel={`${stageWord(candidate.stage, locale)} · ${runStateWord(candidate.status, locale)}`}
                  onSelect={() => setRun(candidate)}
                >
                  <span dir="ltr" translate="no" style={{ fontFamily: 'var(--warsha-font-mono)', fontSize: 'var(--warsha-font-size-xs)' }}>
                    {candidate.id}
                  </span>
                </RailRow>
              ))
            )}
          </Panel>

          {/* Run control: the two choices that change what the agent may do — the deeper rung's own (§3). */}
          <Panel
            title={t('work_protection.label', {}, locale)}
            label={t('work_protection.label', {}, locale)}
            style={{ borderBlockEnd: 'none', minInlineSize: 0 }}
          >
            <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
              <PermissionModeChip mode={permissionMode} onChange={setPermissionMode} />
              <PlanModeBadge mode={agentMode} onToggle={setAgentMode} />
              <SnapshotRestoreButton snapshotId={null} onRestore={() => undefined} />
            </Box>
          </Panel>
        </div>

        {/* ---------------------------------------------------------------------- stream and panes */}
        <div className="bench-panes">
          <Panel
            title={t('advanced.stream_label', {}, locale)}
            label={t('advanced.stream_label', {}, locale)}
            actions={
              <span style={{ fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--warsha-font-size-xs)' }}>
                {`${visibleEvents.length} / ${events.length}`}
              </span>
            }
            style={{ minInlineSize: 0 }}
          >
            <div dir={dir} className="bench-filters" role="group" aria-label={t('advanced.filter_label', {}, locale)}>
              {STREAM_FILTERS.map((candidate) => (
                <Chip key={candidate} selected={filter === candidate} onPress={() => setFilter(candidate)}>
                  {t(`advanced.filter_${candidate}`, {}, locale)}
                </Chip>
              ))}
              {laneFilter !== null && laneFilterLane !== null && (
                <Chip tone="lit" glyph="×" onPress={() => setLaneFilter(null)}>
                  {roleWord(laneFilterLane, locale)}
                </Chip>
              )}
            </div>

            <p dir={dir} style={{ margin: 0, marginBlockStart: 'var(--warsha-space-2)', fontSize: 'var(--warsha-font-size-xs)' }}>
              {t('advanced.filter_note', {}, locale)}
            </p>

            {run === null ? (
              <p dir={dir} style={{ margin: 0, marginBlockStart: 'var(--warsha-space-3)', fontSize: 'var(--warsha-font-size-sm)' }}>
                {t('bench.no_run', {}, locale)}
              </p>
            ) : visibleEvents.length === 0 ? (
              events.length === 0 ? (
                <Box style={{ marginBlockStart: 'var(--warsha-space-3)' }}>
                  <Skeleton label={t('advanced.stream_label', {}, locale)} lines={3} />
                </Box>
              ) : (
                <p dir={dir} style={{ margin: 0, marginBlockStart: 'var(--warsha-space-3)', fontSize: 'var(--warsha-font-size-sm)' }}>
                  {t('advanced.no_events', {}, locale)}
                </p>
              )
            ) : (
              <div className="bench-stream">
                <Stream label={t('advanced.stream_label', {}, locale)}>
                  {visibleEvents.slice(-120).map((event) => (
                    <Stream.Line
                      key={event.id}
                      time={formatTime(event.createdAt)}
                      kind={eventStreamKind(event)}
                      lane={event.role === null ? undefined : t(`role.${event.role}`, {}, locale)}
                    >
                      <span dir="ltr" translate="no">{`${event.kind} · ${stageWord(event.stage, locale)}`}</span>
                      {event.costCents !== null && ` · $${(event.costCents / 100).toFixed(4)}`}
                    </Stream.Line>
                  ))}
                </Stream>
              </div>
            )}
          </Panel>

          {/* --------------------------------------------------------------------------------- panes */}
          <Box dir={dir} className="bench-side">
            <div
              ref={tablistRef}
              dir={dir}
              role="tablist"
              aria-label={t('advanced.tabs_label', {}, locale)}
              data-testid="advanced-tabs"
              onKeyDown={onTabsKeyDown}
              style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: 'var(--warsha-space-1)',
                borderBlockEnd: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
                overflowX: 'auto',
                minInlineSize: 0,
              }}
            >
              {ADVANCED_PANES.map((candidate) => {
                const selected = pane === candidate;
                return (
                  <Button
                    key={candidate}
                    role="tab"
                    aria-selected={selected}
                    // Roving tabindex: the strip is one Tab stop and the arrows do the rest (§9).
                    tabIndex={selected ? 0 : -1}
                    aria-controls={`advanced-panel-${candidate}`}
                    id={`advanced-panel-${candidate}-tab`}
                    variant="ghost"
                    size="sm"
                    dir={dir}
                    data-testid={`advanced-tab-${candidate}`}
                    onClick={() => setPane(candidate)}
                    style={{
                      flex: 'none',
                      borderRadius: 0,
                      borderBlockEnd: selected
                        ? 'var(--warsha-size-edge) solid var(--warsha-signal-text)'
                        : 'var(--warsha-size-edge) solid transparent',
                      backgroundColor: 'transparent',
                      color: 'var(--warsha-color-text)',
                      fontWeight: selected
                        ? 'var(--warsha-font-weight-bold)'
                        : 'var(--warsha-font-weight-medium)',
                      paddingInline: 'var(--warsha-space-3)',
                      minBlockSize: 'var(--warsha-size-touch)',
                    }}
                  >
                    {t(`advanced.tab_${candidate}`, {}, locale)}
                  </Button>
                );
              })}
            </div>

            {/* ------------------------------------------------------------------ the task board */}
            {pane === 'board' && (
              <div {...tabPanelProps('advanced-panel-board')} dir={dir} data-testid="advanced-board">
                <Panel title={t('advanced.board_label', {}, locale)} label={t('advanced.board_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  {todosState === 'loading' ? (
                    <Skeleton label={t('advanced.board_loading', {}, locale)} lines={3} variant="row" />
                  ) : todosState === 'failed' || todos === null ? (
                    <Lamp state="fail" size="sm">
                      {t('advanced.board_failed', {}, locale)}
                    </Lamp>
                  ) : todos.length === 0 ? (
                    <Lamp state="idle" size="sm">
                      {t('advanced.board_empty', {}, locale)}
                    </Lamp>
                  ) : (
                    <div className="bench-tasks">
                      {(['done', 'running', 'todo'] as const).map((state) => (
                        <div key={state} className="bench-tasks-column" data-testid={`advanced-column-${state}`} data-state={state}>
                          <RailHead>{`${t(`advanced.state_${state}`, {}, locale)} (${todosByState[state].length})`}</RailHead>
                          <Ledger
                            label={`${t('advanced.board_label', {}, locale)} — ${t(`advanced.state_${state}`, {}, locale)}`}
                            style={{ borderBlockStart: 'none' }}
                          >
                            {todosByState[state].map((todo) => (
                              <Ledger.Row key={todo.id} state={state}>
                                {todo.description}
                              </Ledger.Row>
                            ))}
                          </Ledger>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {/* ------------------------------------------------------------------------ the files */}
            {pane === 'files' && (
              <div {...tabPanelProps('advanced-panel-files')} dir={dir} data-testid="advanced-files">
                <Panel title={t('advanced.files_label', {}, locale)} label={t('advanced.files_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  {/* The daemon answers `artifacts` for a run, not a file tree, on this branch — so the plate
                      says where the list actually lives rather than inventing an RPC (§5, and no new calls). */}
                  <EmptyState
                    title={t('advanced.files_empty', {}, locale)}
                    description={t('artifacts.select_desc', {}, locale)}
                    action={
                      onBack ? (
                        <Button variant="primary" size="sm" dir={dir} data-testid="advanced-files-parent" onClick={onBack}>
                          {t('run.artifacts', {}, locale)}
                        </Button>
                      ) : undefined
                    }
                  />
                </Panel>
              </div>
            )}

            {/* ------------------------------------------------------------------------- the diff */}
            {pane === 'diff' && (
              <div {...tabPanelProps('advanced-panel-diff')} dir={dir} data-testid="advanced-diff">
                <Panel title={t('advanced.diff_label', {}, locale)} label={t('advanced.diff_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  {run === null ? (
                    <Lamp state="idle" size="sm">
                      {t('bench.no_run', {}, locale)}
                    </Lamp>
                  ) : logsState === 'loading' ? (
                    <Skeleton label={t('advanced.logs_loading', {}, locale)} lines={2} variant="row" />
                  ) : logs === null || logs.length === 0 ? (
                    <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
                      {t('advanced.diff_empty', {}, locale)}
                    </p>
                  ) : (
                    <DiffView label={`${t('advanced.diff_label', {}, locale)} — ${run.id}`}>
                      {logs.slice(0, 40).map((line, index) => (
                        <DiffView.Line
                          key={index}
                          kind={/^-|\bfail|\berror/i.test(line) ? 'del' : /^\+|pass|ok/i.test(line) ? 'add' : 'context'}
                          newNumber={index + 1}
                        >
                          {line}
                        </DiffView.Line>
                      ))}
                    </DiffView>
                  )}
                </Panel>
              </div>
            )}

            {/* --------------------------------------------------------------------- the terminal */}
            {pane === 'terminal' && (
              <div {...tabPanelProps('advanced-panel-terminal')} dir={dir} data-testid="advanced-terminal">
                <div className="bench-terminal">
                  <TerminalDock
                    label={t('advanced.terminal_label', {}, locale)}
                    commandLabel={t('advanced.terminal_readonly', {}, locale)}
                    submitLabel={t('run.follow_live', {}, locale)}
                    hint={t('advanced.terminal_hint', {}, locale)}
                    hideLabel
                    output={
                      logsState === 'loading' ? (
                        <Skeleton label={t('advanced.logs_loading', {}, locale)} lines={3} quiet />
                      ) : logsState === 'failed' || logs === null ? (
                        <TerminalLine tone="fail">{t('advanced.logs_failed', {}, locale)}</TerminalLine>
                      ) : logs.length === 0 ? (
                        <TerminalLine>{t('advanced.logs_empty', {}, locale)}</TerminalLine>
                      ) : (
                        logs.map((line, index) => (
                          <TerminalLine
                            key={index}
                            tone={/^\+/.test(line) ? 'ok' : /error|fail/i.test(line) ? 'fail' : 'output'}
                          >
                            {line}
                          </TerminalLine>
                        ))
                      )
                    }
                  />
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------------------- the costs */}
            {pane === 'costs' && (
              <div {...tabPanelProps('advanced-panel-costs')} dir={dir} data-testid="advanced-costs">
                <Panel title={t('advanced.costs_label', {}, locale)} label={t('advanced.costs_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    {budget === null ? (
                      <Lamp state="idle" size="sm">
                        {`${t('bench.budget_used', {}, locale)}: ${t('bench.not_reported', {}, locale)}`}
                      </Lamp>
                    ) : (
                      <Meter
                        value={Number(budget.spentUsd.toFixed(2))}
                        max={Number(budget.totalBudgetUsd.toFixed(2))}
                        label={t('bench.budget_used', {}, locale)}
                      >
                        {`${money(budget.spentUsd)} / ${money(budget.totalBudgetUsd)}`}
                      </Meter>
                    )}
                    <Chip glyph="$" label={`${t('advanced.cost_spent', {}, locale)} — ${money(spentCents / 100)}`}>
                      <span style={{ fontFamily: 'var(--warsha-font-mono)' }}>{money(spentCents / 100)}</span>
                    </Chip>
                    <Chip glyph="·" label={`${t('advanced.cost_remaining', {}, locale)} — ${budget === null ? t('bench.not_reported', {}, locale) : money(budget.remainingUsd)}`}>
                      <span style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                        {budget === null ? '—' : money(budget.remainingUsd)}
                      </span>
                    </Chip>
                  </Box>

                  <p dir={dir} style={{ margin: 0, marginBlockStart: 'var(--warsha-space-3)', fontWeight: 'var(--warsha-font-weight-semibold)' }}>
                    {t('advanced.cost_by_role', {}, locale)}
                  </p>

                  {lanes.length === 0 ? (
                    <Lamp state="idle" size="sm">
                      {t('advanced.cost_none', {}, locale)}
                    </Lamp>
                  ) : (
                    <Ledger label={t('advanced.cost_by_role', {}, locale)} style={{ borderBlockStart: 'none' }}>
                      {lanes.map((lane) => (
                        <Ledger.Row key={lane.key} meta={`$${(lane.costCents / 100).toFixed(4)}`}>
                          <Lamp state={laneLamp(lane)} size="sm">
                            {roleWord(lane, locale)}
                          </Lamp>
                        </Ledger.Row>
                      ))}
                    </Ledger>
                  )}
                </Panel>
              </div>
            )}

            {/* --------------------------------------------------------------------------- the ship */}
            {pane === 'ship' && (
              <div {...tabPanelProps('advanced-panel-ship')} dir={dir} data-testid="advanced-ship">
                <Panel title={t('advanced.ship_label', {}, locale)} label={t('advanced.ship_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  <Box dir={dir} style={{ display: 'grid', gap: 'var(--warsha-space-4)', minInlineSize: 0 }}>
                    <StatusStrip stages={deliveryStages} />
                    <ReleasePreflight
                      checks={checks}
                      disabled={false}
                      onRun={() => {
                        // TODO(M20 wiring): the delivery checks run in CI and the daemon has no preflight RPC
                        // yet, so this records the owner's intent instead of claiming to have run them (§7).
                        setDeployStatus('idle');
                      }}
                    />
                    <WebDeployButton
                      disabled={!preflightReady(checks)}
                      status={deployStatus}
                      onDeploy={() => {
                        // TODO(M20 wiring): the deploy RPC is not wired; the button reports intent only.
                        setDeployStatus('deploying');
                      }}
                    />
                    <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)' }}>
                      {t('status_strip.deploy.local_only', {}, locale)}
                    </p>
                  </Box>
                </Panel>
              </div>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}
