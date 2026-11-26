import type { Role, RunSummary, Stage, WarshaEvent } from '@warsha/client';
import { describe, expect, it } from 'vitest';

import { markerPosition } from './Floor';
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

  it('puts only the announced stage owner to work and marks earlier-stage agents done', () => {
    // The coder's AgentStep only lands after the model call returns, so while a
    // run sits in `code` the only stage signal is the role-less StageStarted the
    // pipeline wrote on advance. The owner of `code` (coder) is the one working
    // there; the agents whose stages are behind the run have finished.
    const agents = reduceEvents([
      event({ id: 'e1', kind: 'AgentStep', stage: 'plan_tasks', role: 'pm' }),
      event({ id: 'e2', kind: 'AgentStep', stage: 'plan_tasks', role: 'coder' }),
      event({
        id: 'e3',
        kind: 'stage_started',
        role: null,
        stage: 'code',
        payload: { from: 'plan_tasks', to: 'code' },
        createdAt: '2026-11-18T10:00:02.000Z',
      }),
    ]);
    expect(agents.get('run-1:coder')?.state).toBe('working');
    expect(agents.get('run-1:coder')?.stage).toBe('code');
    expect(agents.get('run-1:pm')?.state).toBe('done');
    // Done agents go back to the stage their role owns, not the one they were
    // last seen on, so the floor keeps them at their own station (B-1).
    expect(agents.get('run-1:pm')?.stage).toBe('prd_spec');
    expect(agents.size).toBe(2);

    // Done agents are history, not a live station: a later announcement leaves them alone.
    const finished = reduceEvents([
      event({ id: 'e1', kind: 'AgentStep', stage: 'code', role: 'coder' }),
      event({ id: 'e2', kind: 'RunFinished', role: null, createdAt: '2026-11-18T10:00:01.000Z' }),
      event({
        id: 'e3',
        kind: 'stage_started',
        role: null,
        stage: 'release',
        payload: { from: 'code', to: 'release' },
        createdAt: '2026-11-18T10:00:02.000Z',
      }),
    ]);
    expect(finished.get('run-1:coder')?.state).toBe('done');
    expect(finished.get('run-1:coder')?.stage).toBe('code');
    // A finished run is not resurrected by seeding the announced stage's owner.
    expect(finished.get('run-1:release')).toBeUndefined();
    expect(finished.size).toBe(1);
  });

  it('R-5a: entering code after intake..architect leaves only a coder working on code', () => {
    const steps: Array<[Stage, Role]> = [
      ['idea', 'intake'],
      ['research', 'researcher'],
      ['prd_spec', 'pm'],
      ['design', 'designer'],
      ['plan_tasks', 'architect'],
    ];
    const agents = reduceEvents([
      ...steps.map(([stage, role], index) =>
        event({
          id: `e${index}`,
          kind: 'agent_step',
          stage,
          role,
          createdAt: `2026-11-18T10:00:0${index}.000Z`,
        })
      ),
      event({
        id: 'e9',
        kind: 'stage_started',
        role: null,
        stage: 'code',
        payload: { from: 'plan_tasks', to: 'code' },
        createdAt: '2026-11-18T10:00:09.000Z',
      }),
    ]);
    for (const [stage, role] of steps) {
      const agent = agents.get(`run-1:${role}`);
      expect(agent?.state).toBe('done');
      expect(agent?.stage).toBe(stage);
    }
    const coder = agents.get('run-1:coder');
    expect(coder?.state).toBe('working');
    expect(coder?.stage).toBe('code');
    expect(coder?.role).toBe('coder');
    const onCode = [...agents.values()].filter((a) => a.stage === 'code');
    expect(onCode.map((a) => a.key)).toEqual(['run-1:coder']);
    expect([...agents.values()].filter((a) => a.state === 'working')).toHaveLength(1);

    // The coder's own first event updates the seeded marker, never a duplicate.
    const withStep = reduceEvents([
      ...steps.map(([stage, role], index) =>
        event({ id: `e${index}`, kind: 'agent_step', stage, role })
      ),
      event({
        id: 'e9',
        kind: 'stage_started',
        role: null,
        stage: 'code',
        payload: { from: 'plan_tasks', to: 'code' },
      }),
      event({ id: 'e10', kind: 'agent_step', stage: 'code', role: 'coder', costCents: 3 }),
    ]);
    expect([...withStep.values()].filter((a) => a.role === 'coder')).toHaveLength(1);
    expect(withStep.get('run-1:coder')?.costCents).toBe(3);
    expect(withStep.size).toBe(6);
  });

  it('R-5a: gates still park live agents; leaving a gate puts the new stage owner to work', () => {
    const atGate = reduceEvents([
      event({ id: 'e1', kind: 'agent_step', stage: 'prd_spec', role: 'pm' }),
      event({ id: 'e2', kind: 'agent_step', stage: 'prd_spec', role: 'researcher' }),
      event({
        id: 'e3',
        kind: 'stage_started',
        role: null,
        stage: 'gate_b',
        payload: { from: 'prd_spec', to: 'gate_b' },
      }),
    ]);
    for (const key of ['run-1:pm', 'run-1:researcher']) {
      expect(atGate.get(key)?.state).toBe('waiting_on_owner');
      expect(atGate.get(key)?.stage).toBe('gate_b');
    }
    expect(atGate.size).toBe(2);

    const leftGate = reduceEvents([
      event({ id: 'e1', kind: 'agent_step', stage: 'prd_spec', role: 'pm' }),
      event({
        id: 'e2',
        kind: 'stage_started',
        role: null,
        stage: 'gate_b',
        payload: { from: 'prd_spec', to: 'gate_b' },
      }),
      event({
        id: 'e3',
        kind: 'stage_started',
        role: null,
        stage: 'design',
        payload: { from: 'gate_b', to: 'design' },
      }),
    ]);
    expect(leftGate.get('run-1:pm')?.state).toBe('done');
    expect(leftGate.get('run-1:designer')?.state).toBe('working');
    expect(leftGate.get('run-1:designer')?.stage).toBe('design');

    // A gate sending work back to its producing stage puts that owner back to work.
    const backToDesign = reduceEvents([
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
        kind: 'stage_started',
        role: null,
        stage: 'design',
        payload: { from: 'gate_a', to: 'design' },
      }),
    ]);
    expect(backToDesign.get('run-1:designer')?.state).toBe('working');
    expect(backToDesign.size).toBe(1);
  });

  it('B-1: an agent released from a gate done sits at its own station, not the gates', () => {
    const agents = reduceEvents([
      event({ id: 'e1', kind: 'agent_step', stage: 'idea', role: 'intake' }),
      event({
        id: 'e2',
        kind: 'stage_started',
        role: null,
        stage: 'gate_a',
        payload: { from: 'idea', to: 'gate_a' },
        createdAt: '2026-11-18T10:00:01.000Z',
      }),
      event({
        id: 'e3',
        kind: 'stage_started',
        role: null,
        stage: 'research',
        payload: { from: 'gate_a', to: 'research' },
        createdAt: '2026-11-18T10:00:02.000Z',
      }),
    ]);
    const intake = agents.get('run-1:intake');
    if (intake === undefined) throw new Error('missing intake agent');
    expect(intake.state).toBe('done');
    // The gate it was waiting at is left behind: a done agent carries the stage
    // its role owns, so the floor draws it at planning, never at the gates.
    expect(intake.stage).toBe('idea');
    const all = [...agents.values()];
    expect(markerPosition(intake, all.indexOf(intake), all).stationKey).toBe('planning');

    const researcher = agents.get('run-1:researcher');
    if (researcher === undefined) throw new Error('missing researcher agent');
    expect(researcher.state).toBe('working');
    expect(researcher.stage).toBe('research');
    expect(markerPosition(researcher, all.indexOf(researcher), all).stationKey).toBe('planning');
  });

  it('R5A-r1: entering review_qa_security seeds the lead reviewer before its first event', () => {
    const agents = reduceEvents([
      event({
        id: 'e1',
        kind: 'stage_started',
        role: null,
        stage: 'review_qa_security',
        payload: { from: 'code', to: 'review_qa_security' },
      }),
    ]);
    const reviewer = agents.get('run-1:reviewer');
    if (reviewer === undefined) throw new Error('missing seeded reviewer');
    expect(reviewer.state).toBe('working');
    expect(reviewer.stage).toBe('review_qa_security');
    expect(agents.size).toBe(1);

    // A repeated announcement does not seed twice, and the reviewer's own first
    // event lands on the seeded marker instead of creating a second one.
    const withStep = reduceEvents([
      event({
        id: 'e1',
        kind: 'stage_started',
        role: null,
        stage: 'review_qa_security',
        payload: { from: 'code', to: 'review_qa_security' },
      }),
      event({
        id: 'e2',
        kind: 'stage_started',
        role: null,
        stage: 'review_qa_security',
        payload: { from: 'code', to: 'review_qa_security' },
      }),
      event({ id: 'e3', kind: 'agent_step', stage: 'review_qa_security', role: 'reviewer', costCents: 4 }),
    ]);
    expect(withStep.size).toBe(1);
    expect(withStep.get('run-1:reviewer')?.costCents).toBe(4);
    expect(withStep.get('run-1:qa')).toBeUndefined();

    // A shared stage that already has one of its owners on the floor seeds nobody.
    const withQa = reduceEvents([
      event({ id: 'e1', kind: 'agent_step', stage: 'review_qa_security', role: 'qa' }),
      event({
        id: 'e2',
        kind: 'stage_started',
        role: null,
        stage: 'review_qa_security',
        payload: { from: 'code', to: 'review_qa_security' },
      }),
    ]);
    expect(withQa.get('run-1:qa')?.state).toBe('working');
    expect(withQa.get('run-1:reviewer')).toBeUndefined();
    expect(withQa.size).toBe(1);
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
