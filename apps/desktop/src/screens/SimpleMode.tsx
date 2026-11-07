// Simple mode — the owner's bench (PLAN.md M13, redrawn for Bench & Signal in B3-core).
//
// Three regions, exactly as REDESIGN §4 lays the bench out: the start rail (the team as a ruled ledger),
// the chat column (the transcript, the gate cards that interrupt it, and the sticky composer), and the end
// panel (the team's own summary of what it is doing). Everything is Arabic-first: the rails are placed with
// logical properties, so the same markup mirrors without a second code path (§11), and every word comes
// from `@warsha/i18n` — this file carried 11 hard-coded Arabic literals and 9 `t(...) || 'literal'`
// fallbacks before B3-core (AUDIT-1 §3.3), and a fallback is a string that never reaches the catalog.
//
// What the direction forbids, and what replaced it:
//
//   * no floating cards: the rails are plates fastened with hairlines, the transcript is ruled rows, and
//     the only raised object is the `GateCard` (§1.1);
//   * no emoji as state: an agent's state is a `Lamp` (dot + glyph + word), so it reads without colour
//     (§9). Model ids are gone too — Simple mode is the rung that shows *who* is working, not which lane
//     and not which model (§3);
//   * the signal yellow appears only where the owner is needed: the waiting lamp, the pending count, the
//     primary action, the selected row's edge (§1);
//   * machine data (counts, costs, kinds) is mono with tabular numerals; prose is the sans family (§11).
//
// The data path is untouched: `listRuns` → `getGates` for the pending gates, `subscribeEvents` for the
// activity feed, and `approveGate`/`rejectGate`/`requestChanges` for a decision. A decision that fails
// keeps its card and says so inline rather than swallowing the tap (§7).
import {
  subscribeEvents,
  type GateSummary,
  type ProjectSummary,
  type RunArtifact,
  type RunId,
  type RunSummary,
  type Stage,
  type WarshaClient,
  type WarshaEvent,
} from '@warsha/client';
import { t, useDirection, useLocale, type Locale, type MessageValues } from '@warsha/i18n';
import {
  Banner,
  Box,
  Button,
  Chip,
  ChipMeta,
  FastModeToggle,
  GateCard,
  Lamp,
  Ledger,
  ModelPicker,
  RailHead,
  RailRow,
  Skeleton,
  Stamp,
  Text,
  type GateCardLabels,
  type GateDecision,
  type LampState,
  type WorkbenchMode,
} from '@warsha/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MentionPicker, type MentionKind } from '../components/MentionPicker';
import { PermissionModeChip, type PermissionMode } from '../components/PermissionModeChip';
import { PlanModeBadge, type AgentMode } from '../components/PlanModeBadge';
import { SlashCommandPicker, type SlashCommandItem } from '../components/SlashCommandPicker';
import type { DaemonEndpoint } from '../daemon';

interface SimpleModeProps {
  client: WarshaClient;
  project: ProjectSummary;
  /**
   * The endpoint the shell resolved from the Tauri config (`apps/desktop/src/daemon.ts`).
   *
   * The event stream is built from `eventsUrl` — the address `/events` is really served on,
   * a socket URL on the daemon's HTTP listener, not the RPC base — and `token`, the session's
   * own credential. This screen names no port and no secret of its own: when the shell
   * resolved nothing the values are empty, `subscribeEvents` reports that, and the bench
   * shows its offline banner instead of pretending to connect somewhere.
   */
  endpoint: DaemonEndpoint;
  onBack?: () => void;
  /**
   * The one-click ladder switch of the dual-mode factory (Hard Mode header): pressing it hands
   * the owner from the autonomous factory up to the Complex workbench. Optional, because a screen
   * rendered outside the shell — a story, a test — has no shell to switch (§3: the switch keeps
   * the project, the run and the gates; only the depth changes).
   */
  onModeChange?: (mode: WorkbenchMode) => void;
}

interface Agent {
  id: string;
  /** The catalog key that names this role on screen (§13). */
  roleKey: string;
  status: 'idle' | 'working' | 'waiting' | 'done';
  unreadCount: number;
}

interface ChatMessage {
  id: string;
  agentId: string;
  sender: 'user' | 'agent';
  content: string;
  timestamp: string;
}

/** The lamp each team state lights. `waiting` is the only one that means "the owner is next". */
const AGENT_LAMP: Record<Agent['status'], LampState> = {
  idle: 'idle',
  working: 'working',
  waiting: 'waiting',
  done: 'ok',
};

/** The word beside each lamp, so a state is never colour alone (§9). */
const AGENT_STATE_KEY: Record<Agent['status'], string> = {
  idle: 'simple.state_idle',
  working: 'simple.state_working',
  waiting: 'simple.state_waiting',
  done: 'simple.state_done',
};

/**
 * The team as people (REDESIGN §3, rung 1): a name, one word for what they do, one of four states.
 *
 * The daemon does not report an agent roster yet, so this stays the same local fixture it was — but the
 * names moved into the catalog, because the old `ROLE_NAMES` table was thirteen Arabic/English literals
 * living in a screen.
 */
const TEAM: readonly Agent[] = [
  { id: 'orchestrator', roleKey: 'orchestrator', status: 'working', unreadCount: 2 },
  { id: 'intake', roleKey: 'intake', status: 'done', unreadCount: 0 },
  { id: 'researcher', roleKey: 'researcher', status: 'working', unreadCount: 1 },
  { id: 'pm', roleKey: 'pm', status: 'idle', unreadCount: 0 },
  { id: 'designer', roleKey: 'designer', status: 'idle', unreadCount: 0 },
  { id: 'architect', roleKey: 'architect', status: 'idle', unreadCount: 0 },
  { id: 'coder', roleKey: 'coder', status: 'idle', unreadCount: 0 },
  { id: 'reviewer', roleKey: 'reviewer', status: 'idle', unreadCount: 0 },
  { id: 'qa', roleKey: 'qa', status: 'idle', unreadCount: 0 },
  { id: 'security', roleKey: 'security', status: 'idle', unreadCount: 0 },
  { id: 'release', roleKey: 'release', status: 'idle', unreadCount: 0 },
  { id: 'marketer', roleKey: 'marketer', status: 'idle', unreadCount: 0 },
];

// --------------------------------------------------------------------------- Hard Mode: the factory
//
// The mission briefing composer, the autonomous stage matrix, the artifact shelf and the verification
// receipt (Dual-Mode Software Factory, DECISIONS 2026-11-06). The presets below are the factory's own
// vocabulary: harness ids and model names are machine data (mono, `translate="no"`), the stage words
// come from the catalog (`factory.stage.*`), and every daemon read is optional — a client that cannot
// answer says so in words rather than pretending (§7).

/** The seven harness presets the mission composer offers; the ids are the daemon's own preset names. */
export const HARNESS_PRESETS: readonly { id: string; descriptionKey: string }[] = [
  { id: 'complex-workbench', descriptionKey: 'complex-workbench' },
  { id: 'autonomous-factory', descriptionKey: 'autonomous-factory' },
  { id: 'ticket-to-pr', descriptionKey: 'ticket-to-pr' },
  { id: 'graph-gated', descriptionKey: 'graph-gated' },
  { id: 'fleet-worktrees', descriptionKey: 'fleet-worktrees' },
  { id: 'sealed-envelope', descriptionKey: 'sealed-envelope' },
  { id: 'solo-bench', descriptionKey: 'solo-bench' },
];

/** The model pills the composer offers. Names are product names: never translated (§11). */
export const FACTORY_MODELS: readonly { id: string; name: string }[] = [
  { id: 'deepseek-v3', name: 'DeepSeek V3' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'ollama', name: 'Ollama' },
];

/** The budget caps offered as pills; `$` amounts are machine data (§11). */
export const BUDGET_CAPS_USD: readonly number[] = [5, 10, 25, 50];

