import { describe, expect, it } from 'vitest';
import type { WarshaEvent } from '@warsha/client';

import { applyEvent, idleMsOf, reduceEvents } from './state';

function event(overrides: Partial<WarshaEvent> = {}): WarshaEvent {
  return {
    id: 'e1',
    runId: 'run-1',
    stage: 'code',
    role: 'coder',
    kind: 'AgentStep',
    payload: {},
    costCents: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    deviceId: null,
    ...overrides,
  } as WarshaEvent;
}

describe('factory floor state machine (E3)', () => {
  it('moves an agent to working on step and tool events', () => {
    const agents = reduceEvents([
      event({ kind: 'AgentStep', payload: { role: 'coder', stage: 'code' } }),
      event({ kind: 'ToolCall', payload: { tool: 'git_status' }, costCents: 2 }),
    ]);
    const agent = agents.get('run-1:coder');
    expect(agent?.state).toBe('working');
    expect(agent?.lastAction).toBe('ToolCall: git_status');
    expect(agent?.costCents).toBe(2);
  });

  it('enters handing_off only when the payload names BOTH sessions', () => {
    const dual = reduceEvents([
      event({ payload: { handoff_from: 'run-1:coder', handoff_to: 's-reviewer' } }),
    ]);
    expect(dual.get('s-reviewer')?.state).toBe('handing_off');
    expect(dual.get('s-reviewer')?.handoffFrom).toBe('run-1:coder');
    const oneSided = reduceEvents([
      event({ kind: 'CostRecorded', payload: { handoff_from: 'run-1:coder' } }),
    ]);
    expect(oneSided.size).toBe(1);
    expect(oneSided.get('run-1:coder')?.state).toBe('idle');
  });

  it('waits on the owner at a pending gate', () => {
    const agents = reduceEvents([event({ kind: 'GateDecision', payload: { state: 'pending' } })]);
    expect(agents.get('run-1:coder')?.state).toBe('waiting_on_owner');
  });

  it('finishes done on RunFinished and stays idle-neutral on bookkeeping events', () => {
    const finished = reduceEvents([event({ kind: 'RunFinished' })]);
    expect(finished.get('run-1:coder')?.state).toBe('done');
    const booked = reduceEvents([event({ kind: 'CostRecorded', costCents: 5 })]);
    expect(booked.get('run-1:coder')?.state).toBe('idle');
    expect(booked.get('run-1:coder')?.costCents).toBe(5);
  });

  it('ignores events without a role and without a named session', () => {
    const agents = reduceEvents([event({ role: null, payload: { action: 'followup' } })]);
    expect(agents.size).toBe(0);
  });

  it('derives idle duration from the last event time', () => {
    const agents = reduceEvents([event({ kind: 'CostRecorded' })]);
    const agent = agents.get('run-1:coder');
    expect(agent).toBeDefined();
    expect(
      idleMsOf(agent as NonNullable<typeof agent>, Date.parse('2026-11-18T10:00:05.000Z'))
    ).toBe(5000);
    expect(
      idleMsOf(agent as NonNullable<typeof agent>, Date.parse('2026-11-18T10:00:00.000Z'))
    ).toBe(0);
  });

  it('keeps the model from the payload when a backend reports one', () => {
    const agents = reduceEvents([event({ payload: { model: 'qwen-coder' } })]);
    expect(agents.get('run-1:coder')?.model).toBe('qwen-coder');
  });
});
