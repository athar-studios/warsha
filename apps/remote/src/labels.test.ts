// @warsha/remote — the reading of a daemon value into the owner's word.
//
// These are the mappings that let the screens carry no literals: a state machine name in, catalog copy
// out. The exact strings are the contract the tests and the owner both read, so they are pinned here and
// in `packages/i18n/src/index.test.ts`.
import type { DeviceId, GateState, Stage } from '@warsha/client';
import { describe, expect, it } from 'vitest';

import {
  eventWord,
  gateCardLabels,
  gateCardState,
  gateLampState,
  gateRecordNote,
  gateRecordWord,
  gateStateWord,
  isErrorEvent,
  isGateEvent,
  roleWord,
  runLampState,
  runStatusWord,
  stageWord,
} from './labels';

const PENDING: GateState = { state: 'pending' };
const DESKTOP = 'device-desktop' as DeviceId;
const PHONE = 'device-phone' as DeviceId;
const APPROVED: GateState = { state: 'approved', by: DESKTOP, at: '2026-11-02T10:00:00.000Z' };
const REJECTED: GateState = {
  state: 'rejected',
  reason: 'المخطط يترك باباً مفتوحاً',
  by: DESKTOP,
  at: '2026-11-02T10:00:00.000Z',
};
const CHANGES: GateState = {
  state: 'changes_requested',
  notes: 'أضف اختبار الاسترجاع',
  by: PHONE,
  at: '2026-11-02T10:00:00.000Z',
};

describe('gateCardLabels', () => {
  it('hands GateCard the three moves in the live language', () => {
    expect(gateCardLabels('en')).toMatchObject({
      approve: 'Approve',
      reject: 'Reject',
      requestChanges: 'Request Changes',
      confirm: 'Record the decision',
      cancel: 'Cancel',
    });
    expect(gateCardLabels('ar')).toMatchObject({
      approve: 'موافقة',
      reject: 'رفض',
      requestChanges: 'طلب تعديلات',
    });
  });

  it('carries the reason step and the stamp words, because the card owns both', () => {
    const labels = gateCardLabels('en');
    expect(labels.reason).toBe('Reason');
    expect(labels.required).toBe('A reason is required so the team knows what to change.');
    expect(labels.approved).toBe('Approved');
    expect(labels.waiting).toBe('Pending');
  });
});

describe('gateCardState', () => {
  it('maps the daemon\'s four states onto the card\'s three moves plus pending', () => {
    expect(gateCardState(PENDING)).toBe('pending');
    expect(gateCardState(APPROVED)).toBe('approve');
    expect(gateCardState(REJECTED)).toBe('reject');
    expect(gateCardState(CHANGES)).toBe('changes_requested');
  });
});

describe('gateStateWord and gateLampState', () => {
  it('says the state in a word and lights the lamp that means it (§9: never colour alone)', () => {
    expect(gateStateWord(PENDING, 'en')).toBe('Pending');
    expect(gateStateWord(PENDING, 'ar')).toBe('في الانتظار');
    expect(gateStateWord(APPROVED, 'en')).toBe('Approved');
    expect(gateStateWord(CHANGES, 'en')).toBe('Changes Requested');
    expect(gateLampState(PENDING)).toBe('waiting');
    expect(gateLampState(APPROVED)).toBe('ok');
    expect(gateLampState(REJECTED)).toBe('fail');
  });
});

describe('gateRecordNote and gateRecordWord', () => {
  it('reads the note a refusal carries and names which kind it is', () => {
    expect(gateRecordNote(REJECTED)).toBe('المخطط يترك باباً مفتوحاً');
    expect(gateRecordWord(REJECTED, 'en')).toBe('Reason for the rejection');
    expect(gateRecordNote(CHANGES)).toBe('أضف اختبار الاسترجاع');
    expect(gateRecordWord(CHANGES, 'en')).toBe('Notes for the changes');
  });

  it('has nothing to show for a gate that is still waiting, or one simply approved', () => {
    expect(gateRecordNote(PENDING)).toBeNull();
    expect(gateRecordNote(APPROVED)).toBeNull();
    expect(gateRecordWord(APPROVED, 'en')).toBeNull();
  });
});

describe('stageWord', () => {
  it('names a gate with the gate words and a pipeline stage with the stage words', () => {
    expect(stageWord('gate_b', 'en')).toBe('Gate B');
    expect(stageWord('gate_b', 'ar')).toBe('البوابة ب');
    expect(stageWord('code', 'en')).toBe('Code');
    expect(stageWord('review_qa_security', 'en')).toBe('Review/QA/Sec');
  });

  it('is what the pipeline plate is built from, for every stage the daemon can name', () => {
    const stages: Stage[] = ['idea', 'gate_a', 'research', 'prd_spec', 'code', 'feedback'];
    for (const stage of stages) {
      expect(stageWord(stage, 'en'), `${stage} lost its word`).not.toBe(stage);
      expect(stageWord(stage, 'ar'), `${stage} lost its Arabic word`).not.toBe(stage);
    }
  });
});

describe('runStatusWord and runLampState', () => {
  it('words the statuses the daemon answers with', () => {
    expect(runStatusWord('running', 'en')).toBe('running');
    expect(runStatusWord('completed', 'ar')).toBe('اكتمل');
    expect(runStatusWord('paused', 'en')).toBe('paused');
    expect(runStatusWord('cancelled', 'ar')).toBe('ملغى');
    expect(runLampState('running')).toBe('working');
    expect(runLampState('failed')).toBe('fail');
    expect(runLampState('completed')).toBe('ok');
  });

  it('shows a status this app has no word for as machine data, never as a guess', () => {
    // Inventing "completed" for a status called `archived` would be a claim about the owner's work.
    expect(runStatusWord('archived', 'en')).toBe('archived');
    expect(runLampState('archived')).toBe('idle');
  });
});

describe('eventWord', () => {
  it('turns a wire kind into a plain-language line (§3: no tool names on a phone)', () => {
    expect(eventWord('stage_started', 'en')).toBe('a stage started');
    expect(eventWord('stage_completed', 'en')).toBe('a stage completed');
    expect(eventWord('gate_decision', 'en')).toBe('a gate decision');
    expect(eventWord('cost_recorded', 'en')).toBe('a cost recorded');
    expect(eventWord('budget_exceeded', 'en')).toBe('an error');
    expect(eventWord('artifact_created', 'en')).toBe('an artifact');
    expect(eventWord('agent_step', 'en')).toBe('an event');
    expect(eventWord('tool_call', 'ar')).toBe('حدث');
  });
});

describe('roleWord', () => {
  it('names the role that spoke, and nothing when the event names no role', () => {
    expect(roleWord('coder', 'en')).toBe('Coder');
    expect(roleWord('orchestrator', 'ar')).toBe('المنسق');
    expect(roleWord(null, 'en')).toBeNull();
  });
});

describe('isGateEvent and isErrorEvent', () => {
  it('finds the gate kinds, which are the ones a filter may never hide', () => {
    expect(isGateEvent('gate_decision')).toBe(true);
    expect(isGateEvent('stage_started')).toBe(false);
  });

  it('finds the failure kinds in the words the daemon actually uses', () => {
    expect(isErrorEvent('error')).toBe(true);
    expect(isErrorEvent('budget_exceeded')).toBe(true);
    expect(isErrorEvent('stage_completed')).toBe(false);
  });
});