/** The autonomous factory's nine pipeline stages, in order. */
export const FACTORY_STAGES: readonly string[] = [
  'intake',
  'research',
  'architecture',
  'code',
  'review',
  'qa',
  'security',
  'release',
  'feedback',
];

/**
 * Map the daemon's `run.stage` onto the factory pipeline index.
 *
 * The daemon walks 14 stages; the factory matrix shows the nine the harness names. A gate rides with
 * the step it guards; a stage the map does not know reads as "before intake" (-1 → nothing lit).
 */
export function factoryStageIndex(stage: string | null | undefined): number {
  if (!stage) return -1;
  const s = stage.toLowerCase();
  // Combined review stage reads as review (4), not security — must precede substring checks.
  if (s === 'review_qa_security') {
    return 4;
  }
  if (
    s === 'security' ||
    s === 'sec' ||
    s === 'audit' ||
    s === 'strix' ||
    s.includes('security') ||
    s.includes('audit') ||
    s.includes('strix')
  ) {
    return 6;
  }
  if (
    s === 'ship' ||
    s === 'release' ||
    s === 'deploy' ||
    s === 'deliver' ||
    s.includes('ship') ||
    s.includes('release') ||
    s.includes('deploy') ||
    s.includes('deliver')
  ) {
    return 7;
  }
  if (s === 'feedback' || s.includes('feedback')) {
    return 8;
  }
  if (
    s === 'review' ||
    s === 'approval' ||
    s.includes('approval') ||
    s.includes('review')
  ) {
    return 4;
  }
  if (s === 'gate') {
    return 7;
  }
  switch (s) {
    case 'idea':
    case 'intake':
    case 'gate_a':
      return 0;
    case 'research':
      return 1;
    case 'prd_spec':
    case 'design':
    case 'plan_tasks':
    case 'architecture':
    case 'gate_b':
      return 2;
    case 'code':
      return 3;
    case 'review_qa_security':
      return 4;
    case 'gate_c':
    case 'qa':
      return 5;
    case 'gate_d':
    case 'launch_drafts':
    case 'launchdrafts':
      return 7;
    default:
      if (s.includes('gate')) return 7;
      if (s.includes('launch')) return 7;
      return -1;
  }
}

/** The shelf classifies an artifact by its name; the kinds are the factory's own outputs. */
export type ArtifactKind = 'file' | 'test' | 'diff' | 'pr' | 'build';

export function artifactKindOf(name: string): ArtifactKind {
  const lower = name.toLowerCase();
  if (/test|spec/.test(lower)) return 'test';
  if (/\.(patch|diff)$|diff/.test(lower)) return 'diff';
  if (/pr\b|pull/.test(lower)) return 'pr';
  if (/build|dist|bundle/.test(lower)) return 'build';
  return 'file';
}

/**
 * The receipt's seal: an FNV-1a digest of `runId:projectId`, printed as 16 hex characters.
 *
 * This is the bench's own integrity mark over the fields it shows — deterministic and checkable on
 * screen — not a daemon-signed certificate: `warshad` reports no signing RPC on this branch, and the
 * screen invents none (§7). The mono hex is machine data and never translates (§11).
 */
