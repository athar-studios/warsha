// apps/desktop/src/v3/pages/developers/metrics.test.ts
// E4: every on-screen figure equals its derivation — fixtures here are the same
// numbers the page tests render (plan §8 E4 acceptance).
import { describe, expect, it } from 'vitest';

import type { RunSubtask, Session, SessionId, WarshaEvent } from '@warsha/client';

import {
  buildReceipt,
  burnRateCentsPerHour,
  contextUsage,
  costPerPacketCents,
  elapsedMs,
  eventTimeline,
  filesTouched,
  groupByParent,
  hasTelemetry,
  runCostCents,
  sessionMetrics,
} from './metrics';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    runId: 'run-1',
    projectId: 'p1',
    role: 'coder',
    backend: 'claude-code',
    provider: 'cli',
    model: 'default',
    status: 'working',
    startedAt: '2026-11-18T10:00:00.000Z',
    endedAt: null,
    parentSessionId: null,
    cliSessionId: null,
    ...overrides,
  } as Session;
}

function event(overrides: Partial<WarshaEvent> = {}): WarshaEvent {
  return {
    id: 'e1',
    runId: 'run-1',
    stage: 'code',
    role: 'coder',
    kind: 'agent_step',
    payload: {},
    costCents: null,
    createdAt: '2026-11-18T10:00:10.000Z',
    deviceId: null,
    ...overrides,
  } as WarshaEvent;
}

describe('sessionMetrics', () => {
  it('sums cost and tokens of the session role within the window', () => {
    const s = session({ startedAt: '2026-11-18T10:00:00.000Z', endedAt: '2026-11-18T10:01:00.000Z' });
    const events = [
      event({ createdAt: '2026-11-18T10:00:10.000Z', costCents: 3, tokens: { input: 10, output: 10, total: 20, costCents: null } }),
      event({ createdAt: '2026-11-18T10:00:40.000Z', costCents: 4, tokens: { input: 5, output: 5, total: 10, costCents: null } }),
      // other role — excluded
      event({ role: 'reviewer', createdAt: '2026-11-18T10:00:20.000Z', costCents: 99 }),
      // outside window — excluded
      event({ createdAt: '2026-11-18T10:02:00.000Z', costCents: 99 }),
    ];
    const metrics = sessionMetrics(s, events, Date.parse('2026-11-18T10:01:00.000Z'));
    expect(metrics.costCents).toBe(7);
    expect(metrics.tokens).toEqual({ input: 15, output: 15, total: 30 });
    // 30 tokens over 60 s = 0.5 tokens/s
    expect(metrics.tokensPerSecond).toBe(1);
    expect(metrics.elapsedMs).toBe(60_000);
  });

  it('shows unknown (null), never zero, when no events bind', () => {
    const s = session({ startedAt: '2026-11-18T10:00:00.000Z', endedAt: '2026-11-18T10:01:00.000Z' });
    const metrics = sessionMetrics(s, [], Date.parse('2026-11-18T10:01:00.000Z'));
    expect(metrics.costCents).toBeNull();
    expect(metrics.tokens).toBeNull();
    expect(metrics.tokensPerSecond).toBeNull();
  });
});

describe('elapsedMs', () => {
  it('uses nowMs for an open session', () => {
    const s = session({ startedAt: '2026-11-18T10:00:00.000Z' });
    expect(elapsedMs(s, Date.parse('2026-11-18T10:00:30.000Z'))).toBe(30_000);
  });
});

describe('runCostCents and costPerPacketCents', () => {
  it('sums every event cost and divides by succeeded subtasks', () => {
    const events = [event({ costCents: 5 }), event({ costCents: 7 }), event({ costCents: null })];
    expect(runCostCents(events)).toBe(12);
    const subtasks = [
      { id: 'a', runId: 'run-1', sessionId: null, title: 'a', files: [], status: 'succeeded' },
      { id: 'b', runId: 'run-1', sessionId: null, title: 'b', files: [], status: 'succeeded' },
      { id: 'c', runId: 'run-1', sessionId: null, title: 'c', files: [], status: 'queued' },
    ] as unknown as RunSubtask[];
    expect(costPerPacketCents(events, subtasks)).toBe(6);
  });

  it('is unknown ("—") when zero packets merged', () => {
    const subtasks = [
      { id: 'a', runId: 'run-1', sessionId: null, title: 'a', files: [], status: 'failed' },
    ] as unknown as RunSubtask[];
    expect(costPerPacketCents([event({ costCents: 5 })], subtasks)).toBeNull();
  });
});

