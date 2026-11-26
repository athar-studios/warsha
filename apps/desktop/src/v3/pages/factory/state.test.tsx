import type { RunSummary, WarshaEvent } from '@warsha/client';
import { describe, expect, it } from 'vitest';

import { idleMsOf, placeWaitingAgents, reduceEvents } from './state';

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

  it('waits on the owner when the last role-bearing event is an AgentStep at a gate', () => {
    const agents = reduceEvents([
      event({ kind: 'AgentStep', stage: 'gate_a', payload: { role: 'coder', stage: 'gate_a' } }),
      event({
        id: 'e2',
        kind: 'StageStarted',
        role: null,
        stage: 'gate_a',
        payload: { action: 'followup' },
        createdAt: '2026-11-18T10:00:01.000Z',
      }),
    ]);
    const agent = agents.get('run-1:coder');
    expect(agent?.state).toBe('waiting_on_owner');
    expect(agent?.stage).toBe('gate_a');
  });

  it('places a run at an undecided gate from the role-less StageStarted the pipeline writes', () => {
    // advance_stage_locked emits StageStarted with role: None and stage = next.
    // The last role-bearing event is the previous stage's AgentStep.
    const agents = reduceEvents([
      event({ kind: 'AgentStep', stage: 'design', payload: { role: 'designer' } }),
      event({
        id: 'e2',
        kind: 'StageStarted',
        role: null,
        stage: 'gate_a',
        payload: { from: 'design', to: 'gate_a' },
        createdAt: '2026-11-18T10:00:01.000Z',
      }),
    ]);
    const agent = agents.get('run-1:coder');
    expect(agent?.state).toBe('waiting_on_owner');
    expect(agent?.stage).toBe('gate_a');
  });

  it('does not treat a finished or cancelled run as waiting', () => {
    const finished = reduceEvents([
      event({ kind: 'AgentStep', stage: 'gate_a' }),
      event({
        id: 'e2',
        kind: 'RunFinished',
        role: null,
        payload: { status: 'cancelled' },
        createdAt: '2026-11-18T10:00:02.000Z',
      }),
    ]);
    expect(finished.get('run-1:coder')?.state).toBe('done');
  });

  it('leaves an idle agent with no gate in the idle state', () => {
    const agents = reduceEvents([event({ kind: 'CostRecorded', stage: 'code' })]);
    expect(agents.get('run-1:coder')?.state).toBe('idle');
  });

  it('derives waiting from a non-terminal run row whose stage is still a gate', () => {
    const run = {
      id: 'run-9',
      projectId: 'p1',
      stage: 'gate_b',
      status: 'running',
      updatedAt: '2026-11-18T10:00:00.000Z',
    } as RunSummary;
    const empty = placeWaitingAgents(new Map(), [run]);
    expect(empty.get('run-9:owner')?.state).toBe('waiting_on_owner');
    expect(empty.get('run-9:owner')?.stage).toBe('gate_b');
    const cancelled = placeWaitingAgents(new Map(), [{ ...run, status: 'cancelled' }]);
    expect(cancelled.size).toBe(0);
    const working = placeWaitingAgents(new Map(), [{ ...run, stage: 'code' }]);
    expect(working.size).toBe(0);
  });

  it('transitions active non-gate running agents to working on snake_case wire events', () => {
    const research = reduceEvents([
      event({
        id: 'e1',
        kind: 'stage_started',
        role: null,
        stage: 'idea',
        payload: { action: 'start_run' },
      }),
      event({ id: 'e2', kind: 'agent_step', stage: 'research', role: 'researcher' }),
      event({
        id: 'e3',
        kind: 'tool_call',
        stage: 'research',
        role: 'researcher',
        payload: { tool: 'web_search' },
        costCents: 4,
      }),
    ]);
    const researcher = research.get('run-1:researcher');
    expect(researcher?.state).toBe('working');
    expect(researcher?.stage).toBe('research');
    expect(researcher?.lastAction).toBe('tool_call: web_search');
    expect(researcher?.costCents).toBe(4);

    const designGateAndResume = reduceEvents([
      event({ id: 'e1', kind: 'agent_step', stage: 'design', role: 'designer' }),
      event({
        id: 'e2',
        kind: 'stage_started',
        role: null,
        stage: 'gate_a',
        payload: { from: 'design', to: 'gate_a' },
      }),
      event({
        id: 'e3',
        kind: 'gate_decision',
        role: null,
        stage: 'gate_a',
        payload: { decision: 'approved' },
      }),
      event({
        id: 'e4',
        kind: 'stage_started',
        role: null,
        stage: 'design',
        payload: { from: 'gate_a', to: 'design' },
      }),
      event({ id: 'e5', kind: 'stage_completed', stage: 'design', role: 'designer' }),
    ]);
    const designer = designGateAndResume.get('run-1:designer');
    expect(designer?.state).toBe('working');
    expect(designer?.stage).toBe('design');

    const pendingGate = reduceEvents([
      event({ id: 'e1', kind: 'gate_decision', stage: 'gate_b', payload: { state: 'pending' } }),
    ]);
    expect(pendingGate.get('run-1:coder')?.state).toBe('waiting_on_owner');

    const finished = reduceEvents([
      event({ id: 'e1', kind: 'agent_step', stage: 'code', role: 'coder' }),
      event({ id: 'e2', kind: 'run_finished', role: null, payload: { status: 'completed' } }),
    ]);
    expect(finished.get('run-1:coder')?.state).toBe('done');
  });
});
