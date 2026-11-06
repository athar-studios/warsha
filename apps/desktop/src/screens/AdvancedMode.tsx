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
// `runs.events`, `budget.show` and the `/events` socket — nothing here pretends at an RPC the daemon
// does not have.
import {
  subscribeEvents,
  type AgentTodo,
  type BudgetStatus,
  type FileContent,
  type FileEntry,
  type GateSummary,
  type HarnessDefinition,
  type PluginDefinition,
  type ProjectSummary,
  type Role,
  type RunSummary,
  type SkillDefinition,
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
  FastModeToggle,
  Lamp,
  Ledger,
  Meter,
  ModelPicker,
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
import type { DaemonEndpoint } from '../daemon';
import { DATE_FALLBACK, parseSafeDate } from '../date';

interface AdvancedModeProps {
  client: WarshaClient;
  project: ProjectSummary;
  onBack?: () => void;
  /**
   * The endpoint the shell resolved from the Tauri config
   * (`apps/desktop/src/daemon.ts`).
   *
   * The event stream opens on `eventsUrl` — the `/events` endpoint as the shell reports it, a
   * `ws:` URL on the daemon's HTTP listener, which is *not* the RPC base `baseUrl` — and
   * authenticates with `token`, the session's own credential. This screen names no port and no
   * secret of its own, and derives no socket URL from the RPC base: the events port is a
   * different listener and cannot be guessed from it.
   */
  endpoint: DaemonEndpoint;
  /**
   * The shell's mode switch (Dual-Mode factory): pressing it drops the owner from the Complex
   * workbench back to the Hard autonomous factory. Optional, because a screen rendered outside
   * the shell — a story, a test — has no shell to switch.
   */
  onModeChange?: (mode: 'simple' | 'advanced') => void;
}

/** Which pane the side column shows. */
type AdvancedPane = 'board' | 'code' | 'plan' | 'stream' | 'files' | 'diff' | 'terminal' | 'costs' | 'ship';

const ADVANCED_PANES: readonly AdvancedPane[] = [
  'board',
  'code',
  'plan',
  'stream',
  'files',
  'diff',
  'terminal',
  'costs',
  'ship',
];

/** Which subset of the event stream the owner asked for (§3's filter chips). */
type StreamFilter = 'all' | 'tools' | 'errors' | 'costs' | 'gates';

const STREAM_FILTERS: readonly StreamFilter[] = ['all', 'tools', 'errors', 'costs', 'gates'];

/**
 * The subagent swarm matrix (Complex Mode): every pipeline role gets a row whatever the stream says,
 * so the owner reads the whole factory, not only the lanes that happened to emit an event.
 */
const SWARM_ROLES: readonly Role[] = [
  'intake',
  'researcher',
  'pm',
  'designer',
  'architect',
  'coder',
  'reviewer',
  'qa',
  'security',
  'release',
  'marketer',
  'feedback',
];

/**
 * The model each role is routed to when the daemon reports no routing for it. `roles.list` overrides
 * this row by row (the effect below reads the real table); the standing assignment is the factory's
 * own default and never claims to be the daemon's answer (§7).
 */
const ROLE_MODEL_FIXTURE: Record<Role, string> = {
  intake: 'DeepSeek V3',
  researcher: 'Claude 3.5 Sonnet',
  pm: 'GPT-4o',
  designer: 'Claude 3.5 Sonnet',
  architect: 'Claude 3.5 Sonnet',
  coder: 'DeepSeek V3',
  reviewer: 'GPT-4o',
  qa: 'DeepSeek V3',
  security: 'GPT-4o',
  release: 'DeepSeek V3',
  marketer: 'GPT-4o',
  feedback: 'Ollama',
};

/** The pipeline's stage order — the plan the run walks, gate steps included. */
const RUN_STAGE_ORDER: readonly string[] = [
  'idea',
  'gate_a',
  'research',
  'prd_spec',
  'gate_b',
  'design',
  'plan_tasks',
  'code',
  'review_qa_security',
  'gate_c',
  'release',
  'gate_d',
  'launch_drafts',
  'feedback',
];

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

/**
 * The stage's word: the four gates keep their own labels, the pipeline stages read from `run.stage.*`.
 *
 * A stage the daemon has not reported (`undefined`, `null`, `''`) is said in words — the bench's own
 * `bench.not_reported` — and never reaches `stage.startsWith`, which threw on a non-string and blacked
 * the render.
 */
function stageWord(stage: string | null | undefined, locale: Locale): string {
  if (typeof stage !== 'string' || stage.length === 0) {
    return t('bench.not_reported', {}, locale);
  }
  return t(stage.startsWith('gate_') ? `gates.label.${stage}` : `run.stage.${stage}`, {}, locale);
}

/** The run states the bench names; anything else is the daemon's own word, in mono. */
export function runStateWord(status: string, locale: Locale): string {
  // `awaiting_gate` is the state the daemon puts a run in when it stops for the owner's decision. It is
  // not an unknown word to be printed raw: a snake_case wire name inside an Arabic ledger row breaks §11's
  // rule that a machine fragment never sits bare in an Arabic sentence.
  const known = ['running', 'awaiting_gate', 'completed', 'failed'];
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
 * The `/events` socket is opened from the shell's resolved `endpoint.eventsUrl` — see
 * `AdvancedModeProps`. There is deliberately no URL-deriving helper here: the http→ws scheme
 * conversion lives in one place (`eventEndpoint` in `@warsha/client`, under `subscribeEvents`),
 * and the events port is a different listener from the RPC base, so it is read from the shell,
 * never derived.
 */

/** `$4.20` — Western digits, two decimals, mono upstream (§11). */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Whether `budget.show` named a ceiling. `@warsha/client` folds the daemon's `null` cents into the `0`
 * that `BudgetStatus` declares, so a zero here means "no ceiling reported" and prints words, never the
 * `$0.00` that would read as "the cap is spent" (§7).
 */
function hasCeiling(totalUsd: number): boolean {
  return totalUsd > 0;
}

/** The six release checks before any of them has run. */
function pendingChecks(): PreflightCheck[] {
  return preflightCheckNames.map((name) => ({ name, status: 'pending' as const }));
}

/** Folders first, then files, each by name — the tree the owner scans top-down. */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The last path segment, for a row whose name the daemon left empty. */
function entryName(entry: FileEntry): string {
  return entry.name.length > 0 ? entry.name : (entry.path.split('/').filter(Boolean).pop() ?? entry.path);
}

/** One directory's listing and whether it came back (§7: the three readings, in words). */
interface FolderListing {
  state: 'loading' | 'ready' | 'failed';
  entries: FileEntry[];
}

interface TreeProps {
  client: WarshaClient;
  projectId: string;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
  locale: Locale;
  dir: 'rtl' | 'ltr';
}

/**
 * One folder row in the workspace tree (Complex Mode's left rail).
 *
 * The listing is fetched lazily on the first expand — `files.tree` answers one directory at a time,
 * and a tree that walked the whole repo on mount would page the daemon for a folder nobody opened.
 */
function FolderNode({
  entry,
  depth,
  tree,
}: { entry: FileEntry; depth: number; tree: TreeProps }) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<FolderListing | null>(null);
  // One read per folder, kept in a ref rather than in the effect's dependencies: a `listing` dep
  // would cancel the very fetch that sets it, and the folder would freeze in "loading".
  const fetchedRef = useRef(false);
  const { client, projectId } = tree;

  useEffect(() => {
    if (!open || fetchedRef.current) return undefined;
    fetchedRef.current = true;
    if (typeof client.getFilesTree !== 'function') {
      setListing({ state: 'failed', entries: [] });
      return undefined;
    }
    let cancelled = false;
    setListing({ state: 'loading', entries: [] });
    client
      .getFilesTree(projectId, entry.path)
      .then((entries) => {
        if (!cancelled) setListing({ state: 'ready', entries });
      })
      .catch(() => {
        if (!cancelled) setListing({ state: 'failed', entries: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [open, client, projectId, entry.path]);

  const label = entryName(entry);
  const toggleWord = t(open ? 'advanced.tree_collapse' : 'advanced.tree_expand', {}, tree.locale);

  return (
    <div style={{ minInlineSize: 0 }} data-testid={`advanced-tree-dir-${entry.path}`}>
      <button
        type="button"
        dir={tree.dir}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--warsha-space-2)',
          inlineSize: '100%',
          paddingInlineStart: `calc(var(--warsha-space-2) + ${depth} * var(--warsha-space-3))`,
          paddingInlineEnd: 'var(--warsha-space-2)',
          paddingBlock: 'var(--warsha-space-1)',
          background: 'none',
          border: 'none',
          color: 'var(--warsha-color-text)',
          fontFamily: 'var(--warsha-font-mono)',
          fontSize: 'var(--warsha-font-size-xs)',
          cursor: 'pointer',
          textAlign: 'start',
          minInlineSize: 0,
        }}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>{label}</span>
        <span className="warsha-visually-hidden" style={{ position: 'absolute', overflow: 'hidden', clipPath: 'inset(50%)' }}>
          {toggleWord}
        </span>
      </button>
      {open && (
        <div>
          {listing === null || listing.state === 'loading' ? (
            <Skeleton label={t('advanced.tree_loading', {}, tree.locale)} lines={1} quiet />
          ) : listing.state === 'failed' ? (
            <p dir={tree.dir} style={{ margin: 0, paddingInlineStart: `calc(var(--warsha-space-2) + ${depth + 1} * var(--warsha-space-3))`, fontSize: 'var(--warsha-font-size-xs)' }}>
              {t('advanced.tree_failed', {}, tree.locale)}
            </p>
          ) : listing.entries.length === 0 ? (
            <p dir={tree.dir} style={{ margin: 0, paddingInlineStart: `calc(var(--warsha-space-2) + ${depth + 1} * var(--warsha-space-3))`, fontSize: 'var(--warsha-font-size-xs)' }}>
              {t('advanced.tree_empty', {}, tree.locale)}
            </p>
          ) : (
            <TreeRows entries={listing.entries} depth={depth + 1} tree={tree} />
          )}
        </div>
      )}
    </div>
  );
}

/** One file row: the press reads the file and opens it in the code tab. */
function FileNode({
  entry,
  depth,
  tree,
}: { entry: FileEntry; depth: number; tree: TreeProps }) {
  const selected = tree.selectedPath === entry.path;
  return (
    <button
      type="button"
      dir={tree.dir}
      data-testid={`advanced-tree-file-${entry.path}`}
      aria-pressed={selected}
      onClick={() => tree.onSelectFile(entry.path)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--warsha-space-2)',
        inlineSize: '100%',
        paddingInlineStart: `calc(var(--warsha-space-2) + ${depth} * var(--warsha-space-3))`,
        paddingInlineEnd: 'var(--warsha-space-2)',
        paddingBlock: 'var(--warsha-space-1)',
        background: selected ? 'var(--warsha-color-surface)' : 'none',
        border: 'none',
        borderInlineStart: selected
          ? 'var(--warsha-size-edge) solid var(--warsha-signal-text)'
          : 'var(--warsha-size-edge) solid transparent',
        color: 'var(--warsha-color-text)',
        fontFamily: 'var(--warsha-font-mono)',
        fontSize: 'var(--warsha-font-size-xs)',
        cursor: 'pointer',
        textAlign: 'start',
        minInlineSize: 0,
      }}
    >
      <span aria-hidden="true">·</span>
      <span>{entryName(entry)}</span>
    </button>
  );
}

/** The rows of one folder listing: folders first, then files, recursively. */
function TreeRows({ entries, depth, tree }: { entries: FileEntry[]; depth: number; tree: TreeProps }) {
  return (
    <div style={{ minInlineSize: 0 }}>
      {sortEntries(entries)
        .filter((entry) => entry.path.length > 0)
        .map((entry) =>
          entry.isDir ? (
            <FolderNode key={entry.path} entry={entry} depth={depth} tree={tree} />
          ) : (
            <FileNode key={entry.path} entry={entry} depth={depth} tree={tree} />
          )
        )}
    </div>
  );
}

interface WorkspaceTreeProps extends TreeProps {
  /** The rail's own heading word, so the panel keeps the bench's voice. */
  heading: string;
  testId?: string;
}

/**
 * The workspace file tree (Complex Mode's left rail): the daemon answers `files.tree` one directory
 * at a time, so the root loads on mount and every folder loads its children on first expand.
 */
function WorkspaceTree({ heading, ...tree }: WorkspaceTreeProps) {
  const [root, setRoot] = useState<FolderListing | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof tree.client.getFilesTree !== 'function') {
      setRoot({ state: 'failed', entries: [] });
      return undefined;
    }
    setRoot({ state: 'loading', entries: [] });
    tree.client
      .getFilesTree(tree.projectId, '')
      .then((entries) => {
        if (!cancelled) setRoot({ state: 'ready', entries });
      })
      .catch(() => {
        if (!cancelled) setRoot({ state: 'failed', entries: [] });
      });
    return () => {
      cancelled = true;
    };
    // The root listing belongs to the client and the project only: the tree re-reads when the
    // bench opens another project, not when the owner scrolls or picks a file.
  }, [tree.client, tree.projectId]);

  return (
    <Panel
      title={heading}
      label={heading}
      style={{ borderBlockEnd: 'none', minInlineSize: 0 }}
    >
      <div data-testid={tree.testId ?? 'advanced-files-tree'} dir={tree.dir} style={{ minInlineSize: 0 }}>
        {root === null || root.state === 'loading' ? (
          <Skeleton label={t('advanced.tree_loading', {}, tree.locale)} lines={3} variant="row" />
        ) : root.state === 'failed' ? (
          <p dir={tree.dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
            {t('advanced.tree_failed', {}, tree.locale)}
          </p>
        ) : root.entries.length === 0 ? (
          <p dir={tree.dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
            {t('advanced.tree_empty', {}, tree.locale)}
          </p>
        ) : (
          <TreeRows entries={root.entries} depth={0} tree={tree} />
        )}
      </div>
    </Panel>
  );
}

export function AdvancedMode({ client, project, onBack, endpoint, onModeChange }: AdvancedModeProps) {
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
  // ---------------------------------------------------------------- dual-mode factory state
  // The active harness/skill/plugin context pills, the workspace tree's selected file and its
  // content, the run-control bar's follow-up draft, and the swarm's collapse. None of these
  // changes the pipeline (§3): they are the workbench's own reading and controls.
  const [context, setContext] = useState<{
    harnesses: HarnessDefinition[];
    skills: SkillDefinition[];
    plugins: PluginDefinition[];
  } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileReading, setFileReading] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [followupDraft, setFollowupDraft] = useState('');
  const [controlFailed, setControlFailed] = useState(false);
  const [runsNonce, setRunsNonce] = useState(0);
  const [swarmOpen, setSwarmOpen] = useState(true);
  // The model each role is actually routed to, read from `roles.list`. A daemon that does not answer
  // (or a role nobody routed) keeps the standing assignment below, which is the factory's own default
  // and not a claim about the daemon (§7).
  const [roleModels, setRoleModels] = useState<Partial<Record<Role, string>>>({});
  // Work protection (M14a) and the agent workflow (M18): per-session choices the owner sets here.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask_for_risky');
  const [agentMode, setAgentMode] = useState<AgentMode>('plan');
  const [runMode] = useState<RunMode>('local');
  const [fastModeTier, setFastModeTier] = useState<'thorough' | 'balanced' | 'fast'>('balanced');
  const [advancedModelId, setAdvancedModelId] = useState<string>('deepseek-v3');
  // Queue indicator: pending gates for the selected run.
  const [pendingGates, setPendingGates] = useState<GateSummary[]>([]);
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
        // Keep the selected run across a refresh: the run-control buttons re-read the same run
        // the owner was watching, not silently jump to the newest row.
        setRun((current) => {
          if (current !== null && list.some((candidate) => candidate.id === current.id)) {
            return list.find((candidate) => candidate.id === current.id) ?? current;
          }
          return list[0] ?? null;
        });
        setRunsState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setRunsState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [client, project.id, runsNonce]);

  // Load pending gates for the selected run (queue indicator).
  useEffect(() => {
    let cancelled = false;
    if (run === null) {
      setPendingGates([]);
      return undefined;
    }
    client
      .getGates(run.id)
      .then((gates) => {
        if (cancelled) return;
        setPendingGates(gates.filter((gate) => gate.state.state === 'pending'));
      })
      .catch(() => {
        // Ignore errors; pendingGates stays empty
      });
    return () => {
      cancelled = true;
    };
  }, [client, run]);

  // The loaded factory context (Complex Mode rail): what harness is driving, which skills are on,
  // which plugins are installed. `harness.list` / `skills.list` / `plugins.list` are Wave 2 reads —
  // a client without them simply has nothing to report (§7: the plate then says so in words).
  useEffect(() => {
    let cancelled = false;
    const hasReads =
      typeof client.listHarnesses === 'function' ||
      typeof client.listSkills === 'function' ||
      typeof client.listPlugins === 'function';
    if (!hasReads) {
      setContext(null);
      return undefined;
    }
    Promise.all([
      typeof client.listHarnesses === 'function' ? client.listHarnesses() : Promise.resolve([]),
      typeof client.listSkills === 'function' ? client.listSkills() : Promise.resolve([]),
      typeof client.listPlugins === 'function' ? client.listPlugins() : Promise.resolve([]),
    ])
      .then(([harnesses, skills, plugins]) => {
        if (cancelled) return;
        const active = harnesses.find((h) => h.active);
        if (active) {
          setActiveId(active.id);
        }
        setContext({
          harnesses,
          skills: skills.filter((skill) => skill.enabled),
          plugins: plugins.filter((plugin) => plugin.enabled),
        });
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // The role → model table the daemon is honouring (`roles.list`), so the swarm's model column is a
  // reading, not a fixture. A refusal leaves the standing assignment in place and says nothing extra.
  useEffect(() => {
    if (typeof client.listRoleRoutings !== 'function') return undefined;
    let cancelled = false;
    client
      .listRoleRoutings()
      .then((rows) => {
        if (cancelled) return;
        const next: Partial<Record<Role, string>> = {};
        for (const row of rows) {
          const target = row.targets[0];
          if (target !== undefined) next[row.role] = `${target.provider_id}/${target.model_id}`;
        }
        setRoleModels(next);
      })
      .catch(() => {
        if (!cancelled) setRoleModels({});
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

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
      url: endpoint.eventsUrl,
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
  }, [endpoint.eventsUrl, endpoint.token, run, streamNonce]);

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

  /**
   * The subagent swarm matrix: every role, its lamp, its model and what it spent.
   *
   * The lamp is folded from the role's lane (§9: state in words and glyph, never colour alone):
   * waiting when a gate holds the lane, working while it streams, done when the run completed with
   * the lane present, idle when the lane never spoke.
   */
  const swarm = useMemo(
    () =>
      SWARM_ROLES.map((role) => {
        const lane = lanes.find((candidate) => candidate.role === role) ?? null;
        let state: LampState = 'idle';
        if (lane !== null) {
          if (lane.waiting) state = 'waiting';
          else if (lane.failed) state = 'fail';
          else if (run?.status === 'completed') state = 'ok';
          else state = 'working';
        }
        return {
          role,
          state,
          model: roleModels[role] ?? ROLE_MODEL_FIXTURE[role],
          events: lane?.events ?? 0,
          costCents: lane?.costCents ?? 0,
        };
      }),
    [lanes, roleModels, run]
  );

  /** `14:22:07.318` — Arabic keeps 0–9 so two lines of a feed compare (§11). */
  const formatTime = useCallback(
    (iso: unknown) => {
      // `parseSafeDate` first: an unparseable feed timestamp falls back to the dash instead of
      // throwing `RangeError: Invalid time value` out of `Intl.format` and blacking the pane.
      const date = parseSafeDate(iso);
      if (date === null) return DATE_FALLBACK;
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
      }).format(date);
    },
    [locale]
  );

  /** `2026-10-05 07:15` in UTC, so a run's start reads the same in every timezone. */
  const formatStart = useCallback((iso: unknown) => {
    const date = parseSafeDate(iso);
    if (date === null) return DATE_FALLBACK;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }, []);

  // ------------------------------------------------------------- the workspace file reader
  /** Press a tree row: read the file (`files.read`) and open it in the code tab. */
  const openFile = useCallback(
    (path: string) => {
      setSelectedFilePath(path);
      setPane('code');
      if (typeof client.readFileContent !== 'function') {
        setFileContent(null);
        setFileReading('failed');
        return;
      }
      setFileReading('loading');
      setFileContent(null);
      client
        .readFileContent(project.id, path)
        .then((content) => {
          setFileContent(content);
          setFileReading('ready');
        })
        .catch(() => {
          setFileReading('failed');
        });
    },
    [client, project.id]
  );

  // --------------------------------------------------------------------- the run-control bar
  /**
   * Send one run control to the daemon (`runs.advance`, `runs.cancel`, `runs.followup`).
   *
   * The control is the owner's supervisory hand on a live run, so a failed RPC says so inline and
   * keeps the buttons (§7) — the run never swallows a press. A success re-reads the run list: the
   * bench shows the state the daemon moved the run to.
   */
  const sendControl = useCallback(
    async (kind: 'advance' | 'cancel' | 'followup') => {
      if (run === null) return;
      setControlFailed(false);
      try {
        if (kind === 'advance') {
          await client.advanceRun(run.id);
        } else if (kind === 'cancel') {
          await client.cancelRun(run.id);
        } else {
          const text = followupDraft.trim();
          if (text === '') return;
          await client.followupRun(run.id, text);
          setFollowupDraft('');
        }
        setRunsNonce((nonce) => nonce + 1);
      } catch {
        setControlFailed(true);
      }
    },
    [client, run, followupDraft]
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

  /**
   * The live event plate. It sits beside the panes on every tab except `stream` — the Stream tab
   * moves this same plate into the tab panel, where it gets the column, so the feed is never
   * duplicated and never hidden (§3: a filter, and a tab, may not swallow a gate event).
   */
  const streamPlate = (
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
                {/*
                  Only the daemon's own kind name is machine data, so only it is isolated LTR. The
                  stage beside it is the catalog's word (`البحث`), and a `dir="ltr"` around the whole
                  line re-ordered it for an Arabic reader and pinned the word to the wrong edge (§11:
                  an embedded fragment sits in its own isolated span, never bare and never wider).
                */}
                <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate' }}>
                  {event.kind}
                </span>
                {` · ${stageWord(event.stage, locale)}`}
                {event.costCents !== null && ` · $${(event.costCents / 100).toFixed(4)}`}
              </Stream.Line>
            ))}
          </Stream>
        </div>
      )}
    </Panel>
  );

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
        {onModeChange && (
          // One click back down the ladder: the Complex workbench hands the owner to the Hard
          // autonomous factory without losing the project (§3 — the switch changes depth only).
          <Button
            variant="secondary"
            size="sm"
            dir={dir}
            data-testid="advanced-mode-toggle"
            onClick={() => onModeChange('simple')}
          >
            {t('advanced.switch_to_hard', {}, locale)}
          </Button>
        )}
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
          {/* The loaded factory context (Complex Mode): what harness drives, which skills are on,
              which plugins are installed — the pills the owner reads before trusting a run. */}
          <Panel
            title={t('advanced.context_label', {}, locale)}
            label={t('advanced.context_label', {}, locale)}
            style={{ borderBlockEnd: 'none', minInlineSize: 0 }}
          >
            <div
              dir={dir}
              data-testid="advanced-context"
              style={{ display: 'flex', gap: 'var(--warsha-space-2)', flexWrap: 'wrap', minInlineSize: 0 }}
            >
              {context === null ? (
                <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
                  {t('advanced.context_none', {}, locale)}
                </p>
              ) : (
                <>
                  {context.harnesses.map((harness) => (
                    <Chip
                      key={`harness-${harness.id}`}
                      tone={harness.active || harness.id === activeId ? 'lit' : 'default'}
                      glyph="⌗"
                      label={`${t('advanced.context_harness', {}, locale)} — ${harness.name}`}
                    >
                      <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontFamily: 'var(--warsha-font-mono)' }}>
                        {harness.name}
                      </span>
                    </Chip>
                  ))}
                  {context.skills.map((skill) => (
                    <Chip
                      key={`skill-${skill.id}`}
                      glyph="✦"
                      label={`${t('advanced.context_skill', {}, locale)} — ${skill.name}`}
                    >
                      <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontFamily: 'var(--warsha-font-mono)' }}>
                        {skill.name}
                      </span>
                    </Chip>
                  ))}
                  {context.plugins.map((plugin) => (
                    <Chip
                      key={`plugin-${plugin.id}`}
                      glyph="⛨"
                      label={`${t('advanced.context_plugin', {}, locale)} — ${plugin.name}`}
                    >
                      <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontFamily: 'var(--warsha-font-mono)' }}>
                        {plugin.name}
                      </span>
                    </Chip>
                  ))}
                  {context.harnesses.length === 0 && context.skills.length === 0 && context.plugins.length === 0 && (
                    <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
                      {t('advanced.context_none', {}, locale)}
                    </p>
                  )}
                </>
              )}
            </div>
          </Panel>

          {/* The workspace file tree: `files.tree` per folder, a file press reads `files.read`. */}
          <WorkspaceTree
            heading={t('advanced.tree_label', {}, locale)}
            client={client}
            projectId={project.id}
            onSelectFile={openFile}
            selectedPath={selectedFilePath}
            locale={locale}
            dir={dir}
          />

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
          {pane !== 'stream' ? streamPlate : null}

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

            {/* ------------------------------------------------------------------ the code viewer */}
            {pane === 'code' && (
              <div {...tabPanelProps('advanced-panel-code')} dir={dir} data-testid="advanced-code-pane">
                <Panel title={t('advanced.code_label', {}, locale)} label={t('advanced.code_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  {selectedFilePath === null ? (
                    <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-sm)' }}>
                      {t('advanced.code_empty', {}, locale)}
                    </p>
                  ) : fileReading === 'loading' ? (
                    <Skeleton label={t('advanced.code_loading', {}, locale)} lines={4} variant="row" />
                  ) : fileReading === 'failed' || fileContent === null ? (
                    <Lamp state="fail" size="sm">
                      {t('advanced.code_failed', {}, locale)}
                    </Lamp>
                  ) : (
                    <Box dir={dir} style={{ display: 'flex', gap: 'var(--warsha-space-3)', flexWrap: 'wrap', minInlineSize: 0 }}>
                      <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontFamily: 'var(--warsha-font-mono)', fontSize: 'var(--warsha-font-size-xs)' }}>
                        {fileContent.path}
                      </span>
                      <span dir={dir} style={{ fontSize: 'var(--warsha-font-size-xs)', fontFamily: 'var(--warsha-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                        {t('advanced.code_lines', { count: fileContent.content.split('\n').length }, locale)}
                      </span>
                      <span dir={dir} style={{ fontSize: 'var(--warsha-font-size-xs)' }}>
                        {`${t('advanced.code_language', {}, locale)}: `}
                        <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', fontFamily: 'var(--warsha-font-mono)' }}>
                          {fileContent.mimeType}
                        </span>
                      </span>
                    </Box>
                  )}
                  {selectedFilePath !== null && fileReading === 'ready' && fileContent !== null && (
                    <div
                      dir="ltr"
                      translate="no"
                      data-testid="advanced-code-lines"
                      style={{
                        marginBlockStart: 'var(--warsha-space-3)',
                        fontFamily: 'var(--warsha-font-mono)',
                        fontSize: 'var(--warsha-font-size-xs)',
                        fontVariantNumeric: 'tabular-nums',
                        backgroundColor: 'var(--warsha-color-bg)',
                        border: 'var(--warsha-size-rule) solid var(--warsha-bench-rule)',
                        borderRadius: 'var(--warsha-radius-sm)',
                        padding: 'var(--warsha-space-3)',
                        overflowX: 'auto',
                        minInlineSize: 0,
                        whiteSpace: 'pre',
                      }}
                    >
                      {fileContent.content.split('\n').map((line, index) => (
                        <div key={index} data-testid={`advanced-code-line-${index + 1}`}>
                          <span style={{ display: 'inline-block', inlineSize: '4ch', color: 'var(--warsha-color-text)', textAlign: 'end', marginInlineEnd: 'var(--warsha-space-3)' }}>
                            {index + 1}
                          </span>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {/* ------------------------------------------------------------------------ the plan */}
            {pane === 'plan' && (
              <div {...tabPanelProps('advanced-panel-plan')} dir={dir} data-testid="advanced-plan-pane">
                <Panel title={t('advanced.plan_label', {}, locale)} label={t('advanced.plan_label', {}, locale)} style={{ minInlineSize: 0 }}>
                  <p dir={dir} style={{ margin: 0, fontSize: 'var(--warsha-font-size-xs)' }}>
                    {t('advanced.plan_hint', {}, locale)}
                  </p>
                  {run === null ? (
                    <p dir={dir} style={{ margin: 0, marginBlockStart: 'var(--warsha-space-3)', fontSize: 'var(--warsha-font-size-sm)' }}>
                      {t('bench.no_run', {}, locale)}
                    </p>
                  ) : (
                    <div style={{ marginBlockStart: 'var(--warsha-space-2)' }}>
                      {RUN_STAGE_ORDER.map((stage) => {
                        const active = stage === run.stage;
                        const passed = RUN_STAGE_ORDER.indexOf(stage) < RUN_STAGE_ORDER.indexOf(run.stage);
                        return (
                          <div
                            key={stage}
                            dir={dir}
                            data-testid={`advanced-plan-stage-${stage}`}
                            data-state={active ? 'active' : passed ? 'passed' : 'pending'}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--warsha-space-2)',
                              paddingBlock: 'var(--warsha-space-1)',
                              borderBlockEnd: '1px solid var(--warsha-bench-rule)',
                              fontWeight: active ? 'var(--warsha-font-weight-bold)' : 'var(--warsha-font-weight-normal)',
                              minInlineSize: 0,
                            }}
                          >
                            <Lamp state={active ? 'working' : passed ? 'ok' : 'idle'} size="xs" bare>
                              {active ? '▶' : passed ? '✓' : '·'}
                            </Lamp>
                            <span style={{ fontSize: 'var(--warsha-font-size-sm)' }}>{stageWord(stage, locale)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {/* ---------------------------------------------------------------------- the stream tab */}
            {pane === 'stream' && (
              <div {...tabPanelProps('advanced-panel-stream')} dir={dir} data-testid="advanced-stream-pane">
                {streamPlate}
              </div>
            )}

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
                  <WorkspaceTree
                    heading={t('advanced.tree_label', {}, locale)}
                    client={client}
                    projectId={project.id}
                    onSelectFile={openFile}
                    selectedPath={selectedFilePath}
                    locale={locale}
                    dir={dir}
                    testId="advanced-files-pane-tree"
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
                  {/* The interactive run control bar (`runs.advance`, `runs.cancel`, `runs.followup`).
                      It sits beside the dock, never inside it: the dock's transcript stays the run's
                      own log, and these are the owner's supervisory presses on the run object —
                      `runs.followup` is an instruction to the agent, not a shell command, so §6's
                      "the interface does not execute commands" rule survives word for word. */}
                  <div
                    dir={dir}
                    role="group"
                    aria-label={t('advanced.controls_label', {}, locale)}
                    data-testid="advanced-run-controls"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 'var(--warsha-space-2)',
                      flexWrap: 'wrap',
                      marginBlockStart: 'var(--warsha-space-2)',
                      minInlineSize: 0,
                    }}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      dir={dir}
                      data-testid="run-advance"
                      disabled={run === null}
                      onClick={() => void sendControl('advance')}
                    >
                      {t('advanced.run_advance', {}, locale)}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      dir={dir}
                      data-testid="run-cancel"
                      disabled={run === null}
                      onClick={() => void sendControl('cancel')}
                    >
                      {t('advanced.run_cancel', {}, locale)}
                    </Button>
                    <form
                      dir={dir}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void sendControl('followup');
                      }}
                      style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--warsha-space-2)', flex: '1', minWidth: 0 }}
                    >
                      <label
                        htmlFor="advanced-followup-input"
                        style={{
                          position: 'absolute',
                          inlineSize: 'var(--warsha-size-rule)',
                          blockSize: 'var(--warsha-size-rule)',
                          overflow: 'hidden',
                          clipPath: 'inset(50%)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('advanced.run_followup_label', {}, locale)}
                      </label>
                      <input
                        id="advanced-followup-input"
                        data-testid="run-followup-input"
                        dir={dir}
                        value={followupDraft}
                        placeholder={t('advanced.run_followup_placeholder', {}, locale)}
                        onChange={(event) => setFollowupDraft(event.target.value)}
                        style={{
                          flex: '1',
                          minWidth: 0,
                          fontFamily: 'inherit',
                          fontSize: 'var(--warsha-font-size-sm)',
                          color: 'var(--warsha-color-text)',
                          backgroundColor: 'var(--warsha-bench-plate)',
                          border: '1px solid var(--warsha-bench-edge)',
                          borderRadius: 'var(--warsha-radius-sm)',
                          paddingInline: 'var(--warsha-space-3)',
                          paddingBlock: 'var(--warsha-space-2)',
                          minBlockSize: 'var(--warsha-size-touch)',
                        }}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        dir={dir}
                        data-testid="run-followup-send"
                        disabled={followupDraft.trim() === '' || run === null}
                      >
                        {t('advanced.run_followup_send', {}, locale)}
                      </Button>
                      <FastModeToggle
                        tier={fastModeTier}
                        onChange={setFastModeTier}
                        label={t(`composer.fast_mode.tier.${fastModeTier}`, {}, locale)}
                        hint={t(`composer.fast_mode.hint.${fastModeTier}`, {}, locale)}
                        dir={dir}
                      />
                      <ModelPicker
                        selectedId={advancedModelId}
                        options={[
                          { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek' },
                          { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
                          { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
                          { id: 'ollama', name: 'Ollama', provider: 'Ollama' },
                        ]}
                        onChange={setAdvancedModelId}
                        dir={dir}
                        ariaLabel={t('composer.model_picker.label', { model: advancedModelId }, locale)}
                      />
                      {pendingGates.length > 0 && (
                        <Chip tone="lit" glyph="!" label={t('simple.pending_gates', {}, locale)}>
                          {pendingGates.length}
                        </Chip>
                      )}
                      <PermissionModeChip mode={permissionMode} onChange={setPermissionMode} />
                      <PlanModeBadge mode={agentMode} onToggle={setAgentMode} />
                    </form>
                    {controlFailed && (
                      <span role="alert" dir={dir} style={{ fontSize: 'var(--warsha-font-size-xs)', color: 'var(--warsha-color-text)' }}>
                        {t('advanced.run_control_failed', {}, locale)}
                      </span>
                    )}
                  </div>
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
                    ) : !hasCeiling(budget.totalBudgetUsd) ? (
                      <Lamp state="idle" size="sm">
                        {`${t('bench.budget_used', {}, locale)}: ${money(budget.spentUsd)} · ${t('bench.no_ceiling', {}, locale)}`}
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
                    <Chip
                      glyph="·"
                      label={`${t('advanced.cost_remaining', {}, locale)} — ${
                        budget === null
                          ? t('bench.not_reported', {}, locale)
                          : !hasCeiling(budget.totalBudgetUsd)
                            ? t('bench.no_ceiling', {}, locale)
                            : money(budget.remainingUsd)
                      }`}
                    >
                      <span style={{ fontFamily: 'var(--warsha-font-mono)' }}>
                        {budget === null
                          ? '—'
                          : !hasCeiling(budget.totalBudgetUsd)
                            ? '—'
                            : money(budget.remainingUsd)}
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

        {/* ------------------------------------------------------------- the subagent swarm matrix
            The right rail of the Complex workbench: every factory role at once, each with its lamp,
            its model and what it spent. Collapsible, because the owner reads it to supervise the
            swarm, not to operate it — the rows are records, not controls. */}
        <div
          dir={dir}
          className="bench-swarm"
          data-testid="advanced-swarm"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-2)', minInlineSize: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-2)', flexWrap: 'wrap' }}>
            <RailHead>{t('advanced.swarm_label', {}, locale)}</RailHead>
            <Button
              variant="ghost"
              size="sm"
              dir={dir}
              data-testid="advanced-swarm-toggle"
              aria-expanded={swarmOpen}
              onClick={() => setSwarmOpen((open) => !open)}
            >
              {t(swarmOpen ? 'advanced.swarm_collapse' : 'advanced.swarm_expand', {}, locale)}
            </Button>
          </div>
          {swarmOpen && (
            <div data-testid="advanced-swarm-matrix">
              <p dir={dir} style={{ margin: 0, marginBlockEnd: 'var(--warsha-space-2)', fontSize: 'var(--warsha-font-size-xs)' }}>
                {t('advanced.swarm_hint', {}, locale)}
              </p>
              {swarm.map((member) => (
                <div
                  key={member.role}
                  dir={dir}
                  data-testid={`advanced-swarm-row-${member.role}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--warsha-space-2)',
                    flexWrap: 'wrap',
                    paddingBlock: 'var(--warsha-space-1)',
                    borderBlockEnd: '1px solid var(--warsha-bench-rule)',
                    minInlineSize: 0,
                  }}
                >
                  <Lamp state={member.state} size="xs">
                    {t(`role.${member.role}`, {}, locale)}
                  </Lamp>
                  <span
                    dir="ltr"
                    translate="no"
                    data-testid={`advanced-swarm-model-${member.role}`}
                    style={{
                      unicodeBidi: 'isolate',
                      fontFamily: 'var(--warsha-font-mono)',
                      fontSize: 'var(--warsha-font-size-xs)',
                    }}
                  >
                    {member.model}
                  </span>
                  <span
                    dir="ltr"
                    translate="no"
                    data-testid={`advanced-swarm-cost-${member.role}`}
                    style={{
                      unicodeBidi: 'isolate',
                      fontFamily: 'var(--warsha-font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 'var(--warsha-font-size-xs)',
                      marginInlineStart: 'auto',
                    }}
                  >
                    {`$${(member.costCents / 100).toFixed(4)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
