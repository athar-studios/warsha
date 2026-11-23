// apps/desktop/src/v3/pages/developers/metrics.ts
// E4 Developers mode: pure derivations from the run's event log and session rows.
//
// Every figure the screen shows comes from one of these functions, so the vitest
// fixtures test the exact number a user sees (plan §8 E4 acceptance: "every
// on-screen figure equals its store query").
//
// What the event log can honestly bind to a session: the daemon's events carry
// `role`, `stage`, `cost_cents` and `tokens` but no session id (crates/warsha-core
// Event). A session's figures therefore aggregate the events of the session's own
// role inside the session's start→end window; a session with no such events shows
// `unknown` — never zero, never an invented number.
import type { Session, RunSubtask, WarshaEvent } from '@warsha/client';

/** One session's derived figures; `null` means "unknown" on the wire. */
export interface SessionMetrics {
  /** Sum of the session-window events' `cost_cents`; null when none carry one. */
  costCents: number | null;
  /** Sum of input/output/total tokens in the window; null when none report tokens. */
  tokens: { input: number; output: number; total: number } | null;
  /** Estimated tokens per second over the session's elapsed time; null when unknown. */
  tokensPerSecond: number | null;
  /** startedAt→endedAt (or → "now") in milliseconds. */
  elapsedMs: number;
}

export function withinWindow(event: WarshaEvent, session: Session): boolean {
  if (event.role !== session.role) return false;
  const at = Date.parse(event.createdAt);
  const start = Date.parse(session.startedAt);
  if (!Number.isFinite(at) || !Number.isFinite(start) || at < start) return false;
  if (session.endedAt !== null) {
    const end = Date.parse(session.endedAt);
    if (Number.isFinite(end) && at > end) return false;
  }
  return true;
}

export function elapsedMs(session: Session, nowMs: number = Date.now()): number {
  const start = Date.parse(session.startedAt);
  if (!Number.isFinite(start)) return 0;
  const end = session.endedAt !== null ? Date.parse(session.endedAt) : nowMs;
  if (!Number.isFinite(end) || end < start) return 0;
  return end - start;
}

export function sessionMetrics(
  session: Session,
  events: WarshaEvent[],
  nowMs: number = Date.now()
): SessionMetrics {
  const own = events.filter((event) => withinWindow(event, session));
  let costCents: number | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensTotal = 0;
  let tokensSeen = false;
  for (const event of own) {
    if (event.costCents !== null && Number.isFinite(event.costCents)) {
      costCents = (costCents ?? 0) + event.costCents;
    }
    const wire = event.tokens as { input: number; output: number; total: number } | null | undefined;
    if (
      wire &&
      Number.isFinite(wire.input) &&
      Number.isFinite(wire.output) &&
      Number.isFinite(wire.total)
    ) {
      tokensIn += wire.input;
      tokensOut += wire.output;
      tokensTotal += wire.total;
      tokensSeen = true;
    }
  }
  const tokens: { input: number; output: number; total: number } | null = tokensSeen
    ? { input: tokensIn, output: tokensOut, total: tokensTotal }
    : null;
  const window = elapsedMs(session, nowMs);
  const tokensPerSecond =
    tokens !== null && window > 0 ? Math.round((tokens.total / window) * 1000) : null;
  return { costCents, tokens, tokensPerSecond, elapsedMs: window };
}

/** The run's total cost: every event's `cost_cents` summed (the run's cost records). */
export function runCostCents(events: WarshaEvent[]): number {
  return events.reduce(
    (sum, event) => sum + (event.costCents !== null && Number.isFinite(event.costCents) ? event.costCents : 0),
    0
  );
}

/** Cost per merged packet = run cost ÷ succeeded subtasks; null (rendered "—") when zero packets. */
export function costPerPacketCents(events: WarshaEvent[], subtasks: RunSubtask[]): number | null {
  const packets = subtasks.filter((subtask) => subtask.status === 'succeeded').length;
  if (packets === 0) return null;
  return runCostCents(events) / packets;
}

/** Burn rate in cents per hour over the run's own window (startedAt→last update). */
export function burnRateCentsPerHour(
  startedAt: string,
  updatedAt: string,
  costCents: number
): number | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (costCents / (end - start)) * 3_600_000;
}

/**
 * The E4 receipt export: the full trail as one JSON document. Assembled entirely
 * from data the owner's session already read back (no secrets travel with it).
 */
export interface ReceiptExportInput {
  run: Record<string, unknown>;
  permissions: Record<string, unknown>;
  defaults: Record<string, unknown>;
  failoverEvents: WarshaEvent[];
  permissionDecisions: WarshaEvent[];
  sessions: Session[];
  subtasks: RunSubtask[];
}

export function buildReceipt(input: ReceiptExportInput): string {
  return JSON.stringify(
    {
      run: input.run,
      policy_snapshot: { project: input.permissions, defaults: input.defaults },
      failover_events: input.failoverEvents,
      permission_decisions: input.permissionDecisions,
      sessions: input.sessions,
      subtasks: input.subtasks,
    },
    null,
    2
  );
}

/**
 * Context usage, ONLY when an event payload reports context size
 * (plan §8 E4: "only where the backend reports context size, otherwise omitted").
 */
export function contextUsage(events: WarshaEvent[]): { used: number; total: number } | null {
  for (const event of events) {
    const payload = event.payload;
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      const used = record['context_used_tokens'];
      const total = record['context_total_tokens'];
      if (typeof used === 'number' && typeof total === 'number' && total > 0) {
        return { used, total };
      }
    }
  }
  return null;
}

/** Sessions that never produced telemetry show the label instead of an empty timeline. */
export function hasTelemetry(session: Session, events: WarshaEvent[]): boolean {
  return events.some((event) => withinWindow(event, session));
}

/** Swarm children grouped under their parent (N1 parent link). */
export interface SessionGroup {
  parent: Session;
  children: Session[];
}

export function groupByParent(sessions: Session[]): SessionGroup[] {
  const parents = sessions.filter((session) => session.parentSessionId === null);
  const groups: SessionGroup[] = parents.map((parent) => ({
    parent,
    children: sessions.filter(
      (session) => session.parentSessionId === parent.id
    ),
  }));
  for (const session of sessions) {
    if (session.parentSessionId !== null && !parents.some((parent) => parent.id === session.parentSessionId)) {
      groups.push({ parent: session, children: [] });
    }
  }
  return groups;
}

/** Step durations for the detail timeline: consecutive in-window event gaps. */
export function eventTimeline(
  session: Session,
  events: WarshaEvent[]
): { event: WarshaEvent; durationMs: number | null }[] {
  const own = events.filter((event) => withinWindow(event, session));
  return own.map((event, index) => {
    if (index === 0) return { event, durationMs: null };
    const previous = Date.parse(own[index - 1].createdAt);
    const at = Date.parse(event.createdAt);
    const durationMs = Number.isFinite(previous) && Number.isFinite(at) ? at - previous : null;
    return { event, durationMs };
  });
}

/** Files a session touched: tool-call/step payloads that name one or more paths. */
export function filesTouched(session: Session, events: WarshaEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events.filter((item) => withinWindow(item, session))) {
    const payload = event.payload;
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      const one = record['file'];
      if (typeof one === 'string' && one.length > 0) files.add(one);
      const many = record['files'];
      if (Array.isArray(many)) {
        for (const item of many) {
          if (typeof item === 'string' && item.length > 0) files.add(item);
        }
      }
    }
  }
  return [...files];
}
