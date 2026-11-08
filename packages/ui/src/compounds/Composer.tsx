// @warsha/ui — Composer: the bench's hand wheel, kept where the owner's hands already are.
//
// §6 gives the rules — "sticky at inline-end edge of the chat column; Enter sends, Shift+Enter newline" —
// and each one is here for a reason the direction can defend:
//
//   * `position: sticky` with `inset-block-end` (logical, so it holds in Arabic and English alike) and
//     extra block-end padding, so a focused control is never hidden behind the bar it is typing into (§9);
//   * Enter sends and Shift+Enter is a newline, and **neither happens during an IME composition**: Arabic
//     input on a desktop composes with Enter to commit candidates, so a plain `key === 'Enter'` check would
//     send a half-typed sentence. This is the bug the redesign's keyboard rule exists to prevent;
//   * the field is a `<textarea>` in a `<form>` with a real `<label for>` — the label is visually hidden by
//     default because a chat column does not show a caption above its own input, but it is never absent;
//   * `Send` is disabled while the run is busy, and the form carries `aria-busy` so the state is announced
//     rather than only felt.
//
// The draft is the screen's business: pass `value`/`onValueChange` to keep it in the app's state (Simple
// mode persists a half-written instruction across mode switches), or leave it here for a plain box.

import React, { useCallback, useId, useState } from 'react';

import { Button } from '../components';
import { aliasVar, colorVar, fontSize, layer, lineHeight, size, space } from '../tokens';

import { cx, FIELD, isComposing, RULE_BORDER, VISUALLY_HIDDEN } from './internal';

export interface ComposerProps {
  /** Called with the trimmed text. The screen owns what happens next — a run, a reply, a handoff. */
  onSend: (text: string) => void;
  /** The field's label. Visually hidden unless `showLabel` says otherwise, never missing. */
  label: React.ReactNode;
  /** The send control's label — "أرسل" / "send". */
  sendLabel: React.ReactNode;
  /** A second control's node: stop the run, attach a file. */
  actions?: React.ReactNode;
  placeholder?: string;
  /** Controlled draft. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Uncontrolled draft, seeded. */
  defaultValue?: string;
  /** The run is answering: the send control waits, and the field says so. */
  busy?: boolean;
  disabled?: boolean;
  /** Keep the visible label above the field (a settings plate), instead of hiding it (a chat column). */
  showLabel?: boolean;
  /** Keep the typed text after sending — an editable draft the owner may want back. */
  keepDraft?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Composer({
  onSend,
  label,
  sendLabel,
  actions,
  placeholder,
  value,
  onValueChange,
  defaultValue = '',
  busy = false,
  disabled = false,
  showLabel = false,
  keepDraft = false,
  className = '',
  style,
}: ComposerProps) {
  const fieldId = useId();
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const draft = controlled ? (value ?? '') : inner;

  const setDraft = useCallback(
    (next: string) => {
      if (!controlled) setInner(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange]
  );

  const send = useCallback(
    (event?: React.SyntheticEvent) => {
      event?.preventDefault();
      const text = draft.trim();
      if (text === '' || busy || disabled) return;
      onSend(text);
      if (!keepDraft) setDraft('');
    },
    [busy, disabled, draft, keepDraft, onSend, setDraft]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      setDraft('');
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An Arabic IME commits a candidate with Enter; that keystroke is not "send".
    if (isComposing(event)) return;
    event.preventDefault();
    send();
  };

  return (
    <form
      onSubmit={send}
      aria-busy={busy}
      className={cx('warsha-composer', className)}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: space(2),
        paddingInline: space(4),
        // The bar reserves its own thickness plus a step, so a focused control at the end of the column is
        // never sitting under the sticky edge (§9).
        paddingBlock: space(3),
        paddingBlockEnd: space(4),
        borderBlockStart: RULE_BORDER,
        backgroundColor: colorVar('surface'),
        position: 'sticky',
        insetBlockEnd: space(0),
        // Above the transcript, below a dialog. A number the direction can explain, not a magic one.
        zIndex: layer('raised'),
        minInlineSize: 0,
        ...style,
      }}
    >
      <label htmlFor={fieldId} style={showLabel ? { ...composerLabel } : { ...composerLabel, ...VISUALLY_HIDDEN }}>
        {label}
      </label>

      <textarea
        id={fieldId}
        rows={1}
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        aria-busy={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        style={{
          ...FIELD,
          fontSize: fontSize('sm'),
          lineHeight: lineHeight('relaxed'),
          resize: 'none',
          flex: '1',
          minInlineSize: 0,
          minBlockSize: size('touch'),
          maxBlockSize: size('composerMax'),
          overflowY: 'auto',
          backgroundColor: aliasVar('benchPlate'),
          // A composer is prose, and prose is written in the document's own direction: the owner types
          // Arabic into an Arabic bench and Latin code into a Latin one, without a toggle (§11).
          paddingInline: space(3),
          paddingBlock: space(2),
        }}
      />

      {actions && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space(1), flex: 'none' }}>
          {actions}
        </span>
      )}

      <Button type="submit" variant="primary" disabled={disabled || busy || draft.trim() === ''}>
        {sendLabel}
      </Button>
    </form>
  );
}

/** The composer's label: a step of the type scale, medium weight, on the raised surface. */
const composerLabel: React.CSSProperties = {
  color: colorVar('text'),
  fontSize: fontSize('sm'),
};
