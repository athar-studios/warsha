// @warsha/ui — GateCard: the one object allowed to interrupt the transcript.
//
// §1 says the gate card is the only place the bench raises a shadow, and §6 says its actions map 1:1 to
// Warsha's gate state machine: `approve`, `reject(reason)`, `changes_requested(notes)`. So this component
// owns three things and nothing else:
//
//   * **the gate's id** — the card is about one gate, and the decision callback carries that id so a screen
//     never has to remember which card it is wiring;
//   * **the required half of a refusal** — rejecting or asking for changes needs a reason (§7: "notes
//     required for reject/changes"). The step is a real labelled field, the confirm is validated on submit
//     with `aria-invalid` and an inline `role="alert"` (never a disabled button that says nothing), Escape
//     cancels it and focus returns to the control that opened it;
//   * **the record it leaves** — a decided gate shows a `Stamp` (§1.4: a pressed-metal record, not a colour)
//     with the acting device beside it, and the action row disappears because the decision is made.
//
// Everything else is the caller's: the summary, the artifacts, the checks, and every word. `labels` is a
// required record the screen builds from its catalog, which is what keeps `@warsha/ui` catalog-free (§6) and
// forces the ar+en strings to be written together.
//
// A failed RPC keeps the card and shows the error inline (§7) — the decision is not lost, only unsent.

import React, { useCallback, useId, useRef, useState } from 'react';

import { Button, Card, Text } from '../components';
import { aliasVar, colorVar, fontSize, fontWeight, radius, size, space } from '../tokens';

import { Lamp } from './Lamp';
import { Stamp } from './Stamp';
import { cx, EDGE_BORDER, FIELD, machineSkin, PROSE, RULE_BORDER } from './internal';

/** The three moves the gate state machine answers to. */
export type GateDecision = 'approve' | 'reject' | 'changes_requested';

/** What the gate is right now: waiting, or already decided. */
export type GateState = 'pending' | GateDecision;

export interface GateCardLabels {
  /** "بوّابة" / "gate" — the word above the id. */
  gate: React.ReactNode;
  /** The three actions. */
  approve: React.ReactNode;
  reject: React.ReactNode;
  requestChanges: React.ReactNode;
  /** The reason step: its label, its hint, its two buttons. */
  reason: React.ReactNode;
  reasonHint: React.ReactNode;
  confirm: React.ReactNode;
  cancel: React.ReactNode;
  /** The stamp words for a decided gate, and the pending lamp's word. */
  approved: React.ReactNode;
  rejected: React.ReactNode;
  changesRequested: React.ReactNode;
  waiting: React.ReactNode;
  /** What is required and why: "السبب مطلوب حتى يعرف الفريق ما يغيّره". */
  required: React.ReactNode;
}

export interface GateCardProps {
  /** The gate's own id (`gate_a_spec`). The card is about it, and the callback reports it back. */
  gateId: string;
  /** The headline: "الموافقة على المواصفات". */
  title: React.ReactNode;
  /** The summary, the artifacts, the checks — the caller's content, in the caller's words. */
  children?: React.ReactNode;
  state?: GateState;
  onDecision: (decision: GateDecision, detail: { gateId: string; note?: string }) => void;
  labels: GateCardLabels;
  /** The card is waiting on an RPC: the actions wait with it. */
  busy?: boolean;
  /** The decision failed to reach the daemon. The card keeps its actions (§7). */
  error?: React.ReactNode;
  /** The device that acted, when a decision exists: "من حاسوب المكتب" / "from this desktop". */
  device?: React.ReactNode;
  /** A `Chip` node saying the run is supervised, or any meta the screen wants in the head. */
  meta?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function GateCard({
  gateId,
  title,
  children,
  state = 'pending',
  onDecision,
  labels,
  busy = false,
  error,
  device,
  meta,
  className = '',
  style,
}: GateCardProps) {
  const [choice, setChoice] = useState<Exclude<GateDecision, 'approve'> | null>(null);
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const fieldId = useId();
  const actions = useRef<HTMLDivElement>(null);
  // The action to hand focus back to. A ref rather than the button node itself, because the action row
  // *remounts* when the step closes: the node the owner pressed no longer exists by the time they cancel.
  const restoreTo = useRef<Exclude<GateDecision, 'approve'> | null>(null);

  // Focus restore after a state transition is the one job an effect is for (§9: AUDIT-1 §4.2's gap, at the
  // scale of a card). It runs once the row is in the DOM, and only while a restore is pending.
  React.useEffect(() => {
    if (choice !== null || restoreTo.current === null) return;
    const wanted = restoreTo.current;
    restoreTo.current = null;
    actions.current?.querySelector<HTMLButtonElement>(`[data-gate-action="${wanted}"]`)?.focus();
  }, [choice]);

  const open = (decision: Exclude<GateDecision, 'approve'>): void => {
    restoreTo.current = decision;
    setChoice(decision);
    setNote('');
    setInvalid(false);
  };

  const close = useCallback(() => {
    setChoice(null);
    setNote('');
    setInvalid(false);
  }, []);

  const submit = useCallback(
    (event?: React.SyntheticEvent) => {
      event?.preventDefault();
      const text = note.trim();
      // §7: a refusal without a reason is not a decision the team can act on.
      if (text === '') {
        setInvalid(true);
        return;
      }
      if (!choice) return;
      onDecision(choice, { gateId, note: text });
      setChoice(null);
      setNote('');
      setInvalid(false);
    },
    [choice, gateId, note, onDecision]
  );

  const decided = state !== 'pending';

  return (
    <Card
      className={cx('warsha-gate-card', className)}
      style={{
        // The direction's one interruption: `md` shadow (Card already carries it), a structural edge, and
        // the lit band on the card's inline-start — which mirrors itself in Arabic, no second code path.
        // The band is `signalText`, not `signal`: as a mark on a plate the raw yellow measures 1.41:1, and
        // §12's AA-safe yellow is the token for a signal that has to be *seen*.
        borderRadius: radius('md'),
        border: EDGE_BORDER,
        borderInlineStart: `${size('edge')} solid ${aliasVar('signalText')}`,
        padding: 0,
        minInlineSize: 0,
        ...style,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: space(2),
          flexWrap: 'wrap',
          paddingInline: space(4),
          paddingBlockStart: space(3),
        }}
      >
        {!decided && (
          <Lamp state="waiting" size="xs">
            {labels.waiting}
          </Lamp>
        )}
        <Text size="sm" weight="bold" style={{ color: colorVar('text'), minInlineSize: 0 }}>
          {title}
        </Text>
        <span
          // The gate id is machine data: tabular, un-translated — and mono only while it reads as an id
          // (§11). A screen that puts the gate's *word* here (`البوابة ب`) gets the sans face for it.
          translate="no"
          style={{
            ...machineSkin(gateId),
            fontSize: fontSize('xs'),
            color: colorVar('text'),
            border: RULE_BORDER,
            borderRadius: radius('sm'),
            paddingInline: space(2),
            paddingBlock: space(0.5),
          }}
        >
          {gateId}
        </span>
        {meta && <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: space(1) }}>{meta}</span>}
      </header>