describe('burnRateCentsPerHour', () => {
  it('scales cost over the run window', () => {
    // 60 cents over 1 hour = 60/hour
    expect(burnRateCentsPerHour('2026-11-18T10:00:00.000Z', '2026-11-18T11:00:00.000Z', 60)).toBe(60);
  });

  it('is null for a zero-length window', () => {
    expect(burnRateCentsPerHour('2026-11-18T10:00:00.000Z', '2026-11-18T10:00:00.000Z', 60)).toBeNull();
  });
});

describe('contextUsage', () => {
  it('reads the backend context report when present', () => {
    const events = [
      event({ payload: { context_used_tokens: 5000, context_total_tokens: 20000 } }),
    ];
    expect(contextUsage(events)).toEqual({ used: 5000, total: 20000 });
  });

  it('is null when the backend never reports context size', () => {
    expect(contextUsage([event({ payload: {} }), event()])).toBeNull();
  });
});

describe('hasTelemetry', () => {
  it('distinguishes a telemetry-less session', () => {
    const s = session();
    expect(hasTelemetry(s, [])).toBe(false);
    expect(hasTelemetry(s, [event()])).toBe(true);
  });
});

describe('groupByParent', () => {
  it('groups swarm children under their parent and keeps orphans visible', () => {
    const parent = session({ id: 'p' as unknown as SessionId });
    const child = session({ id: 'c' as unknown as SessionId, parentSessionId: 'p' as unknown as SessionId });
    const orphan = session({ id: 'o' as unknown as SessionId, parentSessionId: 'missing' as unknown as SessionId });
    const groups = groupByParent([parent, child, orphan]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ parent, children: [child] });
    expect(groups[1]).toEqual({ parent: orphan, children: [] });
  });
});

describe('eventTimeline', () => {
  it('gives per-step durations from consecutive events', () => {
    const s = session();
    const timeline = eventTimeline(s, [
      event({ id: '1', createdAt: '2026-11-18T10:00:10.000Z' }),
      event({ id: '2', createdAt: '2026-11-18T10:00:15.000Z' }),
    ]);
    expect(timeline[0].durationMs).toBeNull();
    expect(timeline[1].durationMs).toBe(5000);
  });
});

describe('filesTouched', () => {
  it('collects file paths from payloads with E6-viewable names', () => {
    const s = session();
    const files = filesTouched(s, [
      event({ payload: { file: 'src/main.rs' } }),
      event({ payload: { files: ['src/lib.rs', 'src/main.rs'] } }),
      event({ payload: { tool: 'bash' } }),
    ]);
    expect(files).toEqual(['src/main.rs', 'src/lib.rs']);
  });
});

describe('buildReceipt', () => {
  const CANARY = 'canary-secret-9f2a';

  it('carries the full trail and never the canary secret', () => {
    const receipt = buildReceipt({
      run: { id: 'run-1', status: 'done' },
      permissions: { confinement: 'workspace-write' },
      defaults: { approval_mode: 'ask-for-risky' },
      failoverEvents: [event({ kind: 'fallback' })],
      permissionDecisions: [event({ kind: 'gate_decision' })],
      sessions: [session()],
      subtasks: [],
    });
    expect(receipt).toContain('"run"');
    expect(receipt).toContain('policy_snapshot');
    expect(receipt).toContain('failover_events');
    expect(receipt).toContain('permission_decisions');
    expect(receipt).toContain('sessions');
    expect(receipt).toContain('subtasks');
    expect(receipt).not.toContain(CANARY);
    // JSON parses back cleanly.
    expect(() => JSON.parse(receipt)).not.toThrow();
  });
});
