import type { RunSummary, WarshaEvent } from '@warsha/client';

/**
 * E3 Factory floor state machine (plan §8, ### E3).
 *
 * The floor derives per-agent states from the persisted run event stream
 * (`runs.events`, `warsha_core::Event` rows as decoded by the client) plus the
 * run row `runs.list` already returns. Daemon events carry `role`, `stage`,
 * `cost_cents` and `tokens` but no session id (`crates/warsha-pipeline/src/lib.rs`
 * AgentStep emitters), so an agent is keyed by `run:role` unless the event
 * payload names the sessions explicitly — the handoff payload must name BOTH
 * sides before any handoff movement.
 *
 * A run sitting at an undecided gate writes no `GateDecision` with
 * `state: pending` (D-RN-FLOOR-1). Waiting is derived from the role-less
 * `StageStarted` the pipeline already appends when it advances onto a gate,
 * and from a non-terminal run row whose `stage` is still that gate.
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

/** Wire names of `warsha_core::Stage` gates. A run whose current stage is one of these has not passed an approval. */
export const GATE_STAGES = new Set(['gate_a', 'gate_b', 'gate_c', 'gate_d']);

/** Statuses a finished run carries. Cancelled stays cancelled; none of these is waiting. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export function isGateStage(stage: string | null | undefined): boolean {
  return typeof stage === 'string' && GATE_STAGES.has(stage);
}

/**
 * The stage a role-less `StageStarted` is announcing.
 *
 * `advance_stage_locked` writes `{from, to}` with `stage` already equal to `to`.
 * A resume from a rejected or changes-requested gate writes `{from_gate}` while
 * `stage` is still the gate and `current_stage` has already moved back to the
 * producing stage — that one is not a wait.
 */
function announcedStage(event: WarshaEvent): string | null {
  const payload = event.payload;
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record['from_gate'] === 'string') return null;
    if (typeof record['to'] === 'string' && record['to'].length > 0) return record['to'];
  }
  return event.stage;
}

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

  // A role-less StageStarted is how the pipeline announces a stage change
  // (advance_stage_locked writes role: None). A gate stage means the run is
  // sitting at an undecided gate — every live agent of that run waits. A
  // non-gate announcement means the run left the gate, so a prior wait ends.
  // It never creates an agent and never knocks a working agent to idle.
  if (event.role === null && event.kind === 'StageStarted') {
    const announced = announcedStage(event);
    if (announced === null) return next;
    const waiting = isGateStage(announced);
    for (const [agentKey, agent] of next) {
      if (agent.runId !== event.runId || agent.state === 'done') continue;
      if (waiting) {
        next.set(agentKey, {
          ...agent,
          state: 'waiting_on_owner',
          stage: announced,
          lastAction: actionOf(event),
          lastUpdated: event.createdAt,
        });
      } else if (agent.state === 'waiting_on_owner') {
        next.set(agentKey, {
          ...agent,
          state: 'working',
          stage: announced,
          lastAction: actionOf(event),
          lastUpdated: event.createdAt,
        });
      }
    }
    return next;
  }

  // A finished/cancelled run emits a role-less RunFinished. That still wins
  // over a gate wait; it must not be dropped the way other role-less events are.
  if (event.role === null && event.kind === 'RunFinished') {
    for (const [agentKey, agent] of next) {
      if (agent.runId !== event.runId || agent.state === 'done') continue;
      next.set(agentKey, {
        ...agent,
        state: 'done',
        lastAction: actionOf(event),
        lastUpdated: event.createdAt,
      });
    }
    return next;
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
  } else if (event.kind === 'AgentStep' && isGateStage(event.stage)) {
    // The required stream shape: a role-bearing step whose stage is the gate
    // is the owner waiting, not an agent still working that stage.
    updated = { ...updated, state: 'waiting_on_owner', lastAction: actionOf(event) };
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
 * Place agents for runs the persisted row already shows sitting at a gate.
 *
 * `runs.list` returns `stage` + `status` and not `gate_states`. A non-terminal
 * run whose current stage is still a gate has not passed that approval
 * (`advance_stage_locked` refuses until `GateState::Approved`), so its live
 * agents wait even when the event stream never wrote `state: pending`. A cold
 * history that created no agent still gets one marker, so the floor is not
 * empty. Finished, failed, and cancelled runs are left alone.
 */
export function placeWaitingAgents(
  agents: Map<string, AgentStatus>,
  runs: readonly RunSummary[]
): Map<string, AgentStatus> {
  const next = new Map(agents);
  for (const run of runs) {
    if (!isGateStage(run.stage) || TERMINAL_STATUSES.has(run.status)) continue;
    let placed = false;
    for (const [key, agent] of next) {
      if (agent.runId !== run.id || agent.state === 'done') continue;
      placed = true;
      if (agent.state === 'waiting_on_owner' && agent.stage === run.stage) continue;
      next.set(key, {
        ...agent,
        state: 'waiting_on_owner',
        stage: run.stage,
        lastAction: agent.lastAction || 'gate',
      });
    }
    if (placed) continue;
    const key = `${run.id}:owner`;
    next.set(key, {
      key,
      runId: run.id,
      role: 'owner',
      state: 'waiting_on_owner',
      stage: run.stage,
      lastAction: 'gate',
      lastUpdated: run.updatedAt,
      costCents: 0,
      model: null,
      handoffFrom: null,
    });
  }
  return next;
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
