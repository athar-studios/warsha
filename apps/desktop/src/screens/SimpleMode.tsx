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
  GateCard,
  Lamp,
  Ledger,
  RailHead,
  RailRow,
  Skeleton,
  Text,
  type GateCardLabels,
  type GateDecision,
  type LampState,
} from '@warsha/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MentionPicker, type MentionKind } from '../components/MentionPicker';
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

export function SimpleMode({ client, project, endpoint, onBack }: SimpleModeProps) {
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
                {label('simple.gate_needs_you')}
              </GateCard>
            ))}
          </section>
        )}

        <div
          dir={dir}
          role="log"
          aria-live="polite"
          aria-label={roleWord(selectedAgent)}
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

        <div style={{ flex: '1', overflowY: 'auto', minInlineSize: 0 }}>
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