export function verificationSeal(runId: string, projectId: string): string {
  const input = `${runId}:${projectId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Sum the token counts a stream event reports, whatever field name its payload carries. */
function eventTokens(event: WarshaEvent): number {
  const payload = event.payload as Record<string, unknown> | null;
  if (payload === null || typeof payload !== 'object') return 0;
  for (const key of ['tokens', 'tokens_total', 'total_tokens', 'tokensUsed']) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/** Which autocomplete the composer offers, and what was typed after its marker. */
export interface ComposerTrigger {
  kind: 'mention' | 'slash';
  query: string;
}

/** The last whitespace-delimited token of the composer's text — the one being typed. */
function trailingToken(value: string): string {
  const match = /[^\s]*$/.exec(value);
  return match === null ? '' : match[0];
}

/**
 * The autocomplete the composer should open for `value`, or `null` for "nothing open".
 *
 * Only the token the owner is still typing counts: the `@` or `/` has to begin it, and nothing but
 * letters may follow (a `-` is allowed after a `/`, because command names like `/dry-run` exist). That
 * keeps `dev@example.com` an address, `@file:src/main.rs` an already-resolved mention, and a finished
 * `/review ` a plain word — none of them re-open a dropdown.
 */
export function composerTriggerFor(value: string): ComposerTrigger | null {
  const token = trailingToken(value);
  const mention = /^@([A-Za-z]*)$/.exec(token);
  if (mention !== null) return { kind: 'mention', query: mention[1] };
  const slash = /^\/([A-Za-z-]*)$/.exec(token);
  if (slash !== null) return { kind: 'slash', query: slash[1] };
  return null;
}

/**
 * Replace the token being typed with `insertion` plus a trailing space, so the owner can keep typing a
 * normal message after picking. Text before that token is untouched.
 */
export function insertComposerToken(value: string, insertion: string): string {
  const token = trailingToken(value);
  return `${value.slice(0, value.length - token.length)}${insertion} `;
}

/**
 * The commands the composer offers today, as catalog suffixes.
 *
 * Skills become slash commands through `SlashCommandRegistry` in the daemon, but no RPC reports them
 * yet, so this list is the composer's own placeholder — and its descriptions are catalog entries, not
 * per-locale tables in a screen.
 */
const SIMPLE_SLASH_COMMANDS: readonly { name: string; key: string }[] = [
  { name: '/review', key: 'review' },
  { name: '/refactor', key: 'refactor' },
  { name: '/test', key: 'test' },
  { name: '/docs', key: 'docs' },
  { name: '/release', key: 'release' },
];

/** The catalog in the shape `SlashCommandPicker` takes, in the current locale. */
export function simpleSlashCommands(locale: Locale): SlashCommandItem[] {
  return SIMPLE_SLASH_COMMANDS.map((command) => ({
    name: command.name,
    description: t(`simple.command.${command.key}`, {}, locale),
  }));
}

/** The transcript's ruled row: the speaker's mark, their name and time, then the prose measure (§11). */
function MessageRow({
  message,
  who,
  dir,
}: {
  message: ChatMessage;
  who: string;
  dir: 'rtl' | 'ltr';
}) {
  const owner = message.sender === 'user';
  return (
    <div
      dir={dir}
      style={{
        display: 'grid',
        gridTemplateColumns: 'var(--warsha-size-avatar) minmax(0, 1fr)',
        gap: 'var(--warsha-space-3)',
        paddingInline: 'var(--warsha-space-4)',
        paddingBlock: 'var(--warsha-space-3)',
        borderBlockEnd: '1px solid var(--warsha-bench-rule)',
        minInlineSize: 0,
      }}
    >
      {/* The owner's mark is the one lit square on the bench; everyone else is plate. It is decoration,
          the name beside it is the statement. */}
      <span
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          inlineSize: 'var(--warsha-size-avatar)',
          blockSize: 'var(--warsha-size-avatar)',
          borderRadius: 'var(--warsha-radius-sm)',
          backgroundColor: owner ? 'var(--warsha-signal)' : 'var(--warsha-bench-plate)',
          color: owner ? 'var(--warsha-signal-ink)' : 'var(--warsha-color-text)',
          border: '1px solid var(--warsha-bench-rule)',
          fontSize: 'var(--warsha-font-size-sm)',
          fontWeight: 700,
        }}
      >
        {who.slice(0, 1)}
      </span>
      <div style={{ minInlineSize: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--warsha-space-2)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 'var(--warsha-font-size-sm)', fontWeight: 600 }}>{who}</span>
          <time
            // A clock time is machine data: mono, tabular, and never re-shaped by a translation (§11).
            dir="ltr"
            translate="no"
            dateTime={message.timestamp}
            style={{
              fontFamily: 'var(--warsha-font-mono)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 'var(--warsha-font-size-xs)',
              color: 'var(--warsha-color-text)',
            }}
          >
            {message.timestamp.slice(11, 16)}
          </time>
        </div>
        <p
          style={{
            margin: 0,
            marginBlockStart: 'var(--warsha-space-1)',
            fontSize: 'var(--warsha-font-size-sm)',
            lineHeight: 'var(--warsha-line-height-relaxed)',
            whiteSpace: 'pre-wrap',
            // The prose measure an Arabic line needs to stay readable (§11).
            maxInlineSize: 'var(--warsha-size-measure)',
          }}
        >
          {message.content}
        </p>
      </div>
    </div>
  );
}

export function SimpleMode({ client, project, endpoint, onBack, onModeChange }: SimpleModeProps) {
  const dir = useDirection();
  const locale = useLocale();
  const [agents, setAgents] = useState<Agent[]>([...TEAM]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(TEAM[0].id);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  // The two composer autocompletes. `null` is "closed"; a string is what was typed after the marker,
  // which is also what the picker filters on, so visibility and query stay one value.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [pendingGates, setPendingGates] = useState<GateSummary[]>([]);
  const [gatesLoading, setGatesLoading] = useState(true);
  const [gatesFailed, setGatesFailed] = useState(false);
  const [busyGate, setBusyGate] = useState<Stage | null>(null);
  const [failedGate, setFailedGate] = useState<Stage | null>(null);
  const [thinking, setThinking] = useState(false);
  const [streamOffline, setStreamOffline] = useState(false);
  const [recentActivity, setRecentActivity] = useState<WarshaEvent[]>([]);
  const [runId, setRunId] = useState<RunId | null>(null);
  // Hard Mode factory state (DECISIONS 2026-11-06): the run object (the receipt reads its stage and
  // status, not just its id), the mission briefing and its harness/model/budget picks, the launch
  // outcome, and the artifacts the shelf shows. The live totals ride the same socket the activity
  // feed uses — no second subscription, no invented RPC.
  const [currentRun, setCurrentRun] = useState<RunSummary | null>(null);
  const [mission, setMission] = useState('');
  const [activeId, setActiveId] = useState<string>('autonomous-factory');
  const [harnessId, setHarnessId] = useState<string>('autonomous-factory');
  const [modelId, setModelId] = useState<string>(FACTORY_MODELS[0]?.id ?? 'deepseek-v3');
  const [fastModeTier, setFastModeTier] = useState<'thorough' | 'balanced' | 'fast'>('balanced');
  // Work protection (M14a) and agent workflow (M18): per-session choices the owner sets in the composer.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('ask_for_risky');
  const [agentMode, setAgentMode] = useState<AgentMode>('plan');
  // The owner's own catalogue (`models.list`): a model added in Settings appears on the bench without a
  // rebuild. The four presets stay as the factory's standing offer; the daemon's rows are added beside.
  const [catalogModels, setCatalogModels] = useState<readonly { id: string; name: string }[]>([]);
  const [budgetUsd, setBudgetUsd] = useState<number | null>(10);
  const [customBudget, setCustomBudget] = useState('');
  const [launchState, setLaunchState] = useState<'idle' | 'launching' | 'failed'>('idle');
  const [launchedRunId, setLaunchedRunId] = useState<RunId | null>(null);
  const [artifacts, setArtifacts] = useState<RunArtifact[] | null>(null);
  const [artifactsFailed, setArtifactsFailed] = useState(false);
  const [liveTokens, setLiveTokens] = useState(0);
  const [liveCostCents, setLiveCostCents] = useState(0);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const label = useCallback(
    (key: string, values?: MessageValues) => t(key, values ?? {}, locale),
    [locale]
  );

  const roleWord = useCallback(
    (agent: Pick<Agent, 'roleKey'>) => label(`role.${agent.roleKey}`),
    [label]
  );

  /**
   * The model pills the mission composer offers: the four factory presets, then every custom model the
   * daemon's catalogue reports (`models.list`). A catalogue read that fails leaves the presets alone —
   * the composer still works, it just cannot offer what the daemon did not report (§7).
   */
  useEffect(() => {
    if (typeof client.listCustomModels !== 'function') return undefined;
    let cancelled = false;
    client
      .listCustomModels()
      .then((rows) => {
        if (cancelled) return;
        setCatalogModels(
          rows.map((row) => ({
            id: `${row.provider}/${row.modelId}`,
            name: row.displayName ?? `${row.provider}/${row.modelId}`,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setCatalogModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  /** Hydrate active harness from daemon (Wave 3). */
  useEffect(() => {
    if (typeof client.listHarnesses !== 'function') return undefined;
    let cancelled = false;
    client
      .listHarnesses()
      .then((harnesses) => {
        if (cancelled) return;
        const active = harnesses.find((h) => h.active);
        if (active) {
          setActiveId(active.id);
          setHarnessId(active.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const modelOptions = useMemo(
    () => [...FACTORY_MODELS, ...catalogModels],
    [catalogModels]
  );

  /**
   * Load the run this project is on and the gates it is waiting on.
   *
   * The run's id is kept in state because a decision needs it, and re-listing runs on every tap let a
   * stale list decide the wrong run.
   */
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let failed = false;
      try {
        const runs = await client.listRuns(project.id);
        if (cancelled) return;
        const currentRun = runs[0] as RunSummary | undefined;
        setRunId(currentRun ? currentRun.id : null);
        setCurrentRun(currentRun ?? null);

        if (currentRun) {
          const gates = await client.getGates(currentRun.id);
          if (cancelled) return;
          setPendingGates(gates.filter((gate: GateSummary) => gate.state.state === 'pending'));
        }
      } catch {
        failed = true;
      }

      if (cancelled) return;
      setGatesFailed(failed);
      setGatesLoading(false);
      setAgents([...TEAM]);
      setSelectedAgentId(TEAM[0].id);
      setMessages([
        {
          id: 'welcome',
          agentId: 'orchestrator',
          sender: 'agent',
          content: t('simple.welcome', { name: project.name }, locale),
          timestamp: new Date().toISOString(),
        },
      ]);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, project, locale]);

  // Subscribe to the daemon event stream so the activity panel stays live.
  //
  // The socket is built from what the shell resolved — `daemon_ws_url` (the `/events`
  // endpoint, a `ws:` URL on the daemon's HTTP listener, which is *not* the RPC base) and
  // `daemon_token` (offered on the handshake as the `warsha.token.<token>` subprotocol).
  // Nothing is hardcoded here: when the shell resolved nothing, `subscribeEvents` reports
  // the missing credential, `onError` fires, and the banner says the feed is offline.
  useEffect(() => {
    const subscription = subscribeEvents({
      url: endpoint.eventsUrl,
      token: endpoint.token,
      onEvent: (event: WarshaEvent) => {
        setStreamOffline(false);
        setRecentActivity((previous) => [...previous, event].slice(-10));
        // The receipt's live readings ride the same feed: a token or cost field on an event adds
        // to the run's total, whatever else the bench shows. No second socket, no invented RPC.
        const tokens = eventTokens(event);
        if (tokens > 0) setLiveTokens((previous) => previous + tokens);
        if (event.costCents !== null && Number.isFinite(event.costCents)) {
          const cents = event.costCents;
          setLiveCostCents((previous) => previous + cents);
        }
      },
      onError: () => {
        // §7: the queue is not lost, the feed is. Say that, and offer the reconnect.
        setStreamOffline(true);
      },
    });
    return () => subscription.close();
    // Keyed to the resolved endpoint and the project only, so the socket is not re-opened on
    // every keystroke.
  }, [client, project, endpoint.eventsUrl, endpoint.token]);

  useEffect(
    () => () => {
      if (replyTimer.current !== null) clearTimeout(replyTimer.current);
    },
    []
  );

  const refreshGates = useCallback(async () => {
    if (runId === null) return;
    const gates = await client.getGates(runId);
    setPendingGates(gates.filter((gate: GateSummary) => gate.state.state === 'pending'));
  }, [client, runId]);

  /**
   * Launch the mission from the briefing composer (Hard Mode, DECISIONS 2026-11-06).
   *
   * The harness pick is best-effort: if `harnesses.select` is missing or refuses, the choice stays
   * on screen and on the receipt rather than losing the owner's brief (§7). The run itself starts
   * through `runs.start`; the artifact shelf then tries one read, and a failed read says so in
   * words instead of showing an empty shelf.
   */
  const launchMission = useCallback(async () => {
    const brief = mission.trim();
    if (brief === '') return;
    setLaunchState('launching');
    setArtifactsFailed(false);
    // The budget pill is a spend control, not decoration: write the project's ceiling first, and if
    // the daemon refuses it, do not start a run that would spend without the cap the owner chose.
    if (budgetUsd !== null && typeof client.setProjectBudget === 'function') {
      try {
        await client.setProjectBudget(project.id, Math.round(budgetUsd * 100));
      } catch {
        setLaunchState('failed');
        return;
      }
    }
    let started: RunSummary | null = null;
    try {
      if (typeof client.selectHarness === 'function') {
        try {
          await client.selectHarness(harnessId, project.id);
        } catch {
          // The pick stays visual; nothing here can refuse the receipt.
        }
      }
      started = await client.startRun(project.id, brief);
      setLaunchedRunId(started.id);
      setCurrentRun(started);
      setRunId(started.id);
      setLaunchState('idle');
    } catch {
      setLaunchState('failed');
      return;
    }
    if (started !== null && typeof client.getRunArtifacts === 'function') {
      try {
        setArtifacts(await client.getRunArtifacts(started.id));
      } catch {
        setArtifactsFailed(true);
      }
    }
  }, [budgetUsd, client, harnessId, mission, project.id]);

  const closePickers = useCallback(() => {
    setMentionQuery(null);
    setSlashQuery(null);
  }, []);

  /** Keep the composer's text and both pickers in step with one keystroke. */
  const handleComposerChange = useCallback((value: string) => {
    setDraft(value);
    const trigger = composerTriggerFor(value);
    setMentionQuery(trigger?.kind === 'mention' ? trigger.query : null);
    setSlashQuery(trigger?.kind === 'slash' ? trigger.query : null);
  }, []);

  const pickMention = useCallback((kind: MentionKind) => {
    setDraft((current) => insertComposerToken(current, `@${kind}`));
    setMentionQuery(null);
    setSlashQuery(null);
  }, []);

  const pickSlashCommand = useCallback((name: string) => {
    setDraft((current) => insertComposerToken(current, name));
    setMentionQuery(null);
    setSlashQuery(null);
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const agent = agents.find((candidate) => candidate.id === selectedAgentId);
      const trimmed = text.trim();
      if (!agent || trimmed === '') return;

      setMessages((previous) => [
        ...previous,
        {
          id: `msg-${Date.now()}`,
          agentId: agent.id,
          sender: 'user',
          content: trimmed,
          timestamp: new Date().toISOString(),
        },
      ]);
      handleComposerChange('');
      setThinking(true);

      // The team's reply is still a fixture (no chat RPC exists yet), so the wait is what the bench
      // shows: a thinking lamp, then the answer.
      replyTimer.current = setTimeout(() => {
        setMessages((previous) => [
          ...previous,
          {
            id: `msg-${Date.now() + 1}`,
            agentId: agent.id,
            sender: 'agent',
            content: t('simple.agent_reply', { text: trimmed }, locale),
            timestamp: new Date().toISOString(),
          },
        ]);
        setThinking(false);
      }, 1000);
    },
    [agents, handleComposerChange, locale, selectedAgentId]
  );

  /**
   * Send one gate decision to the daemon.
   *
   * A failed RPC keeps the card and shows the reason inline (§7): the owner's tap is never swallowed,
   * and the decision can be made again.
   */
  const decide = useCallback(
    async (decision: GateDecision, detail: { gateId: string; note?: string }) => {
      if (runId === null) return;
      const stage = detail.gateId as Stage;
      setBusyGate(stage);
      setFailedGate(null);
      try {
        if (decision === 'approve') {
          await client.approveGate(runId, stage);
        } else if (decision === 'reject') {
          await client.rejectGate(runId, stage, detail.note ?? '');
        } else {
          await client.requestChanges(runId, stage, detail.note ?? '');
        }
        await refreshGates();
      } catch {
        setFailedGate(stage);
      } finally {
        setBusyGate(null);
      }
    },
    [client, refreshGates, runId]
  );

  /** The words `GateCard` wears: the card owns no strings of its own (§6). */
  const gateLabels = useMemo<GateCardLabels>(
    () => ({
      gate: label('gates.word'),
      approve: label('gates.approve'),
      reject: label('gates.reject'),
      requestChanges: label('gates.request_changes'),
      reason: label('gates.reason_label'),
      reasonHint: label('gates.reason_hint'),
      confirm: label('gates.record'),
      cancel: label('common.cancel'),
      approved: label('gates.approved'),
      rejected: label('gates.rejected'),
      changesRequested: label('gates.changes_requested'),
      waiting: label('gates.pending'),
      required: label('gates.reason_required'),
    }),
    [label]
  );

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const activeAgent = agents.find((agent) => agent.status === 'working');
  const activeAgents = agents.filter((agent) => agent.status !== 'idle');
  const visibleAgents = showAllAgents ? agents : activeAgents.length > 0 ? activeAgents : agents;
  const idleCount = agents.filter((agent) => agent.status === 'idle').length;

  // ------------------------------------------------------- Hard Mode derived readings
  // The pipeline lamp and the receipt read the same run the gates do: the daemon's 14-stage walk
  // folded onto the factory's nine named steps, a finished run sealing the receipt, and no receipt
  // invented when there is no run at all (§7).
  const activeStageIndex = currentRun === null ? -1 : factoryStageIndex(currentRun.stage);
  const runFailed = currentRun !== null && currentRun.status === 'failed';
  const runCompleted = currentRun !== null && currentRun.status === 'completed';
  const receiptStatus: 'pass' | 'fail' | 'pending' = runFailed
    ? 'fail'
    : runCompleted
      ? 'pass'
      : 'pending';
  const receiptVisible =
    currentRun !== null &&
    (runFailed || runCompleted || pendingGates.length > 0 || launchedRunId !== null);
  const durationSeconds = (() => {
    if (currentRun === null) return null;
    const started = Date.parse(currentRun.startedAt);
    const ended = Date.parse(currentRun.updatedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
    return Math.max(0, Math.round((ended - started) / 1000));
  })();

  /** The factory-stage lamp: passed, waiting on a gate, failed where it stopped, or not reached. */
  const factoryStageLamp = (index: number): LampState => {
    if (currentRun === null) return 'idle';
    if (runCompleted) return 'ok';
    if (index < activeStageIndex) return 'ok';
    if (index === activeStageIndex) {
      if (pendingGates.length > 0) return 'waiting';
      if (runFailed) return 'fail';
      return 'working';
    }
    return 'idle';
  };

  // The visually-hidden label pattern the chat composer already uses: never absent, only not shown.
  const hiddenLabelStyle: React.CSSProperties = {
    position: 'absolute',
    inlineSize: 'var(--warsha-size-rule)',
    blockSize: 'var(--warsha-size-rule)',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  };
  // A machine-data value on the receipt: mono, tabular, ltr, isolated, never translated (§11).
  const machineValueStyle: React.CSSProperties = {
    fontFamily: 'var(--warsha-font-mono)',
    fontVariantNumeric: 'tabular-nums',
    unicodeBidi: 'isolate',
    overflowWrap: 'anywhere',
  };

  return (
    <Box
      dir={dir}
      className="simple-mode"
      style={{
        display: 'flex',
        height: '100%',
        // No 600px floor: the bench is now the height of the screen area, and a minimum taller than
        // it put the column back into a scrolling page, where the sticky composer painted over the gate
        // card's actions (B4's focus walk found the Approve ring under the form). The transcript is the
        // scroller; the header, the gates plate and the composer are fixed parts of the column.
        minHeight: 0,
        minBlockSize: 0,
        backgroundColor: 'var(--warsha-color-bg)',
        color: 'var(--warsha-color-text)',
        minInlineSize: 0,
      }}
    >
      {/* ------------------------------------------------------------------ start rail: the team
          The rail's 264px is §10's *≥1024* fact, so it lives in the stylesheet: written inline with a
          matching `minInlineSize`, it could not be released, and at 320/390 the team rail (264) plus the
          end panel (300) exceeded the viewport and squeezed the chat column to zero width. */}
      <nav
        dir={dir}
        aria-label={label('simple.team')}
        className="simple-rail"
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--warsha-bench-plate)',
          borderInlineEnd: '1px solid var(--warsha-bench-rule)',
        }}
      >
        <div
          dir={dir}
          style={{
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-3)',
            borderBlockEnd: '1px solid var(--warsha-bench-rule)',
            minInlineSize: 0,
          }}
        >
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              dir={dir}
              onClick={onBack}
              style={{ paddingInlineStart: 0, marginBlockEnd: 'var(--warsha-space-2)' }}
            >
              {label('common.back')}
            </Button>
          )}
          {/* The project names the bench; a deep link is verified by this line. */}
          <Text weight="bold" size="lg" dir={dir} style={{ overflowWrap: 'anywhere' }}>
            {project.name}
          </Text>
          <Text size="xs" dir={dir}>
            {label('simple.team_count', { count: agents.length })}
          </Text>
        </div>

        {activeAgent && (
          <div
            dir={dir}
            data-testid="simple-active-agent"
            style={{
              paddingInline: 'var(--warsha-space-4)',
              paddingBlock: 'var(--warsha-space-2)',
              backgroundColor: 'var(--warsha-color-surface)',
              borderBlockEnd: '1px solid var(--warsha-bench-rule)',
              fontSize: 'var(--warsha-font-size-xs)',
              minInlineSize: 0,
            }}
          >
            <Text size="xs" dir={dir}>
              {label('simple.active_agent')}
            </Text>
            <Lamp state={AGENT_LAMP[activeAgent.status]} size="xs">
              {roleWord(activeAgent)}
            </Lamp>
          </div>
        )}

        <div style={{ flex: '1', overflowY: 'auto', minInlineSize: 0 }}>
          <RailHead>{label('simple.team')}</RailHead>
          {visibleAgents.map((agent) => (
            <RailRow
              key={agent.id}
              selected={agent.id === selectedAgentId}
              onSelect={() => {
                setSelectedAgentId(agent.id);
                setAgents((previous) =>
                  previous.map((candidate) =>
                    candidate.id === agent.id ? { ...candidate, unreadCount: 0 } : candidate
                  )
                );
              }}
              sublabel={
                <Lamp state={AGENT_LAMP[agent.status]} size="xs">
                  {label(AGENT_STATE_KEY[agent.status])}
                </Lamp>
              }
              meta={
                agent.unreadCount > 0 ? (
                  // A count is machine data: mono and tabular. The lit chip is the owner's queue.
                  <ChipMeta tone="lit">{agent.unreadCount}</ChipMeta>
                ) : null
              }
            >
              {roleWord(agent)}
            </RailRow>
          ))}

          {idleCount > 0 && (
            <Box p={2} dir={dir}>
              <Button
                variant="ghost"
                size="sm"
                dir={dir}
                data-testid="simple-toggle-agents"
                onClick={() => setShowAllAgents(!showAllAgents)}
                style={{ inlineSize: '100%', justifyContent: 'center' }}
              >
                {showAllAgents
                  ? label('simple.hide_agents')
                  : label('simple.show_all_agents', { count: agents.length })}
              </Button>
            </Box>
          )}
        </div>
      </nav>

      {/* -------------------------------------------------------------------- chat column */}
      <Box
        dir={dir}
        style={{
          flex: '1',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--warsha-color-bg)',
          minWidth: 0,
        }}
      >
        {selectedAgent && (
          <header
            dir={dir}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--warsha-space-3)',
              paddingInline: 'var(--warsha-space-4)',
              minHeight: 'var(--warsha-size-topbar)',
              backgroundColor: 'var(--warsha-color-surface)',
              borderBlockEnd: '1px solid var(--warsha-bench-rule)',
              minInlineSize: 0,
            }}
          >
            {/* B4 §9: this is the page's title — the conversation the owner is in — so it is a real
                heading, not a bold span. The lamp beside it keeps the state in words (§9: never colour
                alone), and the heading carries only who is being spoken to. */}
            <h1
              dir={dir}
              style={{
                margin: 0,
                fontSize: 'var(--warsha-font-size-md)',
                fontWeight: 'var(--warsha-font-weight-bold)',
                color: 'var(--warsha-color-text)',
                lineHeight: 'var(--warsha-line-height-snug)',
                minInlineSize: 0,
              }}
            >
              {roleWord(selectedAgent)}
            </h1>
            <Lamp state={AGENT_LAMP[selectedAgent.status]} size="xs">
              {label(AGENT_STATE_KEY[selectedAgent.status])}
            </Lamp>
            {/* The factory word and the one-click ladder up to Complex (DECISIONS 2026-11-06). The
                switch keeps the project, the run and the gates — only the depth changes (§3). */}
            <span
              dir={dir}
              style={{
                marginInlineStart: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--warsha-space-2)',
                minInlineSize: 0,
              }}
            >
              <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
                {label('simple.factory_banner')}
              </Text>
              {onModeChange && (
                <Button
                  variant="ghost"
                  size="sm"
                  dir={dir}
                  data-testid="mode-toggle"
                  onClick={() => onModeChange('advanced')}
                >
                  {label('simple.switch_to_complex')}
                </Button>
              )}
            </span>
          </header>
        )}

        {streamOffline && (
          <Banner
            tone="offline"
            action={
              <Button
                variant="secondary"
                size="sm"
                dir={dir}
                onClick={() => {
                  setStreamOffline(false);
                  setRecentActivity([]);
                }}
              >
                {label('simple.stream_retry')}
              </Button>
            }
          >
            {label('simple.stream_offline')}
          </Banner>
        )}

        {gatesFailed && (
          <Banner
            tone="error"
            action={
              <Button variant="secondary" size="sm" dir={dir} onClick={() => void refreshGates()}>
                {label('common.retry')}
              </Button>
            }
          >
            {label('gates.failed')}
          </Banner>
        )}

        {/* ---------------------------------------------------- mission briefing composer
            The autonomous factory's single input (DECISIONS 2026-11-06): one brief, one harness pill,
            one model pill, one budget cap, one launch. The ids and names are machine data; every word
            is catalog (§11, §13). */}
        <section
          dir={dir}
          aria-label={label('simple.mission_title')}
          data-testid="mission-composer"
          style={{
            flex: 'none',
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-3)',
            backgroundColor: 'var(--warsha-bench-plate)',
            borderBlockEnd: '1px solid var(--warsha-bench-rule)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-2)',
            minInlineSize: 0,
            // §10's 390px phone: the plate and everything on it stay inside the viewport — a cap, not
            // a width, so the desktop column is untouched.
            maxInlineSize: '100%',
          }}
        >
          <Text size="sm" weight="bold" dir={dir}>
            {label('simple.mission_title')}
          </Text>
          <label htmlFor="mission-brief" style={hiddenLabelStyle}>
            {label('simple.mission_label')}
          </label>
          <textarea
            id="mission-brief"
            data-testid="mission-brief"
            dir={dir}
            rows={2}
            value={mission}
            placeholder={label('simple.mission_placeholder')}
            onChange={(event) => setMission(event.target.value)}
            style={{
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: 'var(--warsha-font-size-sm)',
              lineHeight: 'var(--warsha-line-height-relaxed)',
              color: 'var(--warsha-color-text)',
              backgroundColor: 'var(--warsha-color-surface)',
              border: '1px solid var(--warsha-bench-edge)',
              borderRadius: 'var(--warsha-radius-sm)',
              paddingInline: 'var(--warsha-space-3)',
              paddingBlock: 'var(--warsha-space-2)',
              minInlineSize: 0,
              inlineSize: '100%',
              maxInlineSize: '100%',
            }}
          />

          <div
            dir={dir}
            role="group"
            aria-label={label('simple.harness_label')}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--warsha-space-2)', minInlineSize: 0, maxInlineSize: '100%' }}
          >
            {HARNESS_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                variant={harnessId === preset.id ? 'primary' : 'ghost'}
                size="sm"
                dir={dir}
                aria-pressed={harnessId === preset.id}
                data-testid={`mission-harness-${preset.id}`}
                title={activeId === preset.id ? `${preset.id} (active)` : preset.id}
                onClick={() => setHarnessId(preset.id)}
                style={{ maxInlineSize: '100%' }}
              >
                {/* The preset id is the daemon's own name: mono, isolated, never translated (§11). */}
                <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', overflowWrap: 'anywhere' }}>
                  {preset.id}
                </span>
              </Button>
            ))}
          </div>

          <div
            dir={dir}
            role="group"
            aria-label={label('simple.model_label')}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--warsha-space-2)', minInlineSize: 0, maxInlineSize: '100%' }}
          >
            {modelOptions.map((model) => (
              <Button
                key={model.id}
                variant={modelId === model.id ? 'primary' : 'ghost'}
                size="sm"
                dir={dir}
                aria-pressed={modelId === model.id}
                data-testid={`mission-model-${model.id}`}
                onClick={() => setModelId(model.id)}
                style={{ maxInlineSize: '100%' }}
              >
                <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate', overflowWrap: 'anywhere' }}>
                  {model.name}
                </span>
              </Button>
            ))}
          </div>

          {/* Honesty over chrome (§7): the model pill is the briefing's plan; the routing the daemon
              actually honours is the per-role table in Settings → Models. */}
          <Text size="xs" dir={dir} style={{ color: 'var(--warsha-color-text-muted)' }}>
            {label('simple.model_note')}
          </Text>

          <div
            dir={dir}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--warsha-space-2)',
              minInlineSize: 0,
              maxInlineSize: '100%',
            }}
          >
            <Text size="xs" dir={dir}>
              {label('simple.budget_label')}
            </Text>
            {BUDGET_CAPS_USD.map((cap) => (
              <Button
                key={cap}
                variant={budgetUsd === cap ? 'primary' : 'ghost'}
                size="sm"
                dir="ltr"
                aria-pressed={budgetUsd === cap}
                data-testid={`mission-budget-${cap}`}
                onClick={() => {
                  setBudgetUsd(cap);
                  setCustomBudget('');
                }}
              >
                ${cap}
              </Button>
            ))}
            <label htmlFor="mission-budget-custom" style={hiddenLabelStyle}>
              {label('simple.budget_custom_label')}
            </label>
            <input
              id="mission-budget-custom"
              data-testid="mission-budget-custom"
              type="number"
              dir="ltr"
              min={1}
              value={customBudget}
              placeholder={label('simple.budget_custom')}
              onChange={(event) => {
                const value = event.target.value;
                setCustomBudget(value);
                const parsed = Number.parseFloat(value);
                setBudgetUsd(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
              }}
              style={{
                inlineSize: 'var(--warsha-size-touch)',
                maxInlineSize: '100%',
                fontFamily: 'var(--warsha-font-mono)',
                fontSize: 'var(--warsha-font-size-sm)',
                color: 'var(--warsha-color-text)',
                backgroundColor: 'var(--warsha-color-surface)',
                border: '1px solid var(--warsha-bench-edge)',
                borderRadius: 'var(--warsha-radius-sm)',
                paddingInline: 'var(--warsha-space-2)',
                paddingBlock: 'var(--warsha-space-1)',
              }}
            />
          </div>

          <div
            dir={dir}
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--warsha-space-2)', minInlineSize: 0, maxInlineSize: '100%' }}
          >
            <Button
              dir={dir}
              data-testid="mission-launch"
              disabled={mission.trim() === '' || launchState === 'launching'}
              onClick={() => void launchMission()}
            >
              {launchState === 'launching' ? label('simple.launching') : label('simple.launch')}
            </Button>
          </div>

          {launchState === 'failed' && (
            <Text size="xs" dir={dir} style={{ color: 'var(--warsha-lamp-fail, var(--warsha-color-text))' }}>
              {label('simple.launch_failed')}
            </Text>
          )}
        </section>

        {/* ------------------------------------------------ autonomous pipeline matrix
            Nine stages, one lamp each; the run's own stage says where the factory reached. Rows are
            plain divs — the bench shows the pipeline, it does not navigate it from here. */}
        <section
          dir={dir}
          aria-label={label('simple.pipeline_title')}
          data-testid="factory-pipeline"
          style={{
            flex: 'none',
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-3)',
            borderBlockEnd: '1px solid var(--warsha-bench-rule)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--warsha-space-2)',
            minInlineSize: 0,
          }}
        >
          <Text size="sm" weight="bold" dir={dir}>
            {label('simple.pipeline_title')}
          </Text>
          <Text size="xs" dir={dir}>
            {label('simple.pipeline_hint')}
          </Text>
          <div
            dir={dir}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
              gap: 'var(--warsha-space-2)',
              minInlineSize: 0,
            }}
          >
            {FACTORY_STAGES.map((stage, index) => (
              <div
                key={stage}
                dir={dir}
                data-testid={`factory-stage-${stage}`}
                data-state={factoryStageLamp(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--warsha-space-2)',
                  paddingInline: 'var(--warsha-space-2)',
                  paddingBlock: 'var(--warsha-space-1)',
                  backgroundColor: 'var(--warsha-bench-plate)',
                  border: '1px solid var(--warsha-bench-rule)',
                  borderRadius: 'var(--warsha-radius-sm)',
                  minInlineSize: 0,
                }}
              >
                <Lamp state={factoryStageLamp(index)} size="xs">
                  {label(`factory.stage.${stage}`)}
                </Lamp>
              </div>
            ))}
          </div>
        </section>

        {/* The gates interrupt the transcript — the one place the bench raises a shadow (§1.1). */}
        {(gatesLoading || pendingGates.length > 0) && (
          <section
            dir={dir}
            aria-label={label('simple.pending_gates')}
            style={{
              // B4: a fixed part of the column. Left flexible it is squashed by the transcript beside it and
              // its own gate actions overflow onto the composer below — a focused button painted under
              // another element, which §9 does not allow.
              flex: 'none',
              paddingInline: 'var(--warsha-space-4)',
              paddingBlock: 'var(--warsha-space-3)',
              backgroundColor: 'var(--warsha-bench-plate)',
              borderBlockEnd: '1px solid var(--warsha-bench-rule)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--warsha-space-3)',
              minInlineSize: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--warsha-space-2)' }}>
              <Text size="sm" weight="bold" dir={dir}>
                {label('simple.pending_gates')}
              </Text>
              {gatesLoading ? null : (
                <Chip tone="lit" glyph="!" label={label('simple.pending_gates')}>
                  {pendingGates.length}
                </Chip>
              )}
            </div>

            {gatesLoading && <Skeleton label={label('simple.pending_gates')} variant="row" lines={2} />}

            {pendingGates.map((gate) => (
              <GateCard
                key={gate.stage as string}
                gateId={gate.stage as string}
                title={label(`run.stage.${gate.stage}`)}
                busy={busyGate === gate.stage}
                error={failedGate === gate.stage ? label('gates.failed') : undefined}
                onDecision={(decision, detail) => void decide(decision, detail)}
                labels={gateLabels}
              >
                {/* The press-metal card now says *why* it waits and what the automatic safety pass
                    already covered, so one glance is enough before the owner decides (§6, §7). */}
                <Box dir={dir} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--warsha-space-1)' }}>
                  <Text size="sm" dir={dir}>
                    {label('simple.gate_needs_you')}
                  </Text>
                  <Text size="xs" dir={dir}>
                    {label('simple.gate_rationale')}
                  </Text>
                  <Text size="xs" dir={dir}>
                    {label('simple.gate_safety')}
                  </Text>
                </Box>
              </GateCard>
            ))}
          </section>
        )}

        {/* The transcript scrolls, so it takes keyboard focus itself (axe scrollable-region-focusable):
            tabIndex 0 makes the region a Tab stop and the global :focus-visible rule draws its ring.
            The live-region semantics — role log, polite announcements, the agent's name — unchanged. */}
        <div
          dir={dir}
          role="log"
          aria-live="polite"
          aria-label={roleWord(selectedAgent)}
          tabIndex={0}
          style={{
            flex: '1',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              dir={dir}
              who={
                message.sender === 'user'
                  ? label('simple.owner')
                  : roleWord(agents.find((agent) => agent.id === message.agentId) ?? agents[0])
              }
            />
          ))}

          {thinking && (
            <Box dir={dir} p={3}>
              <Lamp state="working" size="xs">
                {label('simple.thinking')}
              </Lamp>
            </Box>
          )}
        </div>

        {/* The composer: sticky at the inline-end edge of the column, Enter sends, Shift+Enter is a
            newline, and neither fires during an Arabic IME composition (§6, §9).
            `Composer` from `@warsha/ui` owns this behaviour but takes no `data-testid`, and the shell's
            own suite (`App.test.tsx`, outside this batch) queries the field by that id — so the screen
            keeps the field and reproduces the contract rather than losing the keyboard path. */}
        <form
          dir={dir}
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage(draft);
          }}
          aria-busy={thinking}
          style={{
            display: 'flex',
            // On a phone the pickers wrap to a second row rather than push the field past the edge;
            // the form's min-content width is one control, not the sum of seven.
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: 'var(--warsha-space-2)',
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-3)',
            paddingBlockEnd: 'var(--warsha-space-4)',
            backgroundColor: 'var(--warsha-color-surface)',
            borderBlockStart: '1px solid var(--warsha-bench-rule)',
            // B4 §4 + §9, settled in the browser: the composer stays at the inline-end edge of the column
            // and stays visible, but it gets there by being the column's fixed footer under an internally
            // scrolling transcript — not by `position: sticky`. Sticky resolves against the *screen's*
            // scrollport, so on a phone the form floated up over the gate card's actions and drew its own
            // background across a focused Approve button. Same affordance, nothing ever obscured.
            flex: 'none',
            minInlineSize: 0,
            maxInlineSize: '100%',
          }}
        >
          <label
            htmlFor="simple-composer-input"
            style={{
              // The label is never absent, only not shown: a chat column does not caption its own field
              // (§6). Assistive technology still hears it.
              position: 'absolute',
              inlineSize: 'var(--warsha-size-rule)',
              blockSize: 'var(--warsha-size-rule)',
              overflow: 'hidden',
              clipPath: 'inset(50%)',
              whiteSpace: 'nowrap',
            }}
          >
            {label('simple.composer_label')}
          </label>
          <textarea
            id="simple-composer-input"
            data-testid="simple-composer-input"
            rows={1}
            dir={dir}
            value={draft}
            placeholder={label('simple.composer_placeholder')}
            aria-busy={thinking}
            onChange={(event) => handleComposerChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                closePickers();
                return;
              }
              if (event.key !== 'Enter' || event.shiftKey) return;
              // An Arabic IME commits a candidate with Enter; that keystroke is not "send".
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              sendMessage(draft);
            }}
            style={{
              flex: '1',
              minWidth: 0,
              maxInlineSize: '100%',
              resize: 'none',
              maxHeight: 'var(--warsha-size-composer-max)',
              overflowY: 'auto',
              fontFamily: 'inherit',
              fontSize: 'var(--warsha-font-size-sm)',
              lineHeight: 'var(--warsha-line-height-relaxed)',
              color: 'var(--warsha-color-text)',
              backgroundColor: 'var(--warsha-bench-plate)',
              border: '1px solid var(--warsha-bench-edge)',
              borderRadius: 'var(--warsha-radius-sm)',
              paddingInline: 'var(--warsha-space-3)',
              paddingBlock: 'var(--warsha-space-2)',
              minHeight: 'var(--warsha-size-touch)',
            }}
          />
          <Button type="submit" dir={dir} disabled={draft.trim() === '' || thinking}>
            {label('common.send')}
          </Button>
          <FastModeToggle
            tier={fastModeTier}
            onChange={setFastModeTier}
            label={label(`composer.fast_mode.tier.${fastModeTier}`)}
            hint={label(`composer.fast_mode.hint.${fastModeTier}`)}
            dir={dir}
          />
          <ModelPicker
            selectedId={modelId}
            options={modelOptions.map((m) => ({
              id: m.id,
              name: m.name,
              provider: m.id.includes('/') ? m.id.split('/')[0] : 'Custom',
            }))}
            onChange={setModelId}
            dir={dir}
            ariaLabel={label('composer.model_picker.label', { model: modelOptions.find((m) => m.id === modelId)?.name ?? modelId })}
          />
          {pendingGates.length > 0 && (
            <Chip tone="lit" glyph="!" label={label('simple.pending_gates')}>
              {pendingGates.length}
            </Chip>
          )}
          <PermissionModeChip mode={permissionMode} onChange={setPermissionMode} />
          <PlanModeBadge mode={agentMode} onToggle={setAgentMode} />
        </form>

        {/* The two autocompletes open under the field, in the composer's own column, so a long list
            pushes the composer up instead of covering the message being typed. */}
        {mentionQuery !== null && (
          <Box dir={dir} p={2} style={{ backgroundColor: 'var(--warsha-color-surface)' }}>
            <MentionPicker query={mentionQuery} onSelect={pickMention} onClose={closePickers} />
          </Box>
        )}
        {slashQuery !== null && (
          <Box dir={dir} p={2} style={{ backgroundColor: 'var(--warsha-color-surface)' }}>
            <SlashCommandPicker
              commands={simpleSlashCommands(locale)}
              query={slashQuery}
              onSelect={pickSlashCommand}
              onClose={closePickers}
            />
          </Box>
        )}
      </Box>

      {/* --------------------------------------------------------------------- end panel
          300px is §10's ≥1024 fact too, and §4 gives it to Simple only. Same reason as the rail: a
          fixed inline size here is what zeroed the chat column on a phone. */}
      <Box
        dir={dir}
        className="simple-side"
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--warsha-color-surface)',
          borderInlineStart: '1px solid var(--warsha-bench-rule)',
        }}
      >
        <div
          dir={dir}
          style={{
            paddingInline: 'var(--warsha-space-4)',
            paddingBlock: 'var(--warsha-space-3)',
            borderBlockEnd: '1px solid var(--warsha-bench-rule)',
            minInlineSize: 0,
          }}
        >
          <Text weight="bold" size="md" dir={dir}>
            {label('simple.activity')}
          </Text>
          <Text size="xs" dir={dir}>
            {label('simple.activity_hint')}
          </Text>
        </div>

        {/* The activity list scrolls, so it takes keyboard focus itself (axe scrollable-region-focusable):
            tabIndex 0 makes the region a Tab stop and the global :focus-visible rule draws its ring. */}
        <div style={{ flex: '1', overflowY: 'auto', minInlineSize: 0 }} tabIndex={0}>
          {recentActivity.length === 0 ? (
            <Text size="sm" dir={dir} style={{ paddingInline: 'var(--warsha-space-4)' }}>
              {label('simple.no_activity')}
            </Text>
          ) : (
            <Ledger label={label('simple.activity')} recessed>
              {recentActivity.map((event: WarshaEvent) => (
                <Ledger.Row
                  key={event.id}
                  meta={
                    event.costCents !== null ? (
                      // Cost is machine data: mono, tabular, four decimals of a dollar (§11).
                      <ChipMeta>${(event.costCents / 100).toFixed(4)}</ChipMeta>
                    ) : (
                      // The stage is the catalog's *word* for the step (`البحث`, `Research`), not a wire
                      // value, so it is a meta chip in the bench's own voice — not the machine skin, which
                      // would set an Arabic word in a fixed-advance face and cut its join (§11).
                      <Chip>{label(`run.stage.${event.stage}`)}</Chip>
                    )
                  }
                >
                  <Text size="sm" weight="medium" dir={dir}>
                    {label(`role.${event.role ?? 'orchestrator'}`)}
                  </Text>
                  {/* The event kind is the daemon's own name: mono, isolated, never translated (§11). */}
                  <Text size="xs" dir={dir}>
                    <span dir="ltr" translate="no" style={{ unicodeBidi: 'isolate' }}>
                      {event.kind}
                    </span>
                  </Text>
                </Ledger.Row>
              ))}
            </Ledger>
          )}

          {/* ------------------------------------------------------------- artifact shelf
              What the factory produced on this bench since the owner launched it. Names are file
              paths — mono, isolated, never translated (§11); kinds and stages are catalog words. */}
          {launchedRunId !== null && (
            <section
              dir={dir}
              aria-label={label('simple.artifacts_title')}
              data-testid="artifact-shelf"
              style={{
                paddingInline: 'var(--warsha-space-4)',
                paddingBlock: 'var(--warsha-space-3)',
                borderBlockEnd: '1px solid var(--warsha-bench-rule)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--warsha-space-2)',
                minInlineSize: 0,
              }}
            >
              <Text size="sm" weight="bold" dir={dir}>
                {label('simple.artifacts_title')}
              </Text>
              {artifactsFailed ? (
                <Text size="xs" dir={dir}>
                  {label('simple.artifacts_failed')}
                </Text>
              ) : artifacts === null ? (
                <Skeleton label={label('simple.artifacts_title')} variant="row" lines={1} />
              ) : artifacts.length === 0 ? (
                <Text size="xs" dir={dir}>
                  {label('simple.artifacts_empty')}
                </Text>
              ) : (
                artifacts.map((artifact) => (
                  <div
                    key={`${artifact.name}-${artifact.version}`}
                    dir={dir}
                    data-testid={`artifact-item-${artifact.name}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 'var(--warsha-space-2)',
                      minInlineSize: 0,
                    }}
                  >
                    <span
                      dir="ltr"
                      translate="no"
                      style={{
                        fontFamily: 'var(--warsha-font-mono)',
                        fontSize: 'var(--warsha-font-size-xs)',
                        unicodeBidi: 'isolate',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {artifact.name}
                    </span>
                    <Chip>{label(`simple.artifact.kind.${artifactKindOf(artifact.name)}`)}</Chip>
                    <Chip>{label(`run.stage.${artifact.stage}`)}</Chip>
                  </div>
                ))
              )}
            </section>
          )}

          {/* ------------------------------------------------------ verification receipt
              The run's own record: ids, the active harness, the verdict, the live totals, and the
              bench's seal over the fields it shows. The seal is deterministic over run+project ids
              because the daemon reports no signing RPC on this branch (§7, DECISIONS 2026-11-06). */}
          {receiptVisible && currentRun !== null && (
            <section
              dir={dir}
              aria-label={label('simple.receipt_title')}
              data-testid="verification-receipt"
              data-status={receiptStatus}
              style={{
                paddingInline: 'var(--warsha-space-4)',
                paddingBlock: 'var(--warsha-space-3)',
                borderBlockEnd: '1px solid var(--warsha-bench-rule)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--warsha-space-1)',
                minInlineSize: 0,
              }}
            >
              <div
                dir={dir}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--warsha-space-2)',
                  flexWrap: 'wrap',
                }}
              >
                <Text size="sm" weight="bold" dir={dir}>
                  {label('simple.receipt_title')}
                </Text>
                <Stamp tone={receiptStatus === 'fail' ? 'fail' : 'ok'}>
                  {label('simple.receipt_verified')}
                </Stamp>
              </div>

              {(
                [
                  ['simple.receipt_run', currentRun.id],
                  ['simple.receipt_project', project.id],
                  ['simple.receipt_harness', harnessId],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  dir={dir}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--warsha-space-2)',
                    minInlineSize: 0,
                  }}
                >
                  <Text size="xs" dir={dir}>
                    {label(key)}
                  </Text>
                  <Text size="xs" dir="ltr" style={machineValueStyle}>
                    {value}
                  </Text>
                </div>
              ))}

              <div
                dir={dir}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--warsha-space-2)' }}
              >
                <Text size="xs" dir={dir}>
                  {label('simple.receipt_status')}
                </Text>
                <Text size="xs" dir={dir} data-status={receiptStatus}>
                  {label(`simple.receipt_${receiptStatus}`)}
                </Text>
              </div>

              <div
                dir={dir}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--warsha-space-2)' }}
              >
                <Text size="xs" dir={dir}>
                  {label('simple.receipt_tokens')}
                </Text>
                <Text size="xs" dir="ltr" style={machineValueStyle}>
                  {liveTokens > 0 ? liveTokens : '—'}
                </Text>
              </div>

              <div
                dir={dir}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--warsha-space-2)' }}
              >
                <Text size="xs" dir={dir}>
                  {label('simple.receipt_cost')}
                </Text>
                <Text size="xs" dir="ltr" style={machineValueStyle}>
                  {liveCostCents > 0 ? `$${(liveCostCents / 100).toFixed(4)}` : '—'}
                </Text>
              </div>

              <div
                dir={dir}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--warsha-space-2)' }}
              >
                <Text size="xs" dir={dir}>
                  {label('simple.receipt_duration')}
                </Text>
                <Text size="xs" dir="ltr" style={machineValueStyle}>
                  {durationSeconds === null ? '—' : `${durationSeconds}s`}
                </Text>
              </div>

              <div
                dir={dir}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--warsha-space-2)' }}
              >
                <Text size="xs" dir={dir}>
                  {label('simple.receipt_seal')}
                </Text>
                <Text size="xs" dir="ltr" translate="no" data-testid="verification-seal" style={machineValueStyle}>
                  {verificationSeal(currentRun.id, project.id)}
                </Text>
              </div>
            </section>
          )}
        </div>

        {/* The one-paragraph team summary survives at every rung (§3, rung 3). */}
        <Box
          dir={dir}
          p={4}
          style={{
            marginTop: 'auto',
            borderBlockStart: '1px solid var(--warsha-bench-rule)',
            backgroundColor: 'var(--warsha-bench-plate)',
          }}
        >
          <Text size="sm" dir={dir} style={{ lineHeight: 'var(--warsha-line-height-relaxed)' }}>
            {label('simple.summary')}
          </Text>
          <Box style={{ marginBlockStart: 'var(--warsha-space-2)' }}>
            {pendingGates.length > 0 ? (
              <Lamp state="waiting" size="xs">
                {label('simple.summary_gates', { count: pendingGates.length })}
              </Lamp>
            ) : (
              <Text size="xs" dir={dir}>
                {label('simple.summary_gates', { count: 0 })}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
