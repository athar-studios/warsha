import type { DaemonStage } from '../../copy/stages';

export type BenchTabId =
  | 'overview'
  | 'plan'
  | 'files'
  | 'changes'
  | 'terminal'
  | 'team'
  | 'assistant'
  | 'cost'
  | 'artifacts'
  | 'preview';

export const BENCH_TABS: readonly BenchTabId[] = [
  'overview',
  'plan',
  'files',
  'changes',
  'terminal',
  'team',
  'assistant',
  'cost',
  'artifacts',
  'preview',
];

export const ALL_DAEMON_STAGES: readonly DaemonStage[] = [
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

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  todos?: Array<{ id: string; description: string; status: string }>;
  tools?: Array<{ success: boolean; output: string }>;
}