      {children && (
        <div style={{ paddingInline: space(4), paddingBlock: space(2), ...PROSE }}>
          <span style={{ color: colorVar('text'), fontSize: fontSize('sm') }}>{children}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginInline: space(4),
            marginBlockEnd: space(2),
            paddingInline: space(3),
            paddingBlock: space(2),
            borderInlineStart: `${size('edge')} solid ${colorVar('error')}`,
            backgroundColor: aliasVar('benchPlate'),
            color: colorVar('error'),
            fontSize: fontSize('sm'),
            fontWeight: fontWeight('medium'),
          }}
        >
          {error}
        </div>
      )}

      {decided ? (
        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: space(3),
            flexWrap: 'wrap',
            paddingInline: space(4),
            paddingBlock: space(3),
            borderBlockStart: RULE_BORDER,
          }}
        >
          <Stamp tone={state === 'approve' ? 'ok' : 'fail'}>
            {state === 'approve'
              ? labels.approved
              : state === 'reject'
                ? labels.rejected
                : labels.changesRequested}
          </Stamp>
          {device && (
            <span style={{ ...machineSkin(device), fontSize: fontSize('xs'), color: colorVar('text') }}>
              {device}
            </span>
          )}
        </footer>
      ) : choice ? (
        // The reason step: a labelled field, its hint, and two real buttons.
        <form
          onSubmit={submit}
          style={{
            display: 'grid',
            gap: space(1),
            paddingInline: space(4),
            paddingBlock: space(3),
            borderBlockStart: RULE_BORDER,
          }}
        >
          <label htmlFor={fieldId} style={{ color: colorVar('text'), fontSize: fontSize('sm') }}>
            {labels.reason}
          </label>
          <textarea
            id={fieldId}
            rows={2}
            // The step just opened and the owner's next keystroke is the reason: focus goes to the field,
            // not to the button they have to hunt for.
            autoFocus
            aria-required="true"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${fieldId}-hint ${fieldId}-error` : `${fieldId}-hint`}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              if (invalid && event.target.value.trim() !== '') setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
            style={{
              ...FIELD,
              fontSize: fontSize('sm'),
              resize: 'vertical',
              ...(invalid ? { border: `${size('rule')} solid ${colorVar('error')}` } : {}),
            }}
          />
          <span
            id={`${fieldId}-hint`}
            style={{ color: colorVar('text'), fontSize: fontSize('xs') }}
          >
            {labels.reasonHint}
          </span>
          {invalid && (
            <span
              id={`${fieldId}-error`}
              role="alert"
              style={{ color: colorVar('error'), fontSize: fontSize('sm'), fontWeight: fontWeight('medium') }}
            >
              {labels.required}
            </span>
          )}
          <span style={{ display: 'flex', gap: space(2), flexWrap: 'wrap', paddingBlockStart: space(2) }}>
            <Button type="submit" variant="primary" disabled={busy}>
              {labels.confirm}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>
              {labels.cancel}
            </Button>
          </span>
        </form>
      ) : (
        <div
          ref={actions}
          style={{
            display: 'flex',
            gap: space(2),
            flexWrap: 'wrap',
            paddingInline: space(4),
            paddingBlock: space(3),
            borderBlockStart: RULE_BORDER,
          }}
        >
          {/* Approve is the lit action of the screen (§1): the bench is waiting for exactly this one. Each
              action names itself for the a11y tree's sake and for the focus restore above. */}
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            data-gate-action="approve"
            onClick={() => onDecision('approve', { gateId })}
          >
            {labels.approve}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} data-gate-action="reject" onClick={() => open('reject')}>
            {labels.reject}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            data-gate-action="changes_requested"
            onClick={() => open('changes_requested')}
          >
            {labels.requestChanges}
          </Button>
        </div>
      )}
    </Card>
  );
}
