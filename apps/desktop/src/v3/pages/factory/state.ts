import type { WarshaEvent } from '@warsha/client';

/**
 * E3 Factory floor state machine (plan §8, ### E3).
 *
 * The floor derives per-agent states purely from the run event stream
 * (`warsha_core::Event` rows as decoded by the client). Daemon events carry
 * `role`, `stage`, `cost_cents` and `tokens` but no session id
 * (`crates/warsha-pipeline/src/lib.rs` AgentStep emitters), so an agent is
 * keyed by `run:role` unless the event payload names the sessions explicitly —
 * the handoff payload must name BOTH sides before any handoff movement.
 */

export type FloorState = 'idle' | 'working' | 'handing_off' | 'waiting_on_owner' | 'done';

export interface AgentStatus {
  /** `run:role` identity, or the payload-named session id for handoffs. */
  key: string;
  runId: string;
  role: string | null;
  state: FloorState;
  /** Last event stage (`warsha_core::Stage` wire string). */
  stage: string | null;
  /** Human-readable summary of the agent's most recent action. */
  lastAction: string;
  /** Wire timestamp of the agent's most recent event. */
  lastUpdated: string;
  /** Sum of `cost_cents` across the agent's events (the same store E4 reads). */
  costCents: number;
  /** Model id when an event payload carried one; null when the backend reports none. */
  model: string | null;
  /** The handoff source session id while `state === 'handing_off'`. */
  handoffFrom: string | null;
}

const WORKING_KINDS = new Set(['StageStarted', 'AgentStep', 'ToolCall', 'StageCompleted']);

/** Text summary for an event's payload, when the payload carries printable detail. */
function actionOf(event: WarshaEvent): string {
  const payload = event.payload;
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const named = record['tool'] ?? record['action'] ?? record['command'];
    if (typeof named === 'string' && named.length > 0) return `${event.kind}: ${named}`;
  }
  return event.kind;
}

/** The agent key an event belongs to: payload-named session, else `run:role`. */
function keyOf(event: WarshaEvent): string | null {
  const payload = event.payload;
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const session = record['session'];
    if (typeof session === 'string' && session.length > 0) return session;
  }
  if (event.role === null) return null;
  return `${event.runId}:${event.role}`;
}

function blank(key: string, event: WarshaEvent): AgentStatus {
  return {
    key,
    runId: event.runId,
    role: event.role,
    state: 'idle',
    stage: null,
    lastAction: event.kind,
    lastUpdated: event.createdAt,
    costCents: 0,
    model: null,
    handoffFrom: null,
  };
}

/**
 * Apply one event to the floor map. Pure: returns a new map, never mutates
 * the input. Unknown kinds keep the agent's state (they still refresh the
 * timestamp and cost so idle duration and spend stay honest).
 */
export function applyEvent(
  agents: Map<string, AgentStatus>,
  event: WarshaEvent
): Map<string, AgentStatus> {
  const next = new Map(agents);

  // Handoff first: the movement is only real when the payload names BOTH
  // sessions (`handoff_from` + `handoff_to`); a one-sided mention moves nobody.
  const payload = event.payload;
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const from = record['handoff_from'];
    const to = record['handoff_to'];
    if (typeof from === 'string' && from.length > 0 && typeof to === 'string' && to.length > 0) {
      const target = next.get(to) ?? blank(to, event);
      next.set(to, {
        ...target,
        state: 'handing_off',
        lastAction: `${event.kind}: ${from} → ${to}`,
        lastUpdated: event.createdAt,
        handoffFrom: from,
        costCents: target.costCents + (typeof event.costCents === 'number' ? event.costCents : 0),
      });
      return next;
    }
  }

  const key = keyOf(event);
  if (key === null) return next;
  const current = next.get(key) ?? blank(key, event);
  let updated: AgentStatus = {
    ...current,
    lastUpdated: event.createdAt,
    stage: event.stage ?? current.stage,
    costCents: current.costCents + (typeof event.costCents === 'number' ? event.costCents : 0),
  };
  const payloadRecord =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  if (payloadRecord !== null && typeof payloadRecord['model'] === 'string') {
    updated = { ...updated, model: payloadRecord['model'] as string };
  }

  if (
    event.kind === 'GateDecision' &&
    payloadRecord !== null &&
    payloadRecord['state'] === 'pending'
  ) {
    updated = { ...updated, state: 'waiting_on_owner', lastAction: actionOf(event) };
  } else if (event.kind === 'RunFinished') {
    updated = { ...updated, state: 'done', lastAction: actionOf(event) };
  } else if (WORKING_KINDS.has(event.kind)) {
    updated = { ...updated, state: 'working', lastAction: actionOf(event) };
  } else {
    updated = { ...updated, lastAction: actionOf(event) };
  }
  next.set(key, updated);
  return next;
}

/** Reduce a whole event stream (oldest first, as `runs.events` returns it). */
export function reduceEvents(events: WarshaEvent[]): Map<string, AgentStatus> {
  let agents = new Map<string, AgentStatus>();
  for (const event of events) {
    agents = applyEvent(agents, event);
  }
  return agents;
}

/**
 * Idle duration in ms for an idle agent (now minus its most recent event);
 * 0 for any non-idle state so break-area labels never show stale waits.
 */
export function idleMsOf(agent: AgentStatus, nowMs: number): number {
  if (agent.state !== 'idle') return 0;
  const at = Date.parse(agent.lastUpdated);
  if (!Number.isFinite(at) || nowMs < at) return 0;
  return nowMs - at;
}
