import { describe, expect, it } from 'vitest';

import {
  DAEMON_TO_SIMPLE_STAGE,
  GATE_QUESTIONS,
  getGateQuestionKey,
  getSimpleStageLabelKey,
  toSimpleStage,
  type DaemonStage,
} from './stages';

describe('stages copy mapping', () => {
  const allDaemonStages: DaemonStage[] = [
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

  it('maps all 14 daemon stages to the 5 simple stages', () => {
    for (const stage of allDaemonStages) {
      const simple = toSimpleStage(stage);
      expect(['idea', 'plan', 'build', 'qa', 'delivery']).toContain(simple);
      expect(DAEMON_TO_SIMPLE_STAGE[stage]).toBe(simple);
    }
  });

  it('maps idea and gate_a to idea', () => {
    expect(toSimpleStage('idea')).toBe('idea');
    expect(toSimpleStage('gate_a')).toBe('idea');
    expect(getSimpleStageLabelKey('idea')).toBe('stages.idea');
  });

  it('maps research, prd_spec, gate_b, design, plan_tasks to plan', () => {
    expect(toSimpleStage('research')).toBe('plan');
    expect(toSimpleStage('prd_spec')).toBe('plan');
    expect(toSimpleStage('gate_b')).toBe('plan');
    expect(toSimpleStage('design')).toBe('plan');
    expect(toSimpleStage('plan_tasks')).toBe('plan');
    expect(getSimpleStageLabelKey('plan_tasks')).toBe('stages.plan');
  });

  it('maps code to build', () => {
    expect(toSimpleStage('code')).toBe('build');
    expect(getSimpleStageLabelKey('code')).toBe('stages.build');
  });

  it('maps review_qa_security and gate_c to qa', () => {
    expect(toSimpleStage('review_qa_security')).toBe('qa');
    expect(toSimpleStage('gate_c')).toBe('qa');
    expect(getSimpleStageLabelKey('gate_c')).toBe('stages.qa');
  });

  it('maps release, gate_d, launch_drafts, feedback to delivery', () => {
    expect(toSimpleStage('release')).toBe('delivery');
    expect(toSimpleStage('gate_d')).toBe('delivery');
    expect(toSimpleStage('launch_drafts')).toBe('delivery');
    expect(toSimpleStage('feedback')).toBe('delivery');
    expect(getSimpleStageLabelKey('feedback')).toBe('stages.delivery');
  });

  it('falls back safely for unknown stage', () => {
    expect(toSimpleStage('unknown_stage')).toBe('idea');
  });

  it('provides catalog keys for the 4 gate questions', () => {
    expect(getGateQuestionKey('a')).toBe('gate.question.a');
    expect(getGateQuestionKey('b')).toBe('gate.question.b');
    expect(getGateQuestionKey('c')).toBe('gate.question.c');
    expect(getGateQuestionKey('d')).toBe('gate.question.d');
    expect(getGateQuestionKey('A')).toBe('gate.question.a');
    expect(GATE_QUESTIONS.a).toBe('gate.question.a');
  });
});
