/**
 * Plain-language stages map and gate questions (UI_V3_PLAN §4).
 *
 * Maps all 14 daemon stages into 5 Simple stages:
 * - idea, gate_a -> idea
 * - research, prd_spec, gate_b, design, plan_tasks -> plan
 * - code -> build
 * - review_qa_security, gate_c -> qa
 * - release, gate_d, launch_drafts, feedback -> delivery
 */

export type DaemonStage =
  | 'idea'
  | 'gate_a'
  | 'research'
  | 'prd_spec'
  | 'gate_b'
  | 'design'
  | 'plan_tasks'
  | 'code'
  | 'review_qa_security'
  | 'gate_c'
  | 'release'
  | 'gate_d'
  | 'launch_drafts'
  | 'feedback';

export type SimpleStage = 'idea' | 'plan' | 'build' | 'qa' | 'delivery';

export const DAEMON_TO_SIMPLE_STAGE: Record<DaemonStage, SimpleStage> = {
  idea: 'idea',
  gate_a: 'idea',
  research: 'plan',
  prd_spec: 'plan',
  gate_b: 'plan',
  design: 'plan',
  plan_tasks: 'plan',
  code: 'build',
  review_qa_security: 'qa',
  gate_c: 'qa',
  release: 'delivery',
  gate_d: 'delivery',
  launch_drafts: 'delivery',
  feedback: 'delivery',
};

export const SIMPLE_STAGE_LABEL_KEYS: Record<SimpleStage, string> = {
  idea: 'stages.idea',
  plan: 'stages.plan',
  build: 'stages.build',
  qa: 'stages.qa',
  delivery: 'stages.delivery',
};

export const GATE_QUESTIONS: Record<'a' | 'b' | 'c' | 'd', string> = {
  a: 'gate.question.a',
  b: 'gate.question.b',
  c: 'gate.question.c',
  d: 'gate.question.d',
};

export function toSimpleStage(stage: DaemonStage | string): SimpleStage {
  return (DAEMON_TO_SIMPLE_STAGE as Record<string, SimpleStage>)[stage] ?? 'idea';
}

export function getSimpleStageLabelKey(stage: DaemonStage | string): string {
  const simple = toSimpleStage(stage);
  return SIMPLE_STAGE_LABEL_KEYS[simple];
}

export function getGateQuestionKey(gate: 'a' | 'b' | 'c' | 'd' | string): string {
  const normalized = gate.toLowerCase();
  return (GATE_QUESTIONS as Record<string, string>)[normalized] ?? 'gate.question.a';
}
