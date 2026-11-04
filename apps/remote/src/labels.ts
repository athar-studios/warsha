// @warsha/remote — the words a reading is said with.
//
// `@warsha/ui` is catalog-free by rule (docs/design/REDESIGN.md §6): a compound never reads the
// catalog, so every label arrives from the screen. This file is where the phone does that translating —
// a daemon enum name in, the owner's word out — and it is a module rather than a component because a
// word list should not cause a render.
//
// Nothing here falls back to a literal: `t()` returns the key itself when the catalog has no entry, and
// `packages/i18n/src/index.test.ts` pins every key this file names, so a missing string is a failing
// test rather than `gates.label.gate_b` printed on a phone.
import type { GateState } from '@warsha/client';
import { t, type Locale } from '@warsha/i18n';
// The gate's *state* is the daemon's shape (`{ state: 'rejected', reason, by, at }`), while the moves it
// answers to are the design system's (`approve` / `reject` / `changes_requested`). Both packages name a
// type `GateState`, so the client's is imported by name and the UI's is never needed here.
import type { GateCardLabels, GateDecision } from '@warsha/ui';

/** The gate card's whole label set, resolved from the live locale (§6: labels arrive as props). */
export function gateCardLabels(locale: Locale): GateCardLabels {
  const label = (key: string): string => t(key, {}, locale);
  return {
    gate: label('gates.word'),
    approve: label('gates.approve'),
    reject: label('gates.reject'),
    requestChanges: label('gates.request_changes'),
    reason: label('gates.reason_label'),
    reasonHint: label('gates.reason_hint'),
    confirm: label('gates.record'),
    cancel: label('common.cancel'),
    approved: label('gates.approved'),
    rejected: label('gates.rejected'),
    changesRequested: label('gates.changes_requested'),
    waiting: label('gates.pending'),
    required: label('gates.reason_required'),
  };
}

/** The three moves mapped onto `GateCard`'s own state names (§6: actions map 1:1 to the machine). */
export function gateCardState(state: GateState): 'pending' | GateDecision {
  switch (state.state) {
    case 'approved':
      return 'approve';
    case 'rejected':
      return 'reject';
    case 'changes_requested':
      return 'changes_requested';
    default:
      return 'pending';
  }
}

/** The state word a ledger row shows beside the lamp: pending, approved, rejected, changes requested. */
export function gateStateWord(state: GateState, locale: Locale): string {
  switch (state.state) {
    case 'approved':
      return t('gates.approved', {}, locale);
    case 'rejected':
      return t('gates.rejected', {}, locale);
    case 'changes_requested':
      return t('gates.changes_requested', {}, locale);
    default:
      return t('gates.pending', {}, locale);
  }
}

/** The lamp state that says the same thing without colour (§9: lamp + word + glyph). */
export function gateLampState(state: GateState): 'waiting' | 'ok' | 'fail' {
  switch (state.state) {
    case 'approved':
      return 'ok';
    case 'rejected':
      return 'fail';
    case 'changes_requested':
      return 'fail';
    default:
      return 'waiting';
  }
}

/** What a decided gate recorded, as the text the team reads, or `null` while it waits. */
export function gateRecordNote(state: GateState): string | null {
  switch (state.state) {
    case 'rejected':
      return state.reason;
    case 'changes_requested':
      return state.notes;
    default:
      return null;
  }
}

/** Which of the two recorded texts a decision carries: a reason for a refusal, notes for changes. */
export function gateRecordWord(state: GateState, locale: Locale): string | null {
  switch (state.state) {
    case 'rejected':
      return t('gates.recorded_reason', {}, locale);
    case 'changes_requested':
      return t('gates.recorded_notes', {}, locale);
    default:
      return null;
  }
}

/** A gate stage's word ("البوابة ب"), or the pipeline stage's word for any other stage. */
export function stageWord(stage: string, locale: Locale): string {
  if (stage.startsWith('gate_')) return t(`gates.label.${stage}`, {}, locale);
  return t(`run.stage.${stage}`, {}, locale);
}

/**
 * The run's status word, or the raw status when the daemon reports one this app has no word for.
 *
 * A status the catalog does not name is shown as machine data rather than guessed at: inventing
 * "completed" for a status called `archived` would be a claim about the owner's work.
 *
 * `awaiting_gate` is *not* one of those: it is a state the run genuinely sits in — parked at a gate,
 * waiting on the owner — and the queue says it in words. Left unmapped it printed the wire name in the
 * owner's ledger row (`run-gate-a · البوابة أ · awaiting_gate`), an untranslated snake_case identifier
 * bare between an Arabic label and a mono id, which §11 forbids and §5's primary screen cannot shrug at.
 */
export function runStatusWord(status: string, locale: Locale): string {
  switch (status) {
    case 'running':
      return t('run.state_running', {}, locale);
    case 'awaiting_gate':
      return t('run.state_awaiting_gate', {}, locale);
    case 'completed':
      return t('run.state_completed', {}, locale);
    case 'failed':
      return t('run.state_failed', {}, locale);
    case 'paused':
      return t('remote.run_state_paused', {}, locale);
    case 'cancelled':
      return t('remote.run_state_cancelled', {}, locale);
    default:
      return status;
  }
}

/** Does this status need the owner to look at it? The lamp's `working`/`fail` choice (§1). */
export function runLampState(status: string): 'working' | 'ok' | 'fail' | 'idle' {
  switch (status) {
    case 'running':
      return 'working';
    case 'completed':
      return 'ok';
    case 'failed':
      return 'fail';
    default:
      return 'idle';
  }
}

/**
 * Whether an event kind is one the bench lights for.
 *
 * The daemon's `EventKind` is a snake_case wire name (`warsha_core::EventKind`); a gate event is the
 * one that interrupts, and an error is the one that must not be filtered away (§3: a filter never
 * hides gate events).
 */
export function isGateEvent(kind: string): boolean {
  return kind.includes('gate');
}

/** Is this an event that says something went wrong? */
export function isErrorEvent(kind: string): boolean {
  return /error|fail|refus|denied|exceeded/i.test(kind);
}

/**
 * The plain-language word for what an event says happened.
 *
 * §3's rule for the phone: no tool names, no JSON, no wire identifiers in a Simple reading. The daemon's
 * `EventKind` is a machine name, so it selects a word here and the word is what the owner reads; the
 * stage beside it names which part of the work the event belongs to.
 */
export function eventWord(kind: string, locale: Locale): string {
  if (isErrorEvent(kind)) return t('remote.event_error', {}, locale);
  if (isGateEvent(kind)) return t('remote.event_gate', {}, locale);
  if (kind.includes('cost') || kind.includes('budget')) return t('remote.event_cost', {}, locale);
  if (kind.includes('artifact')) return t('remote.event_artifact', {}, locale);
  if (kind.includes('completed')) return t('remote.event_completed', {}, locale);
  if (kind.includes('started')) return t('remote.event_started', {}, locale);
  return t('remote.event_other', {}, locale);
}

/** The role's one-word name, or `null` for an event that names no role. */
export function roleWord(role: string | null, locale: Locale): string | null {
  if (role === null) return null;
  return t(`role.${role}`, {}, locale);
}
