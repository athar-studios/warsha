/**
 * Plain-language event map (UI_V3_PLAN §4).
 * Every EventKind -> a catalog key.
 */

export const EVENT_KIND_TO_KEY: Record<string, string> = {
  stage_started: 'events.stage_started',
  stage_completed: 'events.stage_completed',
  gate_decision: 'events.gate_decision',
  agent_step: 'events.agent_step',
  tool_call: 'events.tool_call',
  artifact_created: 'events.artifact_created',
  artifact_updated: 'events.artifact_updated',
  cost_recorded: 'events.cost_recorded',
  error: 'events.error',
  fallback: 'events.fallback',
  budget_warning: 'events.budget_warning',
  budget_exceeded: 'events.budget_exceeded',
};

export function getEventKey(kind: string): string {
  return EVENT_KIND_TO_KEY[kind] ?? 'events.unknown';
}
