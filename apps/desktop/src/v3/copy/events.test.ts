import { describe, expect, it } from 'vitest';

import { EVENT_KIND_TO_KEY, getEventKey } from './events';

describe('events copy mapping', () => {
  const allKinds = [
    'stage_started',
    'stage_completed',
    'gate_decision',
    'agent_step',
    'tool_call',
    'artifact_created',
    'artifact_updated',
    'cost_recorded',
    'error',
    'fallback',
    'budget_warning',
    'budget_exceeded',
  ];

  it('maps every EventKind to a catalog key', () => {
    for (const kind of allKinds) {
      expect(EVENT_KIND_TO_KEY[kind]).toBe(`events.${kind}`);
      expect(getEventKey(kind)).toBe(`events.${kind}`);
    }
  });

  it('falls back to events.unknown for unrecognized kinds', () => {
    expect(getEventKey('unexpected_event_kind')).toBe('events.unknown');
  });
});
